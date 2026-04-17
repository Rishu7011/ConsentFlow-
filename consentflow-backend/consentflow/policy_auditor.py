"""
consentflow/policy_auditor.py — Gate 05: Policy Auditor

Fetches and analyses AI plugin privacy policies and Terms of Service using the
Anthropic Claude API.  Detects clauses that could bypass or override a user's
consent revocation under GDPR and CCPA.

Public API
----------
    auditor = PolicyAuditor(db_pool, redis_client, anthropic_api_key="sk-ant-…")
    result  = await auditor.scan(request, db_pool, redis_client)

Exceptions
----------
    PolicyFetchError     — raised when the policy URL cannot be fetched or
                           the response body cannot be decoded as text.
    PolicyAnalysisError  — raised when the Anthropic API call itself fails
                           (network error, auth error, etc.).  A JSON parse
                           failure is handled gracefully and surfaced as a
                           critical finding rather than an exception.
"""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import List, Optional, Tuple

import anthropic
import httpx

logger = logging.getLogger(__name__)

# Maximum number of characters sent to the LLM (context safety guard).
_MAX_POLICY_CHARS: int = 12_000

# Claude model to use for policy analysis.
_MODEL: str = "claude-sonnet-4-20250514"

# System prompt instructing Claude to act as a privacy law expert.
_SYSTEM_PROMPT: str = """
You are a privacy law expert analyzing AI plugin Terms of Service and Privacy Policies on behalf of users who want to understand if the integration respects their consent preferences under GDPR and CCPA.

Identify clauses that could bypass, override, or undermine a user's consent revocation. Focus on:
1. Training on user inputs without explicit opt-out
2. Data sharing with third parties after revocation
3. Right to retain data indefinitely after deletion request
4. Jurisdiction clauses that weaken GDPR Article 7(3) or CCPA Section 1798.120
5. Shadow profiling or inference from behavioral data
6. Override of downstream consent signals
7. Retroactive policy changes applied to already-collected data

Respond ONLY with a valid JSON object with this exact shape:
{
  "findings": [
    {
      "id": "finding_1",
      "severity": "low|medium|high|critical",
      "category": "Category name",
      "clause_excerpt": "Short excerpt from the policy (max 200 chars)",
      "explanation": "Plain English explanation of why this is a risk",
      "article_reference": "e.g. GDPR Article 7(3) or CCPA 1798.120"
    }
  ],
  "summary": "2-3 sentence plain English summary of overall risk",
  "overall_risk_level": "low|medium|high|critical"
}

If no red flags are found, return findings as an empty array and overall_risk_level as "low".
""".strip()


# ── Custom exceptions ──────────────────────────────────────────────────────────


class PolicyFetchError(RuntimeError):
    """Raised when the policy document cannot be retrieved or decoded."""


class PolicyAnalysisError(RuntimeError):
    """Raised when the Anthropic API call fails at the network/auth level."""


# ── HTML text extraction ───────────────────────────────────────────────────────


class _TextExtractor(HTMLParser):
    """Minimal HTMLParser subclass that collects visible text nodes."""

    # Tags whose entire subtree content we skip.
    _SKIP_TAGS = frozenset(
        {"script", "style", "noscript", "head", "meta", "link", "svg", "img"}
    )

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._depth: int = 0           # nesting depth inside a skip-tag subtree
        self._skip_tag: Optional[str] = None

    def handle_starttag(self, tag: str, attrs: list) -> None:  # type: ignore[override]
        if self._skip_tag or tag in self._SKIP_TAGS:
            if not self._skip_tag:
                self._skip_tag = tag
            self._depth += 1

    def handle_endtag(self, tag: str) -> None:  # type: ignore[override]
        if self._skip_tag:
            self._depth -= 1
            if self._depth == 0:
                self._skip_tag = None

    def handle_data(self, data: str) -> None:
        if not self._skip_tag:
            stripped = data.strip()
            if stripped:
                self._parts.append(stripped)

    @property
    def text(self) -> str:
        return " ".join(self._parts)


def _strip_html(raw: str) -> str:
    """Return plain text extracted from an HTML document."""
    parser = _TextExtractor()
    try:
        parser.feed(raw)
        return parser.text
    except Exception:  # noqa: BLE001
        # Fallback: crude tag-strip using replace isn't safe; just return raw
        # truncated — analyze_policy will still work on partial text.
        logger.warning("HTML parser raised an exception; returning raw text as fallback.")
        return raw


# ── Main auditor class ─────────────────────────────────────────────────────────


class PolicyAuditor:
    """
    Gate 05 — Policy Auditor.

    Parameters
    ----------
    db_pool:           asyncpg connection pool (injected, not imported).
    redis_client:      aioredis / redis-py async client (reserved for future
                       caching of scan results by policy_text_hash).
    anthropic_api_key: Anthropic secret key used to instantiate AsyncAnthropic.
    """

    def __init__(
        self,
        db_pool,
        redis_client,
        anthropic_api_key: str,
    ) -> None:
        self._db_pool = db_pool
        self._redis = redis_client
        self._llm = anthropic.AsyncAnthropic(api_key=anthropic_api_key)
        self._http = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0),
            follow_redirects=True,
            headers={
                "User-Agent": (
                    "ConsentFlow-PolicyAuditor/1.0 "
                    "(privacy compliance scanner; contact@consentflow.io)"
                )
            },
        )

    # ── Helpers ────────────────────────────────────────────────────────────────

    async def _close(self) -> None:
        """Close the underlying HTTP client.  Call on application shutdown."""
        await self._http.aclose()

    async def __aenter__(self) -> "PolicyAuditor":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self._close()

    # ── Step 1: Fetch ──────────────────────────────────────────────────────────

    async def fetch_policy_text(self, url: str) -> str:
        """
        Fetch a privacy policy document from *url* and return plain text.

        Processing pipeline
        -------------------
        1. HTTP GET with a 15-second timeout (follows redirects).
        2. Strip HTML tags using ``html.parser`` to recover visible text.
        3. Collapse excess whitespace.
        4. Truncate to ``_MAX_POLICY_CHARS`` characters.

        Raises
        ------
        PolicyFetchError
            On any network error, non-2xx status, or decoding failure.
        """
        logger.info("PolicyAuditor: fetching policy from %s", url)
        try:
            response = await self._http.get(url)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise PolicyFetchError(
                f"HTTP {exc.response.status_code} fetching policy from {url}"
            ) from exc
        except httpx.RequestError as exc:
            raise PolicyFetchError(
                f"Network error fetching policy from {url}: {exc}"
            ) from exc

        # Decode body — respect charset from Content-Type if present.
        try:
            raw_text: str = response.text
        except Exception as exc:  # noqa: BLE001
            raise PolicyFetchError(
                f"Could not decode response body from {url}: {exc}"
            ) from exc

        content_type = response.headers.get("content-type", "")
        if "html" in content_type:
            plain = _strip_html(raw_text)
        else:
            # PDF / plain-text / other — use as-is
            plain = raw_text

        # Normalise whitespace
        plain = " ".join(plain.split())

        # Safety truncation
        if len(plain) > _MAX_POLICY_CHARS:
            logger.debug(
                "PolicyAuditor: truncating policy text from %d to %d chars",
                len(plain),
                _MAX_POLICY_CHARS,
            )
            plain = plain[:_MAX_POLICY_CHARS]

        if not plain.strip():
            raise PolicyFetchError(
                f"Fetched document from {url} yielded no extractable text."
            )

        return plain

    # ── Step 2: Analyse ────────────────────────────────────────────────────────

    async def analyze_policy(
        self,
        text: str,
        integration_name: str,
    ) -> Tuple[List[dict], str, str]:
        """
        Send policy text to Claude and return parsed findings.

        Returns
        -------
        (findings_dicts, raw_summary, overall_risk_level)
            ``findings_dicts`` is a list of raw dicts matching the
            ``PolicyFinding`` shape; callers can construct ``PolicyFinding``
            objects from them.

        Raises
        ------
        PolicyAnalysisError
            On Anthropic API-level failure (auth, network, rate-limit).
        """
        user_message = f"Integration name: {integration_name}\n\nPolicy text:\n{text}"

        logger.info(
            "PolicyAuditor: calling Claude (%s) for integration=%r, text_len=%d",
            _MODEL,
            integration_name,
            len(text),
        )

        try:
            response = await self._llm.messages.create(
                model=_MODEL,
                max_tokens=2048,
                system=_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_message}],
            )
        except anthropic.APIError as exc:
            raise PolicyAnalysisError(
                f"Anthropic API error during policy analysis: {exc}"
            ) from exc

        raw_content: str = response.content[0].text if response.content else ""

        # ── JSON parse ────────────────────────────────────────────────────────
        # Claude may (rarely) wrap the JSON in a markdown code fence — strip it.
        stripped = raw_content.strip()
        if stripped.startswith("```"):
            lines = stripped.splitlines()
            # Remove first and last fence lines
            stripped = "\n".join(
                line for line in lines
                if not line.startswith("```")
            ).strip()

        try:
            parsed: dict = json.loads(stripped)
            findings: list = parsed.get("findings", [])
            summary: str = parsed.get("summary", "")
            risk_level: str = parsed.get("overall_risk_level", "low")

            # Normalise risk level to a known value
            if risk_level not in ("low", "medium", "high", "critical"):
                risk_level = "medium"

        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            logger.error(
                "PolicyAuditor: JSON parse failure for integration=%r: %s",
                integration_name,
                exc,
            )
            # Graceful degradation — surface the failure as a critical finding.
            findings = [
                {
                    "id": "parse_error_1",
                    "severity": "critical",
                    "category": "Analysis Failure",
                    "clause_excerpt": raw_content[:200] if raw_content else "(no response)",
                    "explanation": (
                        "The AI analysis could not be parsed. "
                        "The raw model response was not valid JSON. "
                        "Manual review of the policy is strongly recommended."
                    ),
                    "article_reference": "",
                }
            ]
            summary = "Analysis could not be completed"
            risk_level = "critical"

        return findings, summary, risk_level

    # ── Step 3: Scan (orchestrator) ────────────────────────────────────────────

    async def scan(
        self,
        request,   # PolicyScanRequest — not imported to keep this module self-contained
        db_pool,
        redis_client,
    ):
        """
        Full scan pipeline:

        1. Resolve policy text (URL fetch or direct text).
        2. Compute SHA-256 hash for deduplication.
        3. Call Claude to analyse the text.
        4. Persist to ``policy_scans`` via asyncpg.
        5. Write an ``audit_log`` row for this gate action.
        6. Return a ``PolicyScanResult``-compatible dict (callers construct the
           model themselves to avoid circular imports).

        Returns
        -------
        dict
            Keys: scan_id, integration_name, overall_risk_level, findings,
                  findings_count, raw_summary, scanned_at, policy_url.
            Each finding is a dict matching the ``PolicyFinding`` shape.
        """

        # ── 1. Resolve text ───────────────────────────────────────────────────
        policy_url_str: Optional[str] = None

        if request.policy_url is not None:
            policy_url_str = str(request.policy_url)
            policy_text = await self.fetch_policy_text(policy_url_str)
        elif request.policy_text:
            policy_text = request.policy_text[:_MAX_POLICY_CHARS]
        else:
            # model_validator on PolicyScanRequest prevents this, but guard anyway
            raise PolicyFetchError(
                "PolicyScanRequest must supply policy_url or policy_text."
            )

        # ── 2. Hash ───────────────────────────────────────────────────────────
        text_hash: str = hashlib.sha256(policy_text.encode("utf-8", errors="replace")).hexdigest()

        # ── 3. Analyse ────────────────────────────────────────────────────────
        findings_dicts, raw_summary, overall_risk_level = await self.analyze_policy(
            policy_text, request.integration_name
        )
        findings_count: int = len(findings_dicts)

        # ── 4. Persist policy_scans ───────────────────────────────────────────
        scan_id = uuid.uuid4()
        scanned_at = datetime.now(tz=timezone.utc)

        insert_scan_sql = """
            INSERT INTO policy_scans (
                id, scanned_at, integration_name, policy_url,
                policy_text_hash, overall_risk_level,
                findings_count, findings, raw_summary
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        """

        async with db_pool.acquire() as conn:
            await conn.execute(
                insert_scan_sql,
                scan_id,
                scanned_at,
                request.integration_name,
                policy_url_str,
                text_hash,
                overall_risk_level,
                findings_count,
                json.dumps(findings_dicts),    # asyncpg accepts str for JSONB
                raw_summary,
            )

            # ── 5. Audit log row ──────────────────────────────────────────────
            audit_metadata = {
                "integration_name": request.integration_name,
                "overall_risk_level": overall_risk_level,
                "findings_count": findings_count,
                "policy_url": policy_url_str,
                "scan_id": str(scan_id),
            }

            insert_audit_sql = """
                INSERT INTO audit_log (
                    id, event_time, user_id, gate_name, action_taken,
                    consent_status, purpose, metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """

            audit_id = uuid.uuid4()
            await conn.execute(
                insert_audit_sql,
                audit_id,
                scanned_at,
                "system",          # no specific user — policy scan is system-level
                "policy_auditor",
                "scanned",
                "unknown",
                "policy_audit",
                json.dumps(audit_metadata),
            )

            logger.info(
                "PolicyAuditor: scan complete — integration=%r risk=%s findings=%d "
                "scan_id=%s audit_id=%s",
                request.integration_name,
                overall_risk_level,
                findings_count,
                scan_id,
                audit_id,
            )

        # ── 6. Return result dict ──────────────────────────────────────────────
        return {
            "scan_id": scan_id,
            "integration_name": request.integration_name,
            "overall_risk_level": overall_risk_level,
            "findings": findings_dicts,
            "findings_count": findings_count,
            "raw_summary": raw_summary,
            "scanned_at": scanned_at,
            "policy_url": policy_url_str,
        }

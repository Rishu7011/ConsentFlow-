"""
tests/test_policy_auditor.py — Gate 05: Policy Auditor test suite.

All tests are fully isolated:
  - No real Anthropic API calls (anthropic.AsyncAnthropic is mocked).
  - No real HTTP requests (httpx.AsyncClient.get is mocked).
  - No real database (FakePool / FakeConnection from conftest).
  - No real Redis (FakeRedis from conftest).

Test IDs
--------
test_scan_with_text              — happy path: raw text → PolicyScanResult
test_scan_url_fetch_error        — httpx ConnectError → PolicyFetchError raised
test_analyze_bad_json            — malformed LLM JSON → critical parse-error finding
test_overall_risk_level_critical — 3 critical findings → level "critical"
test_post_scan_endpoint          — FastAPI TestClient, mocked .scan(), assert 201
"""
from __future__ import annotations

import json
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient, ConnectError, Request as HttpxRequest

# ── Project imports ────────────────────────────────────────────────────────────
from consentflow.policy_auditor import PolicyAuditor, PolicyFetchError
from consentflow.app.models import PolicyScanRequest, PolicyScanResult, PolicyFinding


# ── Shared fixtures ────────────────────────────────────────────────────────────


@pytest.fixture
def fake_pool(fake_pool):  # noqa: F811 — re-export conftest fixture
    """asyncpg pool stub from conftest."""
    return fake_pool


@pytest.fixture
def fake_redis(fake_redis):  # noqa: F811
    """Redis stub from conftest."""
    return fake_redis


def _make_auditor(fake_pool, fake_redis) -> PolicyAuditor:
    """Construct a PolicyAuditor with a dummy API key (no real calls made)."""
    return PolicyAuditor(
        db_pool=fake_pool,
        redis_client=fake_redis,
        anthropic_api_key="sk-ant-test-key",
    )


def _make_anthropic_response(payload: dict) -> MagicMock:
    """
    Build a MagicMock that mimics ``anthropic.types.Message``.

    ``response.content[0].text`` must return the JSON string.
    """
    content_block = MagicMock()
    content_block.text = json.dumps(payload)
    msg = MagicMock()
    msg.content = [content_block]
    return msg


# ── Test 1: happy path with raw policy_text ───────────────────────────────────


@pytest.mark.asyncio
async def test_scan_with_text(fake_pool, fake_redis):
    """
    Provide raw policy_text → PolicyAuditor should call analyze_policy,
    persist to DB, and return a well-formed result dict.
    """
    llm_payload = {
        "findings": [
            {
                "id": "finding_1",
                "severity": "high",
                "category": "Data Retention",
                "clause_excerpt": "We may retain your data indefinitely.",
                "explanation": "Retention after deletion request violates GDPR Art. 17.",
                "article_reference": "GDPR Article 17",
            }
        ],
        "summary": "The policy contains a high-risk retention clause.",
        "overall_risk_level": "high",
    }

    auditor = _make_auditor(fake_pool, fake_redis)

    with patch.object(
        auditor._llm.messages,
        "create",
        new=AsyncMock(return_value=_make_anthropic_response(llm_payload)),
    ):
        request = PolicyScanRequest(
            integration_name="TestPlugin",
            policy_text="We may retain your data indefinitely for business purposes.",
        )
        result = await auditor.scan(request, fake_pool, fake_redis)

    assert result["integration_name"] == "TestPlugin"
    assert result["overall_risk_level"] == "high"
    assert result["findings_count"] == 1
    assert result["findings"][0]["severity"] == "high"
    assert result["findings"][0]["article_reference"] == "GDPR Article 17"
    assert isinstance(result["scan_id"], uuid.UUID)
    assert isinstance(result["scanned_at"], datetime)
    assert result["policy_url"] is None


# ── Test 2: URL fetch failure raises PolicyFetchError ─────────────────────────


@pytest.mark.asyncio
async def test_scan_url_fetch_error(fake_pool, fake_redis):
    """
    When httpx.AsyncClient.get raises a ConnectError the auditor must
    re-raise it as PolicyFetchError — never a bare httpx exception.
    """
    auditor = _make_auditor(fake_pool, fake_redis)

    # Build a minimal fake Request object that httpx ConnectError needs.
    fake_httpx_request = HttpxRequest("GET", "https://evil-plugin.example.com/policy")

    with patch.object(
        auditor._http,
        "get",
        new=AsyncMock(side_effect=ConnectError("Name resolution failed", request=fake_httpx_request)),
    ):
        request = PolicyScanRequest(
            integration_name="EvilPlugin",
            policy_url="https://evil-plugin.example.com/policy",
        )
        with pytest.raises(PolicyFetchError, match="Network error"):
            await auditor.scan(request, fake_pool, fake_redis)


# ── Test 3: malformed LLM JSON → critical parse-error finding ─────────────────


@pytest.mark.asyncio
async def test_analyze_bad_json(fake_pool, fake_redis):
    """
    When Claude returns text that is not valid JSON the auditor must:
    - Return exactly one finding
    - Set severity = "critical"
    - Set overall_risk_level = "critical"
    - Set raw_summary = "Analysis could not be completed"
    """
    bad_response = MagicMock()
    bad_response.content = [MagicMock(text="Sorry, I cannot help with that request.")]

    auditor = _make_auditor(fake_pool, fake_redis)

    with patch.object(
        auditor._llm.messages,
        "create",
        new=AsyncMock(return_value=bad_response),
    ):
        findings, summary, risk_level = await auditor.analyze_policy(
            text="Some policy text here.",
            integration_name="BadPlugin",
        )

    assert risk_level == "critical"
    assert summary == "Analysis could not be completed"
    assert len(findings) == 1
    assert findings[0]["severity"] == "critical"
    assert findings[0]["category"] == "Analysis Failure"


# ── Test 4: all critical findings → overall_risk_level "critical" ─────────────


@pytest.mark.asyncio
async def test_overall_risk_level_critical(fake_pool, fake_redis):
    """
    When the LLM returns three critical findings and overall_risk_level
    "critical", the auditor must surface that level unchanged.
    """
    llm_payload = {
        "findings": [
            {
                "id": f"finding_{i}",
                "severity": "critical",
                "category": "Consent Override",
                "clause_excerpt": f"Clause {i} overrides consent.",
                "explanation": "This clause bypasses revocation.",
                "article_reference": "GDPR Article 7(3)",
            }
            for i in range(1, 4)
        ],
        "summary": "Three critical consent-bypass clauses found.",
        "overall_risk_level": "critical",
    }

    auditor = _make_auditor(fake_pool, fake_redis)

    with patch.object(
        auditor._llm.messages,
        "create",
        new=AsyncMock(return_value=_make_anthropic_response(llm_payload)),
    ):
        findings, summary, risk_level = await auditor.analyze_policy(
            text="Comprehensive policy text.",
            integration_name="CriticalPlugin",
        )

    assert risk_level == "critical"
    assert len(findings) == 3
    assert all(f["severity"] == "critical" for f in findings)
    assert "critical" in summary.lower()


# ── Test 5: POST /policy/scan endpoint → 201 with scan_id ────────────────────


@pytest.mark.asyncio
async def test_post_scan_endpoint(fake_pool, fake_redis):
    """
    Full endpoint smoke test: POST /policy/scan with mocked PolicyAuditor.scan.

    Verifies:
    - HTTP 201 status code
    - Response body contains a valid ``scan_id`` UUID
    - ``overall_risk_level`` matches the mocked return value
    - ``findings_count`` is correct
    """
    scan_id = uuid.uuid4()
    scanned_at = datetime.now(tz=timezone.utc)

    mock_scan_result = {
        "scan_id": scan_id,
        "integration_name": "TestEndpointPlugin",
        "overall_risk_level": "medium",
        "findings": [
            {
                "id": "finding_1",
                "severity": "medium",
                "category": "Third Party Sharing",
                "clause_excerpt": "We share data with partners.",
                "explanation": "Data sharing post-revocation is non-compliant.",
                "article_reference": "CCPA 1798.120",
            }
        ],
        "findings_count": 1,
        "raw_summary": "One medium-risk clause detected regarding third-party sharing.",
        "scanned_at": scanned_at,
        "policy_url": None,
    }

    from consentflow.app.main import app

    # Inject fakes directly (same pattern as conftest client fixture)
    app.state.db_pool = fake_pool
    app.state.redis_client = fake_redis

    # Patch PolicyAuditor.scan so no real LLM / DB calls happen
    with patch(
        "consentflow.app.routers.policy.PolicyAuditor.scan",
        new=AsyncMock(return_value=mock_scan_result),
    ), patch(
        "consentflow.app.routers.policy.settings",
        anthropic_api_key="sk-ant-test-key",
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            response = await ac.post(
                "/policy/scan",
                json={
                    "integration_name": "TestEndpointPlugin",
                    "policy_text": "We share data with advertising partners after any opt-out.",
                },
            )

    assert response.status_code == 201, response.text

    body = response.json()
    assert uuid.UUID(body["scan_id"])  # valid UUID
    assert body["overall_risk_level"] == "medium"
    assert body["findings_count"] == 1
    assert body["integration_name"] == "TestEndpointPlugin"
    assert len(body["findings"]) == 1
    assert body["findings"][0]["severity"] == "medium"

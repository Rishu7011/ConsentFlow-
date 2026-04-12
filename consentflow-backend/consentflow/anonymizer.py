"""
consentflow/anonymizer.py — PII detection and masking via Microsoft Presidio.

Public API
----------
anonymize_record(record: dict) -> dict

Behaviour
---------
*  All string-valued fields in ``record`` are scanned for PII using
   ``presidio-analyzer`` (spaCy ``en_core_web_lg`` model).
*  Detected PII entities are replaced with ``<ENTITY_TYPE>`` placeholders by
   ``presidio-anonymizer``.
*  Non-string values (ints, floats, booleans, nested dicts/lists) are left
   untouched.
*  The original dict is **not** mutated; a new dict is returned.

Supported entity types (detected automatically)
-------------------
PERSON, EMAIL_ADDRESS, PHONE_NUMBER, CREDIT_CARD, IBAN_CODE,
IP_ADDRESS, LOCATION, DATE_TIME, NRP, MEDICAL_LICENSE, URL, and more.

Performance note
----------------
The ``AnalyzerEngine`` and ``AnonymizerEngine`` are module-level singletons —
they are loaded once on first import and reused for every call, which avoids
expensive model reloads.
"""
from __future__ import annotations

import logging
from typing import Any

from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

logger = logging.getLogger(__name__)

# ── Module-level singletons (loaded once) ─────────────────────────────────────

_analyzer: AnalyzerEngine | None = None
_anonymizer: AnonymizerEngine | None = None


def _get_engines() -> tuple[AnalyzerEngine, AnonymizerEngine]:
    """Lazy-load Presidio engines (thread-safe for read-heavy workloads)."""
    global _analyzer, _anonymizer  # noqa: PLW0603
    if _analyzer is None:
        logger.info("Loading Presidio AnalyzerEngine (en_core_web_lg)…")
        _analyzer = AnalyzerEngine()
        logger.info("Presidio AnalyzerEngine ready")
    if _anonymizer is None:
        _anonymizer = AnonymizerEngine()
    return _analyzer, _anonymizer


# ── Public helpers ─────────────────────────────────────────────────────────────

# Operator: replace detected entities with a <TYPE> tag
_REPLACE_OPERATOR: dict[str, OperatorConfig] = {
    "DEFAULT": OperatorConfig("replace", {"new_value": "<REDACTED>"}),
}

_SUPPORTED_LANGUAGES = ("en",)


def _anonymize_text(text: str, analyzer: AnalyzerEngine, anonymizer: AnonymizerEngine) -> str:
    """
    Detect and mask PII in a single text string.

    Returns the anonymized string.  If Presidio finds no PII entities the
    original text is returned unchanged.
    """
    results = analyzer.analyze(
        text=text,
        language="en",
        # Analyse all entity types that Presidio knows about
        entities=None,
    )
    if not results:
        return text

    anonymized = anonymizer.anonymize(
        text=text,
        analyzer_results=results,
        operators=_REPLACE_OPERATOR,
    )
    return anonymized.text  # type: ignore[return-value]


def anonymize_record(record: dict[str, Any]) -> dict[str, Any]:
    """
    Return a copy of *record* with all string-valued PII fields masked.

    Non-string values are preserved verbatim.  Nested dicts / lists are
    recursively processed so deeply nested PII is also caught.

    Parameters
    ----------
    record: A dict representing a single data record (e.g. a training sample).

    Returns
    -------
    A new dict with the same keys but PII-masked string values.
    """
    analyzer, anonymizer = _get_engines()
    return _anonymize_value(record, analyzer, anonymizer)


def _anonymize_value(
    value: Any,
    analyzer: AnalyzerEngine,
    anonymizer: AnonymizerEngine,
) -> Any:
    """Recursively anonymize a value (dict, list, str, or other)."""
    if isinstance(value, str):
        return _anonymize_text(value, analyzer, anonymizer)
    if isinstance(value, dict):
        return {k: _anonymize_value(v, analyzer, anonymizer) for k, v in value.items()}
    if isinstance(value, list):
        return [_anonymize_value(item, analyzer, anonymizer) for item in value]
    # int, float, bool, None — leave untouched
    return value

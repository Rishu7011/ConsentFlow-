# ConsentFlow — Presentation Notes

> Hackathon demo deck reference. Use alongside the live app at `http://localhost:3001`.

---

## Elevator Pitch (30 seconds)

ConsentFlow solves the gap between consent management platforms and AI pipelines. When a user revokes consent in OneTrust or your front-end, what actually happens to their data inside your ML pipeline? With ConsentFlow, the answer is: **everything stops, everywhere, immediately.** One revocation propagates from your database to a Redis cache to a Kafka event bus — blocking inference in under 5 milliseconds, quarantining in-flight training runs, and flagging their data in every future drift window. And before any third-party AI tool even touches your users' data, ConsentFlow's Policy Auditor scans its Terms of Service with Claude to identify bypass clauses that could silently override your users' consent.

---

## Problem Statement

GDPR, CCPA, and AI Act all require consent withdrawal to propagate "without undue delay." But modern ML pipelines are complex:

- Data may be cached
- Models may be mid-training on a GPU cluster
- Inference services check a stale in-memory flag
- Drift monitors scan past data that includes revoked users
- Third-party AI plugins ship Terms of Service with clauses that silently override user consent

Existing CMPs (OneTrust, Cookiebot) issue a webhook and consider the job done. What happens inside the pipeline is left to the engineering team — and it almost always has gaps.

**ConsentFlow closes those gaps with five enforcement gates.**

---

## Solution: Five Gates

```
User revokes consent
        │
        ▼
 ┌──────────────────┐
 │  ConsentFlow API  │  FastAPI + PostgreSQL + Redis + Kafka
 └──────────────────┘
        │
        ├── Dataset Gate      PII scrub before MLflow registration (Presidio)
        ├── Training Gate     Quarantine in-flight runs via Kafka (MLflow tags)
        ├── Inference Gate    ASGI middleware — 403 in <5ms (Redis cache)
        ├── Drift Monitor     Evidently AI — flag revoked samples, alert severity
        └── Policy Auditor    LLM ToS scan — clause-level findings, GDPR mapping (Claude)
```

### Gate 01 — Dataset

**Problem:** Training data is registered into MLflow before anyone checks consent status for the specific data type.

**Solution:** `register_dataset_with_consent_check()` iterates every record before MLflow registration. Revoked-user records are passed through Presidio's `AnalyzerEngine` — names, emails, phone numbers, IPs replaced with `<REDACTED>`. The cleaned dataset is logged as an MLflow artifact with per-record consent metrics.

**Tech:** Microsoft Presidio 2.2 · spaCy `en_core_web_lg` · MLflow 2.13

---

### Gate 02 — Training

**Problem:** A training job starts before the revocation webhook arrives. It runs for hours using a user's data.

**Solution:** The `TrainingGateConsumer` (async Kafka consumer, group `consentflow-training-gate`) listens to `consent.revoked`. On each event it calls `mlflow.search_runs()` for runs tagged with the user's ID and applies `consent_status=quarantined` tags with a reason string and timestamp. No data deletion, no revert — that's left to model governance policy. The gate does the minimum: flags and stops propagation.

**Tech:** Apache Kafka · aiokafka · MLflow run tagging

---

### Gate 03 — Inference

**Problem:** Your LLM API is happily serving predictions to a user after they revoked consent.

**Solution:** `ConsentMiddleware` is a Starlette `BaseHTTPMiddleware` mounted at `/infer`. Before **every** request hits a handler:

1. Extract `user_id` from `X-User-ID` header (or JSON body)
2. Check Redis cache → cache hit = decision in <1 ms
3. Cache miss → PostgreSQL authoritative lookup
4. Fail-closed: any exception returns `503` (never lets a revoked user through on infra error)

| Status | Response Code |
|--------|---------------|
| Consent granted | 200 — pass-through |
| Consent revoked | 403 — blocked |
| Missing user ID | 400 — invalid |
| Infra failure | 503 — fail-closed |

**Tech:** FastAPI ASGI · Starlette `BaseHTTPMiddleware` · Redis 7

---

### Gate 04 — Drift Monitor

**Problem:** Your drift monitoring service scans production data including samples from users who have since revoked consent.

**Solution:** `ConsentAwareDriftMonitor` wraps Evidently AI. Before computing drift:
- Tags every sample with `_consent_status` by calling `is_user_consented()` per row
- Strips the column from Evidently input (internal annotation only)
- Counts revoked-status samples in the current window
- Fires `DriftAlert` entries: severity `warning` (<5 revoked rows), `critical` (≥5)

**Tech:** Evidently AI 0.4 · pandas · `is_user_consented()` SDK

---

### Gate 05 — Policy Auditor

**Problem:** Third-party AI plugins, SaaS tools, and data processors ship Terms of Service containing clauses that silently override user consent — training on user inputs, sharing with unnamed sub-processors, retroactive policy changes — with no tooling to detect them.

**Solution:** `POST /policy/scan` accepts a `policy_url` or raw `policy_text` plus an `integration_name`. Policy text is fetched (if URL) and sent to **Claude claude-sonnet-4-20250514** with a structured compliance prompt. Claude detects seven categories of bypass clause:

| Category | Example clause pattern |
|----------|----------------------|
| Training on inputs | "We may use your inputs to improve our models" |
| Third-party sharing | "Affiliated partners and service providers" (no names) |
| Data retention overrides | Retention period longer than stated consent period |
| Weak jurisdiction | "Applicable law" without specifying GDPR/CCPA jurisdiction |
| Shadow profiling | Cross-context behavioural tracking without explicit consent |
| Downstream consent signal override | "Our partners' policies apply to processed data" |
| Retroactive policy changes | "Continued use constitutes acceptance" |

Each finding returns: `severity` (low / medium / high / critical), `clause_excerpt`, `plain_english_explanation`, `gdpr_article`, `ccpa_section`.

All scans are logged to `audit_log` with `gate_name="policy_auditor"`. The `/policy` frontend page shows a risk-level banner (green / amber / red / critical) and per-finding expandable cards.

**Tech:** Anthropic Claude claude-sonnet-4-20250514 · `anthropic` Python SDK · `migrations/004_policy_scans.sql`

---

## Technical Depth

### Data flow (sequence)

```
CMP webhook
    → POST /webhook/consent-revoke (camelCase OneTrust payload)
    → Validate userId UUID + consentStatus="revoked"
    → UPSERT consent_records (idempotent, ON CONFLICT DO UPDATE)
    → INVALIDATE Redis key consent:{user_id}:{purpose}
    → PUBLISH to Kafka topic consent.revoked (acks=all, key=user_id)
    → Training Gate consumer: quarantine matching MLflow runs
    → Next /infer request for this user: Redis hit → 403

Policy Auditor flow (independent)
    → POST /policy/scan (integration_name + policy_url or policy_text)
    → Fetch policy text (if URL)
    → Claude claude-sonnet-4-20250514 structured compliance analysis
    → INSERT INTO policy_scans (findings JSON, overall_risk_level)
    → INSERT INTO audit_log (gate_name="policy_auditor", action_taken="scanned")
    → Response: scan_id, overall_risk_level, findings[]
```

### Kafka guarantees

- `acks="all"` — producer waits for all in-sync replicas
- Partition key = `user_id` — ordering guaranteed per user
- Consumer group `consentflow-training-gate` — at-least-once delivery
- `auto_offset_reset="earliest"` — catch events after consumer restart

### Redis cache design

- Key: `consent:{user_id}:{purpose}` (purpose-scoped)
- Value: JSON `{ "user_id", "purpose", "status", "updated_at" }`
- Write-through invalidation on every consent write (not set-on-read)
- TTL: 60 s (configurable via `CONSENT_CACHE_TTL`)

### Fail-closed pattern

Every gate defaults to **deny**:
- SDK: `is_user_consented()` returns `False` if no record exists (deny by default)
- Inference gate: any infra exception → 503 (never passes through on error)
- Dataset gate: records missing `user_id` treated as revoked
- Monitoring gate: Presidio/Redis error → sample tagged "revoked"
- Policy Auditor: Claude API failure → 502 with error detail; scan not recorded as clean

---

## Observability

### OpenTelemetry
- Every gate wrapped in an OTel span (`{gate_name}.check`)
- Span attributes: `user_id`, `consent_status`, `action_taken`, `purpose`, `path`
- OTLP gRPC exporter → OTel Collector → Grafana Explore
- `trace_id` stored in `audit_log` — click trace → span link in Grafana

### Audit log
PostgreSQL `audit_log` table captures every gate decision:
```
id | event_time | user_id | gate_name | action_taken | consent_status | purpose | metadata | trace_id
```
Queryable via `GET /audit/trail?gate_name=inference_gate&user_id=...&limit=100`

Policy Auditor writes `gate_name="policy_auditor"`, `action_taken="scanned"`, with `scan_id` and `overall_risk_level` in `metadata`.

### Grafana
- Provisioned dashboards in `grafana/dashboards/`
- Prometheus scrape endpoint on OTel Collector port 8889
- Zero-login (anonymous admin mode) for hackathon demo

---

## Live Demo Sequence (2 minutes)

| Step | What to show | Expected result |
|------|-------------|-----------------|
| 1 | `http://localhost:3001` | Landing — animated flow diagram, 5 gate cards, tech stack |
| 2 | Click **Live Demo** → Dashboard | Metric cards: users, consents, blocked count, <5ms response, policies scanned |
| 3 | Navigate to **Users** | Demo user visible; click "Set as active" |
| 4 | Navigate to **Inference Tester** | UUID auto-fills; click "Fire /infer/predict" → ✅ green "Allowed" |
| 5 | Navigate to **Webhook** | Pre-filled OneTrust payload; click "Simulate Revocation" → `kafka_published: true` |
| 6 | Navigate back to **Inference Tester** | Click "Fire /infer/predict" → 🔴 red "Blocked — consent revoked (403)" |
| 7 | Navigate to **Dashboard** | `blocked` counter incremented; audit table shows new block event |
| 8 | Navigate to **Audit Trail** | Full trace: `inference_gate / blocked / revoked` with timestamp |
| 9 | Navigate to **Policy Auditor** | Paste a real AI plugin ToS URL (e.g. OpenAI, Notion AI) | Page loads with scan form and integration name field |
| 10 | Click **"Scan for Risks"** | LLM returns findings in ~5s | Risk banner shows CRITICAL + N findings with clause excerpts and GDPR article refs |
| 11 | Navigate to **Audit Trail** | Policy scan entry visible | `gate_name: policy_auditor`, `action_taken: scanned`, risk level in metadata |

**Key moment:** Steps 4 → 6 — the audience watches a `200 OK` turn into a `403 Forbidden` after a single webhook call. That's the core consent enforcement demo.

**Second key moment:** Steps 9 → 10 — Claude identifies bypass clauses in a real vendor ToS that would silently override the consent the user just saw enforced. Closes the loop on the third-party risk vector.

---

## Key Differentiators

| Feature | ConsentFlow | Typical implementation |
|---------|-------------|----------------------|
| Revocation latency | <5 ms (Redis cache hit) | Minutes to hours (batch job) |
| Training enforcement | Kafka → MLflow quarantine tag | None / manual |
| Fail-closed behavior | Yes (infra error → deny) | Often fail-open |
| Audit trail | PostgreSQL + OTel trace link | None |
| Drift monitor integration | Evidently with consent tagging | None |
| AI plugin policy bypass detection | LLM-powered ToS scan, clause-level findings, GDPR article mapping | None — no tooling scans third-party policies |
| Open source | Yes (MIT) | Proprietary CMP SDK |

---

## Judging Criteria Alignment

**Technical innovation:**
- Novel ASGI middleware pattern for real-time consent enforcement
- Kafka-driven cross-gate propagation vs. polling approaches
- Presidio PII scrub integrated directly into MLflow registration gate
- **Novel use of Claude (claude-sonnet-4-20250514) as a consent compliance auditor** — operating within the same enforcement stack that blocks inference and quarantines training, so that policy-level bypass risks surface alongside runtime enforcement decisions; no prior art in the CMP space uses an LLM for clause-level ToS analysis mapped to specific GDPR/CCPA articles

**Privacy/compliance relevance:**
- GDPR Article 7(3): right to withdraw consent "without undue delay" → sub-5ms enforcement
- GDPR Article 17: right to erasure → anonymization at dataset gate
- EU AI Act Article 10: data governance requirements → full audit trail per gate decision
- GDPR Articles 13/14/28: transparency and data processor obligations → Policy Auditor surfaces third-party clauses that violate these articles before integration

**Completeness:**
- End-to-end: from webhook to inference block, with audit trail
- Full dashboard UI demonstrating every gate including Policy Auditor scan count
- Test suite for every gate

**Demo-ability:**
- 2-minute core demo script requiring only a web browser
- Extended demo shows LLM policy scan in ~5 seconds on any public ToS URL
- Demo user pre-seeded (no setup needed)
- Webhook simulator built into the UI

---

## Tech Stack Summary

**Backend:** FastAPI · Python 3.12 · PostgreSQL 16 · Redis 7 · Apache Kafka (Confluent 7.6) · aiokafka · asyncpg · MLflow 2.13 · Microsoft Presidio · spaCy · Evidently AI · OpenTelemetry · Grafana · **Anthropic Claude claude-sonnet-4-20250514**

**Frontend:** Next.js 16 (App Router) · React 19 · TypeScript · TailwindCSS v4 · TanStack Query v5 · Framer Motion · GSAP · Lucide React

**Infrastructure:** Docker Compose (8 services) · OTel Collector · multi-stage Dockerfile

# ConsentFlow — Presentation Notes

> Hackathon demo deck reference. Use alongside the live app at `http://localhost:3001`.

---

## Elevator Pitch (30 seconds)

ConsentFlow solves the gap between consent management platforms and AI pipelines. When a user revokes consent in OneTrust or your front-end, what actually happens to their data inside your ML pipeline? With ConsentFlow, the answer is: **everything stops, everywhere, immediately.** One revocation propagates from your database to a Redis cache to a Kafka event bus — blocking inference in under 5 milliseconds, quarantining in-flight training runs, and flagging their data in every future drift window.

---

## Problem Statement

GDPR, CCPA, and AI Act all require consent withdrawal to propagate "without undue delay." But modern ML pipelines are complex:

- Data may be cached
- Models may be mid-training on a GPU cluster
- Inference services check a stale in-memory flag
- Drift monitors scan past data that includes revoked users

Existing CMPs (OneTrust, Cookiebot) issue a webhook and consider the job done. What happens inside the pipeline is left to the engineering team — and it almost always has gaps.

**ConsentFlow closes those gaps with four enforcement gates.**

---

## Solution: Four Gates

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
        └── Drift Monitor     Evidently AI — flag revoked samples, alert severity
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

### Grafana
- Provisioned dashboards in `grafana/dashboards/`
- Prometheus scrape endpoint on OTel Collector port 8889
- Zero-login (anonymous admin mode) for hackathon demo

---

## Live Demo Sequence (2 minutes)

| Step | What to show | Expected result |
|------|-------------|-----------------|
| 1 | `http://localhost:3001` | Landing — animated flow diagram, 4 gate cards, tech stack |
| 2 | Click **Live Demo** → Dashboard | Metric cards: users, consents, blocked count, <5ms response |
| 3 | Navigate to **Users** | Demo user visible; click "Set as active" |
| 4 | Navigate to **Inference Tester** | UUID auto-fills; click "Fire /infer/predict" → ✅ green "Allowed" |
| 5 | Navigate to **Webhook** | Pre-filled OneTrust payload; click "Simulate Revocation" → `kafka_published: true` |
| 6 | Navigate back to **Inference Tester** | Click "Fire /infer/predict" → 🔴 red "Blocked — consent revoked (403)" |
| 7 | Navigate to **Dashboard** | `blocked` counter incremented; audit table shows new block event |
| 8 | Navigate to **Audit Trail** | Full trace: `inference_gate / blocked / revoked` with timestamp |

**Key moment:** Steps 4 → 6 — the audience watches a `200 OK` turn into a `403 Forbidden` after a single webhook call. That's the core demo.

---

## Key Differentiators

| Feature | ConsentFlow | Typical implementation |
|---------|-------------|----------------------|
| Revocation latency | <5 ms (Redis cache hit) | Minutes to hours (batch job) |
| Training enforcement | Kafka → MLflow quarantine tag | None / manual |
| Fail-closed behavior | Yes (infra error → deny) | Often fail-open |
| Audit trail | PostgreSQL + OTel trace link | None |
| Drift monitor integration | Evidently with consent tagging | None |
| Open source | Yes (MIT) | Proprietary CMP SDK |

---

## Judging Criteria Alignment

**Technical innovation:**
- Novel ASGI middleware pattern for real-time consent enforcement
- Kafka-driven cross-gate propagation vs. polling approaches
- Presidio PII scrub integrated directly into MLflow registration gate

**Privacy/compliance relevance:**
- GDPR Article 7(3): right to withdraw consent "without undue delay" → sub-5ms enforcement
- GDPR Article 17: right to erasure → anonymization at dataset gate
- EU AI Act Article 10: data governance requirements → full audit trail per gate decision

**Completeness:**
- End-to-end: from webhook to inference block, with audit trail
- Full dashboard UI demonstrating every gate
- Test suite for every gate

**Demo-ability:**
- 2-minute demo script requiring only a web browser
- Demo user pre-seeded (no setup needed)
- Webhook simulator built into the UI

---

## Tech Stack Summary

**Backend:** FastAPI · Python 3.12 · PostgreSQL 16 · Redis 7 · Apache Kafka (Confluent 7.6) · aiokafka · asyncpg · MLflow 2.13 · Microsoft Presidio · spaCy · Evidently AI · OpenTelemetry · Grafana

**Frontend:** Next.js 16 (App Router) · React 19 · TypeScript · TailwindCSS v4 · TanStack Query v5 · Framer Motion · GSAP · Lucide React

**Infrastructure:** Docker Compose (8 services) · OTel Collector · multi-stage Dockerfile

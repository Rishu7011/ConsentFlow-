# ConsentFlow — Prototype Presentation

> **Consent-aware middleware that enforces user revocation at every stage of the AI pipeline.**

---

## 1. The Problem

Modern AI systems collect user consent at the **UI layer** — but ignore it everywhere else.

| Where Consent Is Collected | Where It's Ignored |
|----------------------------|--------------------|
| Website cookie banners     | Feature stores     |
| Consent Management Platforms (CMPs) | Model training pipelines |
| Mobile app permission prompts | Inference endpoints |
| OneTrust workflows         | Drift monitoring windows |

### The Gap

Once data enters a training corpus, model registry, or inference endpoint:
- ❌ Consent revocations are **delayed** or **never propagated**
- ❌ Teams train on **stale personal data** from users who opted out
- ❌ Systems serve **inference to users** who revoked consent
- ❌ Drift windows include **disallowed samples** silently

This creates **legal exposure** (GDPR, CCPA), **governance gaps**, and **broken user trust**.

---

## 2. ConsentFlow — The Solution

ConsentFlow is a **Python middleware layer** that sits between your consent source and every AI pipeline execution point — enforcing revocations in real time, across all stages.

```
  User Revokes Consent
         │
         ▼
  ┌──────────────────────┐
  │  ConsentFlow API      │  ◄─── OneTrust / CMP Webhook
  │  (FastAPI + Redis     │
  │   + PostgreSQL)       │
  └──────────┬───────────┘
             │  Kafka: consent.revoked
             ▼
  ┌──────────────────────────────────────────────────┐
  │         Pipeline Enforcement Gates               │
  │                                                  │
  │  1. Dataset Gate  ──── blocks / anonymizes PII   │
  │  2. Training Gate ──── quarantines MLflow runs   │
  │  3. Inference Gate ─── blocks 403 in real-time   │
  │  4. Drift Monitor ──── flags revoked samples     │
  └──────────────────────────────────────────────────┘
             │
             ▼
  ┌──────────────────────────────────┐
  │  Observability Stack             │
  │  OpenTelemetry → Grafana         │
  │  Audit Trail API                 │
  └──────────────────────────────────┘
```

---

## 3. Architecture Deep Dive

### Core Stack

| Component        | Role |
|------------------|------|
| **FastAPI**      | REST API, ASGI middleware, lifespan management |
| **PostgreSQL**   | Source of truth for consent records + audit log |
| **Redis**        | Low-latency consent cache (60s TTL), hot-path lookups |
| **Kafka**        | Event stream: `consent.revoked` → downstream gates |
| **MLflow**       | Dataset gate artifacts, training run quarantine tags |
| **Presidio**     | PII detection and anonymization in dataset gate |
| **Evidently AI** | Drift detection reports with consent-tagged samples |
| **OpenTelemetry**| Span instrumentation across all gate decisions |
| **Grafana**      | Dashboarding over exported Prometheus metrics |

### Data Flow on Revocation

```
POST /webhook/consent-revoke
    │
    ├─► Upsert consent record in PostgreSQL
    ├─► Invalidate Redis cache key
    └─► Publish to Kafka: consent.revoked
              │
              ├─► Training Gate Consumer
              │     └─► Tag MLflow runs: consent_status=quarantined
              │
              ├─► Inference Gate (ASGI)
              │     └─► Next request → 403 Forbidden
              │
              ├─► Dataset Gate (on next registration)
              │     └─► Anonymize revoked user records via Presidio
              │
              └─► Drift Monitor (on next window)
                    └─► Flag and alert on revoked samples
```

---

## 4. The Four Enforcement Gates

### Gate 1 — Dataset Gate
**Problem:** Datasets registered in MLflow may contain PII for users who've revoked consent.

**How it works:**
1. Iterates every record before dataset registration
2. Resolves consent via Redis → PostgreSQL fallback
3. Granted → passes record unchanged
4. Revoked → runs **Microsoft Presidio** to anonymize PII fields
5. Logs `consented_count`, `anonymized_count`, `anonymized_ratio` to MLflow
6. Saves cleaned dataset as an MLflow artifact

---

### Gate 2 — Training Gate
**Problem:** MLflow model training runs may be mid-flight when a user revokes.

**How it works:**
1. Kafka consumer polls `consent.revoked` topic
2. Searches MLflow for any run tagged with that `user_id`
3. Tags the run: `consent_status=quarantined`, `revoked_user`, `quarantine_reason`, `quarantine_timestamp`
4. Records a `QuarantineRecord` with Kafka offset metadata for auditability

---

### Gate 3 — Inference Gate
**Problem:** Live inference endpoints serve predictions to users who may have revoked consent.

**How it works:**
1. Mounted as ASGI middleware on the `/infer` prefix
2. Resolves `user_id` from `X-User-ID` header → JSON body fallback
3. **Fail-closed semantics:**
   - Missing user → `400 Bad Request`
   - Revoked consent → `403 Forbidden`
   - Service unavailable → `503 Service Unavailable`
4. Granted → proxies request to handler

> Also ships a **LangChain callback variant** (`langchain_gate.py`) for LLM pipelines.

---

### Gate 4 — Drift Monitor
**Problem:** Evidently drift monitoring windows silently use data from revoked users.

**How it works:**
1. Tags each sample in the monitoring window with `_consent_status`
2. Runs Evidently `DataDriftPreset` analysis
3. Scans window for revoked samples and emits `DriftAlert` objects
4. **Severity levels:** `warning` (< 5 revoked) / `critical` (≥ 5 revoked)
5. Returns `DriftCheckResult`: tagged DataFrame, alert list, consent counts

---

## 5. API Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/health` | Liveness check: Postgres + Redis |
| `POST` | `/users` | Register a new user (returns UUID for consent requests) |
| `GET`  | `/users/{user_id}` | Look up a user by UUID |
| `POST` | `/consent` | Upsert a consent record |
| `POST` | `/consent/revoke` | Revoke all consent for a user + purpose |
| `GET`  | `/consent/{user_id}/{purpose}` | Resolve effective consent status |
| `POST` | `/webhook/consent-revoke` | OneTrust-style ingress (DB + Cache + Kafka) |
| `POST` | `/infer/predict` | Consent-gated dummy inference endpoint |
| `GET`  | `/audit/trail` | Query enforcement audit log |

---

## 6. Live Demo Flow

Run these steps against a live instance (`docker compose up --build`):

> **Tip:** The demo user `550e8400-e29b-41d4-a716-446655440000` is seeded automatically by migration `003`. You can skip step 1 if using that UUID.

**Step 0 — Register a user (needed for any new UUID):**
```bash
curl -X POST http://localhost:8000/users \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com"}'
# → 201: { "id": "<uuid>", ... }
```

**Step 1 — Grant consent:**
```bash
curl -X POST http://localhost:8000/consent \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "data_type": "pii",
    "purpose": "model_training",
    "status": "granted"
  }'
```

**Step 2 — Fire a revocation webhook:**
```bash
curl -X POST http://localhost:8000/webhook/consent-revoke \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "purpose": "model_training",
    "consentStatus": "revoked",
    "timestamp": "2026-04-08T12:00:00Z"
  }'
```

**Step 3 — Inference is now blocked:**
```bash
curl -X POST http://localhost:8000/infer/predict \
  -H "X-User-ID: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"prompt": "hello"}'
# → 403 Forbidden: consent revoked
```

**Step 4 — Check the audit trail:**
```bash
curl "http://localhost:8000/audit/trail?user_id=550e8400-e29b-41d4-a716-446655440000"
```

---

## 7. Observability

All gate decisions emit **OpenTelemetry spans** and write to the **audit_log** database table simultaneously.

| Span Name | Gate |
|-----------|------|
| `dataset_gate.check` | Dataset Gate |
| `inference_gate.check` | Inference Gate |
| `training_gate.quarantine` | Training Gate |
| `monitoring_gate.check` | Drift Monitor |

**Common span attributes:** `gate_name` · `consent_status` · `action_taken` · `user_id` · `trace_id`

### Service URLs (Local)

| Service | URL |
|---------|-----|
| API Docs (Swagger) | http://localhost:8000/docs |
| Grafana Dashboard | http://localhost:3000 |
| Prometheus Metrics | http://localhost:8889/metrics |
| OTel Collector Health | http://localhost:13133 |

---

## 8. Technology Stack Summary

```
Language:       Python 3.12
Framework:      FastAPI 0.115+ / Uvicorn (ASGI)
Database:       PostgreSQL 16 (asyncpg async driver)
Cache:          Redis 7 (hiredis, 60s TTL)
Event Stream:   Apache Kafka (aiokafka async)
ML Tracking:    MLflow 2.13+
PII Scrubbing:  Microsoft Presidio (spaCy NLP backend)
Drift Monitor:  Evidently AI 0.4+
Observability:  OpenTelemetry SDK + OTLP → Grafana
Packaging:      uv + hatchling (pyproject.toml)
Testing:        pytest + pytest-asyncio, 7 test modules
Containerized:  Docker Compose (full stack)
```

---

## 9. Project Structure

```
ConsentFlow-/
├── consentflow/
│   ├── app/                   # FastAPI app, config, DB, Kafka, routers
│   │   └── routers/           # consent, users, webhook, infer, audit
│   ├── migrations/            # SQL schema files (auto-applied at startup)
│   │   ├── 001_init.sql       # users + consent_records schema
│   │   ├── 002_audit_log.sql  # audit_log schema
│   │   └── 003_seed_demo_user.sql  # seeds demo UUID (idempotent)
│   ├── sdk.py                 # Consent lookup: Redis → PostgreSQL
│   ├── dataset_gate.py        # Gate 1: MLflow dataset anonymization
│   ├── training_gate.py       # Gate 2: Kafka consumer → MLflow quarantine
│   ├── inference_gate.py      # Gate 3: ASGI middleware, fail-closed
│   ├── monitoring_gate.py     # Gate 4: Evidently drift wrapper
│   ├── anonymizer.py          # Presidio PII scrubber
│   └── otel_*.py              # OTel instrumentation per gate
├── grafana/                   # Provisioned Grafana dashboards + datasources
├── tests/                     # 7 test modules (unit + integration-style)
├── docker-compose.yml         # Full local stack
├── Dockerfile                 # App container
└── pyproject.toml             # Dependencies + tooling config
```

---

## 10. What Makes ConsentFlow Different

| Approach | Industry Norm | ConsentFlow |
|----------|--------------|-------------|
| Consent enforcement | UI-only (frontend toggle) | Deep pipeline (4 gates) |
| Revocation propagation | Manual / delayed | Real-time via Kafka |
| Inference blocking | Not implemented | ASGI middleware, fail-closed |
| Dataset compliance | Point-in-time snapshot | Per-record consent check |
| Training runs | Not addressed | Quarantine-tagged in MLflow |
| Drift monitoring | Unaware of consent | Revoked-sample alerts + severity |
| Auditability | None / custom logs | Unified audit_log + OTel traces |

---

## 11. Next Steps / Roadmap

- [ ] **Multi-purpose consent** — allow a single user to have different consent states per purpose simultaneously surfaced in a unified dashboard
- [ ] **Frontend Next.js dashboard** — visual consent management, audit trail viewer, webhook simulator, and drift alert panel
- [ ] **Async OTel flush** — batch span export for higher throughput environments
- [ ] **GDPR right-to-erasure flow** — extend dataset gate to hard-delete PII on erasure requests, not just anonymize
- [ ] **REST SDK** — publish `consentflow-sdk` as a standalone pip package for third-party integration
- [ ] **Production hardening** — mTLS for Kafka, Vault integration for secrets, HA Redis/Postgres configs

---

*ConsentFlow v0.2.0 — MIT License — [github.com/Rishu7011/ConsentFlow-](https://github.com/Rishu7011/ConsentFlow-)*

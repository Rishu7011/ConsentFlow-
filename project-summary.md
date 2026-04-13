# ConsentFlow — Project Summary

> **Version:** 0.2.0 | **Status:** Backend complete · Frontend complete (7/7 pages built)

---

## 1. What ConsentFlow Is

ConsentFlow is a Python middleware layer that enforces user consent revocation across an AI pipeline in real time. When a user revokes consent — via a UI, CMP (e.g. OneTrust), or direct API call — ConsentFlow immediately persists the revocation to PostgreSQL, invalidates the Redis cache entry, and broadcasts a `consent.revoked` event over Apache Kafka. Four enforcement gates — dataset, training, inference, and drift monitoring — react to this signal at every stage of the ML lifecycle, ensuring that revoked users' data is never processed after revocation regardless of which pipeline stage is running.

**Tech stack:** FastAPI · PostgreSQL · Redis · Apache Kafka · MLflow · Microsoft Presidio · Evidently AI · OpenTelemetry · Grafana · Next.js 16 (React 19)

---

## 2. Tech Stack

**Backend:**
- FastAPI 0.115+ (Python 3.12)
- PostgreSQL 16 (asyncpg driver)
- Redis 7 (redis[hiredis])
- Apache Kafka / Confluent 7.6 (aiokafka)
- MLflow 2.13+ (experiment tracking + quarantine tags)
- Microsoft Presidio 2.2+ (PII detection & anonymization via spaCy)
- Evidently AI 0.4+ (data drift monitoring)
- OpenTelemetry SDK 1.24+ (distributed tracing, OTLP gRPC)
- Grafana 10.4 (dashboard visualization)
- Docker Compose (full local stack)

**Frontend:**
- Next.js 16.2 (App Router)
- React 19
- TypeScript 5
- TailwindCSS v4
- TanStack Query v5
- Axios
- Framer Motion 12 + GSAP 3
- Lucide React icons

---

## 3. Completed Work Log

### Step 1 — Project bootstrap + FastAPI skeleton
- **Done:** Created `pyproject.toml`, `.env`, Dockerfile, `docker-compose.yml`
- **Produced:** Runnable FastAPI app with `/health` endpoint, asyncpg pool, Redis client lifecycle
- **Key facts:** App version `0.2.0`; Python 3.12 required; `uv` used for dep management

### Step 2 — Consent API + Kafka webhook
- **Done:** Consent CRUD endpoints, Redis caching layer, Kafka producer, webhook ingress
- **Produced:** `routers/consent.py`, `routers/webhook.py`, `cache.py`, `kafka_producer.py`
- **Key facts:** Redis key format `consent:{user_id}:{purpose}`; 60 s TTL; webhook returns 207 on Kafka failure; idempotent upsert

### Step 3 — Dataset Gate (Presidio + MLflow)
- **Done:** Per-record consent check before MLflow registration; PII anonymization
- **Produced:** `dataset_gate.py`, `anonymizer.py`
- **Key facts:** spaCy `en_core_web_lg` model; PII replaced with `<REDACTED>`; GateResult dataclass with consented_count / anonymized_count; logs artifact to MLflow

### Step 4 — Inference Gate (ASGI middleware)
- **Done:** `ConsentMiddleware` as Starlette `BaseHTTPMiddleware` on `/infer` routes; fail-closed
- **Produced:** `inference_gate.py`, `routers/infer.py`
- **Key facts:** User ID from `X-User-ID` header → body fallback; 400 (missing) / 403 (revoked) / 503 (infra error); protected prefix is `["/infer"]`; purpose is `"inference"`

### Step 5 — Training Gate (Kafka consumer)
- **Done:** Async Kafka consumer that quarantines MLflow runs on revocation
- **Produced:** `training_gate.py`, `mlflow_utils.py`
- **Key facts:** Consumer group `consentflow-training-gate`; applies `consent_status=quarantined` tag to every matching MLflow run; does NOT delete/retrain; `QuarantineRecord` dataclass for test introspection

### Step 6 — Monitoring Gate (Evidently AI)
- **Done:** Drift monitor that tags each sample with consent status; fires DriftAlerts
- **Produced:** `monitoring_gate.py`
- **Key facts:** `ConsentAwareDriftMonitor` with injected `consent_fn`; adds `_consent_status` column to DataFrame; severity `warning` (<5 rows), `critical` (≥5 rows); Evidently `DataDriftPreset` strips `_consent_status` before computing drift

### Step 7 — Observability (OTel + Audit log + Dashboard API)
- **Done:** OTel tracer factory; OTel gate wrappers; `audit_log` table; `/audit/trail` endpoint; `/dashboard/stats` endpoint; Grafana provisioning
- **Produced:** `telemetry.py`, `otel_dataset_gate.py`, `otel_inference_gate.py`, `otel_training_gate.py`, `otel_monitoring_gate.py`, `migrations/002_audit_log.sql`, `routers/audit.py`, `routers/dashboard.py`
- **Key facts:** OTel disabled by default (`OTEL_ENABLED=false`); span names follow `{gate_name}.check` pattern; trace ID stored in `audit_log.trace_id` for Grafana Explore linking

### Step 8 — Database seed + users router
- **Done:** Demo user migration; users router with GET/POST/register; `UserListRecord` with derived status
- **Produced:** `migrations/003_seed_demo_user.sql`, `routers/users.py`
- **Key facts:** Demo UUID `550e8400-e29b-41d4-a716-446655440000` always present; `status` derived: active (≥1 granted) / revoked (all revoked) / pending (no consents)

### Step 9 — Next.js 16 frontend
- **Done:** All 7 pages built; Tailwind + custom CSS design system; TanStack Query polling; Axios proxy; sessionStorage user persistence
- **Produced:** `consentflow-frontend/` — full Next.js app with landing, dashboard, users, consent, audit, webhook, infer pages
- **Key facts:** Dev port 3001; proxy routes in `app/api/`; `X-User-ID` auto-attached by Axios interceptor; `active_user_id` persisted in sessionStorage

---

## 4. Files Generated

| File | Description |
|------|-------------|
| `consentflow-backend/consentflow/app/main.py` | FastAPI app factory, lifespan, middleware registration |
| `consentflow-backend/consentflow/app/config.py` | pydantic-settings Settings class |
| `consentflow-backend/consentflow/app/db.py` | asyncpg pool create/close/health |
| `consentflow-backend/consentflow/app/cache.py` | Redis get/set/invalidate helpers |
| `consentflow-backend/consentflow/app/kafka_producer.py` | AIOKafkaProducer lifecycle + publish |
| `consentflow-backend/consentflow/app/models.py` | All Pydantic v2 models |
| `consentflow-backend/consentflow/app/routers/users.py` | User CRUD endpoints |
| `consentflow-backend/consentflow/app/routers/consent.py` | Consent CRUD + cache |
| `consentflow-backend/consentflow/app/routers/webhook.py` | Webhook ingress |
| `consentflow-backend/consentflow/app/routers/infer.py` | Demo inference endpoint |
| `consentflow-backend/consentflow/app/routers/audit.py` | Audit trail endpoint |
| `consentflow-backend/consentflow/app/routers/dashboard.py` | Dashboard metrics endpoint |
| `consentflow-backend/consentflow/sdk.py` | `is_user_consented()` SDK |
| `consentflow-backend/consentflow/anonymizer.py` | Presidio PII masker |
| `consentflow-backend/consentflow/dataset_gate.py` | Gate 1 — dataset consent filter |
| `consentflow-backend/consentflow/training_gate.py` | Gate 2 — Kafka consumer + MLflow quarantine |
| `consentflow-backend/consentflow/inference_gate.py` | Gate 3 — ASGI ConsentMiddleware |
| `consentflow-backend/consentflow/monitoring_gate.py` | Gate 4 — Evidently drift monitor |
| `consentflow-backend/consentflow/langchain_gate.py` | LangChain callback adapter |
| `consentflow-backend/consentflow/mlflow_utils.py` | MLflow run search + tag helpers |
| `consentflow-backend/consentflow/telemetry.py` | OTel tracer factory |
| `consentflow-backend/consentflow/otel_dataset_gate.py` | OTel wrapper for dataset gate |
| `consentflow-backend/consentflow/otel_inference_gate.py` | OTel wrapper + audit insert for inference gate |
| `consentflow-backend/consentflow/otel_training_gate.py` | OTel wrapper for training gate |
| `consentflow-backend/consentflow/otel_monitoring_gate.py` | OTel wrapper for monitoring gate |
| `consentflow-backend/consentflow/migrations/001_init.sql` | users + consent_records schema |
| `consentflow-backend/consentflow/migrations/002_audit_log.sql` | audit_log table |
| `consentflow-backend/consentflow/migrations/003_seed_demo_user.sql` | Demo user seed |
| `consentflow-backend/docker-compose.yml` | Full local stack (8 services) |
| `consentflow-backend/Dockerfile` | App container image |
| `consentflow-backend/otel-collector-config.yaml` | OTel Collector pipeline |
| `consentflow-backend/pyproject.toml` | Dependencies + project metadata |
| `consentflow-frontend/app/page.tsx` | Landing page |
| `consentflow-frontend/app/dashboard/page.tsx` | Dashboard page |
| `consentflow-frontend/app/users/page.tsx` | Users page |
| `consentflow-frontend/app/consent/page.tsx` | Consent Manager page |
| `consentflow-frontend/app/audit/page.tsx` | Audit Trail page |
| `consentflow-frontend/app/webhook/page.tsx` | Webhook Simulator page |
| `consentflow-frontend/app/infer/page.tsx` | Inference Tester page |
| `consentflow-frontend/lib/axios.ts` | Axios singleton + interceptors |
| `consentflow-frontend/hooks/useAuditTrail.ts` | TanStack Query hook |
| `consentflow-frontend/types/api.ts` | TypeScript type definitions (legacy) |

---

## 5. What's Next (Prioritized)

1. **Production hardening** — Change `POSTGRES_PASSWORD` from default; add Redis `REDIS_PASSWORD`; enable `OTEL_ENABLED=true` in production `.env`
2. **Authentication layer** — Add JWT or API key auth; `X-User-ID` is currently unauthenticated
3. **Frontend type extraction** — Move inline TypeScript interfaces from hooks into `types/` directory; enforce strict typing on all API responses
4. **Gate stat live data** — Wire dataset/training/drift gate cards on dashboard to live `audit_log` counts (currently static demo numbers)
5. **Training gate startup** — Wire `run_training_gate_consumer()` into FastAPI lifespan or a side process for automatic Kafka consumption
6. **Trace deep-links** — Link `trace_id` in the audit table to `http://localhost:3000/explore` (Grafana)
7. **Test coverage** — Add integration tests for dashboard router and frontend API proxy routes
8. **spaCy model init** — Document/automate `python -m spacy download en_core_web_lg` in Docker build

---

## 6. Hackathon Demo Script (2 Minutes)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open `http://localhost:3001` | Landing page — animated flow diagram showing 4 gates |
| 2 | Navigate to `/dashboard` | Metrics: users, granted consents, blocked inferences; health widget green |
| 3 | Navigate to `/users` — click "Set as active" on demo user | UUID stored in sessionStorage |
| 4 | Navigate to `/infer` — UUID auto-filled — click "Fire /infer/predict" | ✅ **Green: Inference allowed** |
| 5 | Navigate to `/webhook` — payload pre-filled — click "Simulate Revocation" | ✅ `status: "propagated"`, `kafka_published: true` |
| 6 | Navigate back to `/infer` — click "Fire /infer/predict" again | 🔴 **Red: Blocked — consent revoked (403)** |
| 7 | Navigate to `/dashboard` | `blocked` counter +1; recent audit table shows new `inference_gate / blocked` row |
| 8 | Navigate to `/audit` | Full audit trail with `action_taken: blocked`, `consent_status: revoked`, `gate_name: inference_gate` |

**Core message:** One webhook call propagates across the entire AI pipeline — from DB to cache to Kafka — with sub-second enforcement at the inference layer.

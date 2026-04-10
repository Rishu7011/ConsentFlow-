# ConsentFlow

> Consent-aware middleware that enforces user revocation at every stage of the AI pipeline — training, inference, dataset registration, and drift monitoring.

![Python](https://img.shields.io/badge/python-3.12-blue?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100%2B-009688?logo=fastapi&logoColor=white)
![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white)
![Kafka](https://img.shields.io/badge/kafka-confluent%207.6-231F20?logo=apachekafka&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)
![Build](https://img.shields.io/badge/build-passing-brightgreen)

---

## Table of contents

- [Problem & solution](#problem--solution)
- [Architecture overview](#architecture-overview)
- [Project structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Setup & installation](#setup--installation)
- [Quick demo](#quick-demo)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
- [Consent enforcement pipeline](#consent-enforcement-pipeline)
- [Kafka topics](#kafka-topics)
- [Database schema](#database-schema)
- [Observability](#observability)
- [Running tests](#running-tests)
- [Contributing](#contributing)
- [License](#license)

---

## Problem & solution

Modern AI applications collect consent at the UI layer (website, app, CMP), but downstream data infrastructure typically has no native consent signal. Once data lands in feature stores, training corpora, model registries, or inference paths, consent revocation often becomes a manual, delayed, or missing operation. This creates legal risk, governance gaps, and broken user trust.

The failure mode is systemic: revocation is handled as a frontend concern, while AI pipelines are built as backend/data concerns. In practice, teams can revoke a toggle in UI and still train on stale personal data, serve inferences to users with revoked consent, and compute drift analytics using disallowed samples.

ConsentFlow closes this gap by operating as middleware between consent sources and AI pipeline execution points. It enforces consent during dataset registration, inference, training-quarantine workflows, and monitoring windows — with propagation via Kafka and full observability via OpenTelemetry + Grafana.

---

## Architecture overview

```text
+-----------------------+
| UI / Consent Source   |
| (App / Web / CMP)     |
+-----------+-----------+
            |
            | webhook (OneTrust-style revocation signal)
            v
+-------------------------------+
| ConsentFlow Middleware        |
| - FastAPI API                 |
| - Consent SDK                 |
| - Redis cache (TTL 60s)       |
| - PostgreSQL source of truth  |
| - Kafka producer/consumer     |
+---------------+---------------+
                |
                | consent.revoked (Kafka topic)
                v
+---------------------------------------------+
| Pipeline Enforcement Checkpoints            |
| 1) Dataset Gate  (MLflow artifact + PII)    |
| 2) Training Gate (Kafka -> quarantine tags) |
| 3) Inference Gate (ASGI middleware)         |
| 4) Drift Monitor  (Evidently wrapper)       |
+-------------------+-------------------------+
                    |
                    v
+------------------------------------+
| AI Models                          |
| - Training runs / Model registry   |
| - Inference endpoints              |
+-------------------+----------------+
                    |
                    v
+----------------------------------------------+
| Observability                                |
| - OpenTelemetry spans -> OTel Collector      |
| - Prometheus metrics endpoint                |
| - Grafana dashboards                         |
| - Audit trail API (/audit/trail)             |
+----------------------------------------------+
```

**Component inventory:**

| Component | Role |
|-----------|------|
| `FastAPI` | API layer, app lifespan, middleware, router orchestration |
| `PostgreSQL` | Durable consent records + audit trail + users |
| `Redis` | Low-latency consent read cache (`consent:{user_id}:{purpose}`, TTL 60s) |
| `Kafka` | Revocation event propagation (`consent.revoked`) from webhook to downstream gates |
| `MLflow` | Dataset gate artifacts/metrics and training quarantine tagging |
| `Presidio` | PII detection and anonymization for revoked records in dataset gate |
| `Evidently AI` | Drift report execution in monitoring gate wrapper |
| `OpenTelemetry` | Span instrumentation of all gate decisions |
| `Grafana` | Dashboarding over collector-exported Prometheus metrics |

---

## Project structure

```text
.
├── .env.example                          # Sample environment variables
├── .gitignore                            # VCS ignore rules
├── .python-version                       # Python version pin (3.12)
├── Dockerfile                            # Application container image
├── docker-compose.yml                    # Full local stack (app + infra + observability)
├── otel-collector-config.yaml            # OTel collector pipelines/exporters
├── pyproject.toml                        # Dependencies, tooling, metadata
├── README.md                             # Project documentation
├── uv.lock                               # Fully pinned dependency lockfile
│
├── consentflow/
│   ├── __init__.py                       # Package marker
│   ├── anonymizer.py                     # Presidio-based recursive PII anonymizer
│   ├── dataset_gate.py                   # Consent-aware dataset registration gate
│   ├── inference_gate.py                 # ASGI middleware for inference consent checks
│   ├── langchain_gate.py                 # LangChain callback consent gate
│   ├── mlflow_utils.py                   # MLflow run/model quarantine helper functions
│   ├── monitoring_gate.py                # Consent-aware Evidently drift monitor
│   ├── otel_dataset_gate.py              # OTel wrapper + audit logging for dataset gate
│   ├── otel_inference_gate.py            # OTel wrapper + audit logging for inference decisions
│   ├── otel_monitoring_gate.py           # OTel wrapper + audit logging for drift checks
│   ├── otel_training_gate.py             # OTel wrapper + audit logging for quarantine actions
│   ├── sdk.py                            # Shared consent lookup SDK (Redis -> Postgres fallback)
│   ├── telemetry.py                      # OTel tracer configuration/factory
│   ├── training_gate.py                  # Kafka consumer that quarantines MLflow runs
│   │
│   ├── migrations/
│   │   ├── 001_init.sql                  # users + consent_records schema
│   │   ├── 002_audit_log.sql             # audit_log schema and indexes
│   │   └── 003_seed_demo_user.sql        # idempotent seed of demo user UUID
│   │
│   └── app/
│       ├── __init__.py                   # Package marker
│       ├── cache.py                      # Redis lifecycle + cache helpers
│       ├── config.py                     # Pydantic settings + DSN helpers
│       ├── db.py                         # asyncpg pool lifecycle + health check
│       ├── kafka_producer.py             # Async revocation event producer
│       ├── main.py                       # FastAPI app factory + lifespan + routes
│       ├── models.py                     # Pydantic request/response contracts
│       └── routers/
│           ├── __init__.py               # Router package marker
│           ├── audit.py                  # GET /audit/trail endpoint
│           ├── consent.py                # /consent CRUD endpoints
│           ├── infer.py                  # /infer/predict dummy model endpoint
│           ├── users.py                  # POST /users + GET /users/{id} registration
│           └── webhook.py                # /webhook/consent-revoke ingress
│
├── grafana/
│   ├── dashboards/
│   │   └── consentflow.json              # Provisioned ConsentFlow dashboard
│   └── provisioning/
│       ├── dashboards/
│       │   └── dashboard.yaml            # Dashboard provider config
│       └── datasources/
│           └── prometheus.yaml           # Prometheus datasource config
│
└── tests/
    ├── __init__.py                       # Tests package marker
    ├── conftest.py                       # Shared fakes + ASGI test client
    ├── test_consent.py                   # Consent endpoint unit tests
    ├── test_health.py                    # Health endpoint smoke test
    ├── test_monitoring_gate.py           # Drift monitor unit tests
    ├── test_step3.py                     # Dataset gate integration-style tests
    ├── test_step4.py                     # Inference gate tests
    ├── test_step5.py                     # Training gate + mlflow_utils tests
    └── test_step7.py                     # OTel wrappers + audit API tests
```

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | `3.12+` | Pinned via `.python-version` |
| Docker Engine | latest stable | Tested with images in `docker-compose.yml` |
| Docker Compose | v2 (`docker compose`) | Not legacy `docker-compose` v1 |
| `uv` (optional) | latest | For local non-Docker runs only |
| PostgreSQL (optional) | `16` | Only if running without Docker |
| Redis (optional) | `7` | Only if running without Docker |

---

## Setup & installation

**1. Clone the repository:**

```bash
git clone https://github.com/Rishu7011/ConsentFlow-.git
cd ConsentFlow-
```

**2. Copy and configure environment:**

```bash
cp .env.example .env
```

Edit `.env` with values for your environment. See [Environment variables](#environment-variables) for the full reference.

**3. Start the full stack:**

```bash
docker compose up --build
```

This starts: PostgreSQL, Redis, Zookeeper, Kafka, the ConsentFlow API, OTel Collector, and Grafana. All services have health checks — the app waits for Postgres, Redis, and Kafka to be healthy before starting.

**4. Run migrations:**

Migrations are auto-applied at app startup from `consentflow/migrations/*.sql`. For manual execution:

```bash
psql -U consentflow -d consentflow -f consentflow/migrations/001_init.sql
psql -U consentflow -d consentflow -f consentflow/migrations/002_audit_log.sql
psql -U consentflow -d consentflow -f consentflow/migrations/003_seed_demo_user.sql
```

**5. Verify all services are healthy:**

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{
  "status": "ok",
  "postgres": "ok",
  "redis": "ok"
}
```

**Service URLs:**

| Service | URL |
|---------|-----|
| API (Swagger docs) | http://localhost:8000/docs |
| API (ReDoc docs) | http://localhost:8000/redoc |
| Grafana dashboard | http://localhost:3000 |
| OTel Collector health | http://localhost:13133 |
| Prometheus metrics | http://localhost:8889/metrics |
| Kafka (external) | localhost:29092 |
| Kafka (internal, Docker) | kafka:9092 (container-to-container only) |

---

## Quick demo

Once the stack is running, here is the full revocation propagation flow.

> **Note:** The demo user `550e8400-e29b-41d4-a716-446655440000` is automatically seeded by migration `003_seed_demo_user.sql` — skip step 1 if you are using that UUID.

**1. Register a user (required before any consent record):**

```bash
curl -X POST http://localhost:8000/users \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com"}'
# Response 201: { "id": "<uuid>", "email": "alice@example.com", "created_at": "..." }
```

**2. Grant consent (use the `id` returned above, or the seeded demo UUID):**

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

**3. Fire a revocation webhook (simulates an OneTrust signal):**

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

**4. Try inference — it is now blocked:**

```bash
curl -X POST http://localhost:8000/infer/predict \
  -H "Content-Type: application/json" \
  -H "X-User-ID: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"prompt": "hello"}'

# Response: 403 Forbidden - consent revoked
```

**5. Check the audit trail:**

```bash
curl "http://localhost:8000/audit/trail?user_id=550e8400-e29b-41d4-a716-446655440000"
```

---

## Environment variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `POSTGRES_HOST` | PostgreSQL host | `localhost` (`postgres` in Docker) | Yes |
| `POSTGRES_PORT` | PostgreSQL port | `5432` | Yes |
| `POSTGRES_DB` | PostgreSQL database name | `consentflow` | Yes |
| `POSTGRES_USER` | PostgreSQL user | `consentflow` | Yes |
| `POSTGRES_PASSWORD` | PostgreSQL password | `consentflow` (compose) / `changeme` (.env.example) | Yes |
| `REDIS_HOST` | Redis host | `localhost` (`redis` in Docker) | Yes |
| `REDIS_PORT` | Redis port | `6379` | Yes |
| `REDIS_DB` | Redis database index | `0` | Yes |
| `REDIS_PASSWORD` | Redis password (if auth enabled) | *(empty)* | No |
| `APP_ENV` | Runtime environment label | `development` | Yes |
| `LOG_LEVEL` | App logging verbosity | `INFO` | Yes |
| `CONSENT_CACHE_TTL` | Redis TTL in seconds for consent cache entries | `60` | Yes |
| `KAFKA_BROKER_URL` | Kafka bootstrap server | `localhost:29092` (`kafka:9092` in Docker) | Yes |
| `KAFKA_TOPIC_REVOKE` | Revocation topic name | `consent.revoked` | Yes |
| `OTEL_ENABLED` | Enable OTel SDK/exporter setup | `false` (disabled by default; set `true` in Docker env) | No |
| `OTEL_ENDPOINT` | OTLP gRPC endpoint | `http://localhost:4317` | No |
| `OTEL_SERVICE_NAME` | Service name in OTel resource attributes | `consentflow` | No |

---

## API reference

### `POST /users`

Register a new user. Returns a server-generated UUID that must be used as `user_id` in subsequent consent requests.

**Request body:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `email` | email string | Yes | Must be unique |

```bash
curl -X POST http://localhost:8000/users \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com"}'
```

**Response `201`:**
```json
{
  "id": "<uuid>",
  "email": "alice@example.com",
  "created_at": "2026-04-10T21:00:00Z"
}
```

**Errors:** `409` email already registered · `422` malformed email

---

### `GET /users/{user_id}`

Look up an existing user by UUID.

```bash
curl http://localhost:8000/users/550e8400-e29b-41d4-a716-446655440000
```

**Response `200`:** Same shape as `POST /users` response.

**Errors:** `404` user not found · `422` invalid UUID

---

### `GET /health`

Liveness/health probe for Postgres + Redis.

```bash
curl http://localhost:8000/health
```

**Response `200` (healthy):**
```json
{
  "status": "ok",
  "postgres": "ok",
  "redis": "ok"
}
```

**Response `200` (degraded — one or more services down):**
```json
{
  "status": "degraded",
  "postgres": "error: connection refused",
  "redis": "ok"
}
```

---

### `POST /consent`

Upsert a consent record. Uniqueness enforced on `(user_id, purpose, data_type)`.

**Request body:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `user_id` | UUID string | Yes | Must exist in `users` table |
| `data_type` | string (1–128 chars) | Yes | e.g. `pii`, `behavioral` |
| `purpose` | string (1–256 chars) | Yes | e.g. `analytics`, `model_training`, `inference` |
| `status` | `"granted"` or `"revoked"` | Yes | |

```bash
curl -X POST http://localhost:8000/consent \
  -H "Content-Type: application/json" \
  -d '{
    "user_id":"550e8400-e29b-41d4-a716-446655440000",
    "data_type":"pii",
    "purpose":"analytics",
    "status":"granted"
  }'
```

**Response `200`:**
```json
{
  "id": "...",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "data_type": "pii",
  "purpose": "analytics",
  "status": "granted",
  "updated_at": "2026-04-08T12:00:00Z"
}
```

**Errors:** `404` user not found · `422` validation error (missing/malformed fields, Pydantic) · `500` database error

---

### `POST /consent/revoke`

Revoke all consent rows for a given `user_id + purpose`.

```bash
curl -X POST http://localhost:8000/consent/revoke \
  -H "Content-Type: application/json" \
  -d '{
    "user_id":"550e8400-e29b-41d4-a716-446655440000",
    "purpose":"analytics"
  }'
```

**Response `200`:**
```json
{
  "id": "...",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "data_type": "pii",
  "purpose": "analytics",
  "status": "revoked",
  "updated_at": "2026-04-08T12:00:00Z"
}
```

**Errors:** `404` no matching records · `422` validation error

---

### `GET /consent/{user_id}/{purpose}`

Resolve effective consent status. Checks Redis cache first, falls back to Postgres. The `cached` field tells you which path was used.

```bash
curl http://localhost:8000/consent/550e8400-e29b-41d4-a716-446655440000/analytics
```

**Response `200`:**
```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "purpose": "analytics",
  "status": "granted",
  "updated_at": "2026-04-08T12:00:00Z",
  "cached": true
}
```

**Errors:** `404` no record found · `422` invalid UUID

---

### `POST /webhook/consent-revoke`

OneTrust-style webhook ingress. On receipt: upserts the revocation in Postgres, invalidates the Redis cache key, and publishes a `consent.revoked` event to Kafka.

> **Idempotency:** Duplicate webhooks for the same `user+purpose` are safe. The DB upsert uses `INSERT … ON CONFLICT`, so re-delivery never causes errors or duplicate records.

```bash
curl -X POST http://localhost:8000/webhook/consent-revoke \
  -H "Content-Type: application/json" \
  -d '{
    "userId":"550e8400-e29b-41d4-a716-446655440000",
    "purpose":"model_training",
    "consentStatus":"revoked",
    "timestamp":"2026-04-08T12:00:00Z"
  }'
```

**Response `200`:**
```json
{
  "status": "propagated",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "purpose": "model_training",
  "kafka_published": true,
  "warning": null
}
```

**Response `207`** (partial — DB/cache updated, Kafka failed):
```json
{
  "status": "partial",
  "user_id": "...",
  "purpose": "model_training",
  "kafka_published": false,
  "warning": "Kafka publish failed: ..."
}
```

**Errors:** `207` partial success · `422` non-revoked status, malformed UUID, or missing/malformed fields (Pydantic validation) · `500` DB error

---

### `POST /infer/predict`

Dummy inference endpoint. The entire `/infer` prefix is protected by the ASGI consent middleware. Requests for users with revoked consent are blocked before reaching this handler.

**User identity resolution order:** `X-User-ID` header → `user_id` field in JSON body.

```bash
curl -X POST http://localhost:8000/infer/predict \
  -H "Content-Type: application/json" \
  -H "X-User-ID: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"prompt":"hello"}'
```

**Response `200`:**
```json
{
  "status": "success",
  "message": "Inference completed safely.",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "prediction": "dummy_output"
}
```

| Error code | Reason |
|------------|--------|
| `400` | Missing user identifier (no header or body field) |
| `403` | Consent revoked — inference blocked |
| `503` | Consent service unavailable (fail-closed) |

---

### `GET /audit/trail`

Query consent enforcement audit rows with optional filters. Results are ordered **newest-first** (`event_time DESC`).

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `user_id` | string | — | Filter by user UUID |
| `gate_name` | string | — | e.g. `inference_gate`, `dataset_gate`, `training_gate`, `monitoring_gate` |
| `limit` | integer | `100` | Max rows returned (1–1000) |

```bash
curl "http://localhost:8000/audit/trail?gate_name=inference_gate&limit=50"
curl "http://localhost:8000/audit/trail?user_id=550e8400-e29b-41d4-a716-446655440000"
```

**Response `200`:**
```json
{
  "entries": [
    {
      "id": "...",
      "event_time": "2026-04-08T12:00:01Z",
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "gate_name": "inference_gate",
      "action_taken": "blocked",
      "consent_status": "revoked",
      "purpose": "inference",
      "metadata": {},
      "trace_id": "abc123..."
    }
  ],
  "total": 1
}
```

Valid `action_taken` values logged by the gates: `passed` · `blocked` · `quarantined` · `alerted` · `anonymized`

---

## Consent enforcement pipeline

### 1. Dataset gate (`dataset_gate.py` + `otel_dataset_gate.py`)

Enforces consent before a dataset is registered in MLflow.

**Flow:**
1. Iterate through each record in the dataset.
2. Resolve consent via SDK (`is_user_consented`) for purpose `model_training`.
3. If granted: pass record unchanged.
4. If revoked or user unknown: anonymize record using Presidio (`anonymize_record`).
5. Log MLflow metrics: `total_records`, `consented_count`, `anonymized_count`, `anonymized_ratio`.
6. Persist cleaned dataset as artifact: `dataset_gate/<run_id>_cleaned_dataset.json`.
7. OTel wrapper emits a `dataset_gate.check` span and appends an `audit_log` row.

---

### 2. Training gate (`training_gate.py` + `otel_training_gate.py`)

Kafka consumer that quarantines MLflow training runs when consent is revoked.

> **Note:** The training gate runs as a **standalone consumer process**, separate from the FastAPI app server. Run it with:
> ```bash
> python -m consentflow.training_gate
> ```
> Or call `run_training_gate_consumer()` from your own application startup code.

**Flow:**
1. Consume events from `consent.revoked` topic.
2. Parse event and extract `user_id`.
3. Find impacted MLflow runs via `search_runs_by_user`.
4. Apply quarantine tags to each run: `consent_status=quarantined`, `revoked_user`, reason, timestamp, step.
5. Record `QuarantineRecord` with Kafka metadata (`offset`, `partition`).
6. OTel wrapper emits a `training_gate.quarantine` span and optional audit row.

---

### 3. Inference gate (`inference_gate.py` + `langchain_gate.py`)

ASGI middleware that blocks inference requests for users with revoked consent.

**Flow:**
1. Match protected route prefix (default: `/infer`).
2. Resolve `user_id` from `X-User-ID` header, then JSON body fallback.
3. Query consent for purpose `inference`.
4. Enforce fail-closed semantics: missing user → `400`, revoked → `403`, service down → `503`.
5. If granted: forward request to handler.

`langchain_gate.py` provides the same enforcement as a LangChain callback for LLM pipelines.

---

### 4. Drift monitor (`monitoring_gate.py` + `otel_monitoring_gate.py`)

Consent-aware wrapper around Evidently AI drift detection.

**Flow:**
1. Tag each monitoring sample with `_consent_status` (`granted` or `revoked`).
2. Optionally run Evidently `DataDriftPreset`.
3. Scan the window for revoked samples and emit a structured `DriftAlert` per revoked user.
4. Severity: `warning` (revoked count < threshold) or `critical` (>= threshold, default 5).
5. Return `DriftCheckResult` containing tagged dataframe, alerts, and counts.
6. OTel wrapper emits a `monitoring_gate.check` span and optional audit row.

---

## Kafka topics

| Topic | Purpose | Producer | Consumer |
|-------|---------|----------|----------|
| `consent.revoked` | Propagate revocation events to downstream pipeline checkpoints | `publish_revocation` in `app/kafka_producer.py` | `TrainingGateConsumer` in `training_gate.py` |

**Message schema:**
```json
{
  "event": "consent.revoked",
  "user_id": "<uuid>",
  "purpose": "<string>",
  "timestamp": "<iso8601>"
}
```

**Topic config:** 1 partition · replication factor 1 · auto-created at startup · internal: `kafka:9092` · external: `localhost:29092`

---

## Database schema

### `users`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PK, default `gen_random_uuid()` |
| `email` | `TEXT` | `NOT NULL`, `UNIQUE` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL`, default `NOW()` |

### `consent_records`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PK, default `gen_random_uuid()` |
| `user_id` | `UUID` | FK → `users(id)`, `ON DELETE CASCADE`, `NOT NULL` |
| `data_type` | `TEXT` | `NOT NULL` |
| `purpose` | `TEXT` | `NOT NULL` |
| `status` | `TEXT` | `NOT NULL`, check in `('granted', 'revoked')` |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL`, default `NOW()` |

Indexes: unique `(user_id, purpose, data_type)` · query index `(user_id, purpose, status)`

### `audit_log`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PK, default `gen_random_uuid()` |
| `event_time` | `TIMESTAMPTZ` | `NOT NULL`, default `NOW()` |
| `user_id` | `TEXT` | `NOT NULL` |
| `gate_name` | `TEXT` | `NOT NULL` |
| `action_taken` | `TEXT` | `NOT NULL` |
| `consent_status` | `TEXT` | `NOT NULL` |
| `purpose` | `TEXT` | nullable |
| `metadata` | `JSONB` | nullable |
| `trace_id` | `TEXT` | nullable |

Indexes: `idx_audit_log_user_id` · `idx_audit_log_event_time DESC` · `idx_audit_log_gate_name`

**Design decisions:**

`consent_records` uses state-upsert semantics (latest state per unique triple `user_id + purpose + data_type`). This optimizes the hot path — every gate lookup hits a single row rather than scanning an event stream.

`audit_log` is intentionally append-only and denormalized (`user_id` stored as `TEXT` to support aggregate/non-UUID contexts). It is the canonical record of what each gate did and when, and correlates with OTel traces via `trace_id`.

---

## Observability

**Access points:**

| Endpoint | URL |
|----------|-----|
| Grafana dashboard | http://localhost:3000 |
| OTel Collector OTLP gRPC | `localhost:4317` |
| OTel Collector OTLP HTTP | `localhost:4318` |
| Prometheus scrape endpoint | http://localhost:8889/metrics |
| OTel Collector health | http://localhost:13133 |
| Audit trail API | `GET /audit/trail` |

Grafana uses anonymous access in development (no login required). Provisioned dashboard: `ConsentFlow Observability` (uid: `consentflow-observability`).

**OpenTelemetry span names:**

| Span name | Gate |
|-----------|------|
| `dataset_gate.check` | Dataset gate |
| `inference_gate.check` | Inference gate |
| `training_gate.quarantine` | Training gate |
| `monitoring_gate.check` | Drift monitor |

**Common span attributes:** `gate_name` · `consent_status` · `action_taken` · `user_id` · `trace_id` (correlates to `audit_log.trace_id`)

---

## Running tests

```bash
# Full suite
uv run pytest

# With coverage
uv run pytest --cov=consentflow --cov-report=term-missing

# Specific modules
uv run pytest tests/test_consent.py        # consent endpoints
uv run pytest tests/test_step3.py          # dataset gate
uv run pytest tests/test_step4.py          # inference gate
uv run pytest tests/test_step5.py          # training gate + mlflow_utils
uv run pytest tests/test_monitoring_gate.py # drift monitor
uv run pytest tests/test_step7.py          # OTel wrappers + audit API
```

| Test file | What it covers |
|-----------|----------------|
| `test_health.py` | `/health` smoke test |
| `test_consent.py` | `/consent` CRUD, revoke endpoint, cache behavior |
| `test_step3.py` | Dataset gate anonymization (granted vs revoked records) |
| `test_step4.py` | Inference gate ASGI middleware (allow, block, missing user, fail-closed) |
| `test_step5.py` | Training gate Kafka event quarantine flow + MLflow helper behavior |
| `test_monitoring_gate.py` | Drift monitor alert semantics, severity thresholds, edge cases |
| `test_step7.py` | OTel wrapper span attributes + audit trail API response shape |

---

## Contributing

**1.** Fork the repo and create a feature branch from `main`:

```bash
git checkout -b feat/your-feature-name
```

**2.** Make your changes with tests and verify the suite passes:

```bash
uv run pytest
```

**3.** Open a pull request with a clear description of what changed and why.

**Branch naming:**

| Prefix | Use for |
|--------|---------|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `refactor/` | Code changes without behavior change |
| `test/` | Test additions or fixes |

---

## License

MIT — see [LICENSE](LICENSE) for details.
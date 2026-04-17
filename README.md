# ConsentFlow

> **Real-time consent enforcement across your entire AI pipeline.**

[![Python](https://img.shields.io/badge/Python-3.12-blue)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green)](https://fastapi.tiangolo.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

ConsentFlow is a middleware layer that enforces user consent revocation across an AI pipeline in real time. When a user revokes consent, ConsentFlow propagates the revocation instantly — from API to cache to event bus to every gate in your ML lifecycle.

---

## What it does

A user revokes consent once — via your CMP, UI, or API call. ConsentFlow:

1. **Writes** the revocation to PostgreSQL (authoritative store)
2. **Invalidates** the Redis cache entry for that user+purpose
3. **Publishes** a `consent.revoked` event to Apache Kafka
4. **Enforces** the revocation at five gates in your AI pipeline:

| Gate | Layer | Enforcement |
|------|-------|-------------|
| **Dataset gate** | Data prep | Anonymizes revoked users' PII before MLflow registration |
| **Training gate** | Model training | Quarantines in-flight MLflow runs via Kafka event |
| **Inference gate** | Live serving | ASGI middleware returns 403 in <5 ms (Redis cache hit) |
| **Drift monitor** | Monitoring | Flags revoked-user samples in Evidently drift windows |
| **Policy Auditor** | Compliance | Scans external AI plugin Terms of Service for bypass clauses via LLM |

---

## Architecture

```
User revokes consent
        │
        ▼
POST /webhook/consent-revoke
        │
        ├─► PostgreSQL  (authoritative record)
        ├─► Redis       (invalidate cache)
        └─► Kafka       (consent.revoked event)
                │
                ├─► Dataset Gate   (Presidio PII scrub)
                ├─► Training Gate  (MLflow quarantine tag)
                ├─► Inference Gate (403 Forbidden)
                ├─► Drift Monitor  (severity-graded alert)
                └─► Policy Auditor (LLM ToS scanning + DB log)
```

The Next.js dashboard provides a visual interface to manage users, consent records, the audit trail, and test the enforcement gates interactively.

---

## Quick Start

### Prerequisites

- Docker + Docker Compose
- Node.js 20+ (for the frontend)

### 1. Clone and configure

```bash
git clone https://github.com/Rishu7011/ConsentFlow-
cd ConsentFlow-/consentflow-backend
cp .env.example .env

# Windows (PowerShell)
copy .env.example .env
```

Edit `.env` with values for your environment. See [Environment variables](#environment-variables) for the full reference.

**3. (Apple Silicon only) Add platform pin to `docker-compose.yml`:**

If you are on an M1 / M2 / M3 Mac, the Confluent Kafka and Zookeeper images need an explicit platform tag to avoid Rosetta emulation instability. Add `platform: linux/amd64` to both services:

```yaml
zookeeper:
  image: confluentinc/cp-zookeeper:7.6.0
  platform: linux/amd64   # ← add this line
  ...

kafka:
  image: confluentinc/cp-kafka:7.6.0
  platform: linux/amd64   # ← add this line
  ...
```

See [Platform notes](#platform-notes-mac--apple-silicon) for full details.

**4. Start the full stack:**

```bash
docker compose up --build
```

This starts: PostgreSQL, Redis, Zookeeper, Kafka, the ConsentFlow API, OTel Collector, and Grafana. All services have health checks — the app waits for Postgres, Redis, and Kafka to be healthy before starting.

**5. Run migrations:**

Migrations are auto-applied at app startup from `consentflow/migrations/*.sql`. For manual execution:

```bash
psql -U consentflow -d consentflow -f consentflow/migrations/001_init.sql
psql -U consentflow -d consentflow -f consentflow/migrations/002_audit_log.sql
psql -U consentflow -d consentflow -f consentflow/migrations/003_seed_demo_user.sql
```

**6. Verify all services are healthy:**

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

## Platform notes (Mac / Apple Silicon)

The project is Docker-first and works on macOS with **no code changes**. The notes below cover platform-specific gotchas.

### Docker Desktop for Mac

Install [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/). Make sure you are using **Docker Compose v2** (bundled with Docker Desktop ≥ 4.x) — use `docker compose` (space), not the legacy `docker-compose` (hyphen).

### Apple Silicon (M1 / M2 / M3) — Confluent image fix

The Confluent Platform images (`cp-zookeeper`, `cp-kafka`) are published for `linux/amd64` only. They work on Apple Silicon via Rosetta 2 emulation, but **may fail to start or run slowly** without the explicit platform pin.

Add `platform: linux/amd64` to the `zookeeper` and `kafka` services in `docker-compose.yml`:

```yaml
zookeeper:
  image: confluentinc/cp-zookeeper:7.6.0
  platform: linux/amd64
  container_name: consentflow-zookeeper
  ...

kafka:
  image: confluentinc/cp-kafka:7.6.0
  platform: linux/amd64
  container_name: consentflow-kafka
  ...
```

All other images (`postgres:16`, `redis:7`, `grafana/grafana`, `otel/opentelemetry-collector-contrib`) ship multi-arch manifests and run natively on Apple Silicon.

### Installing `uv` on Mac (local dev only)

If you want to run the app or tests **outside Docker**, install `uv` first:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Then install dependencies and the spaCy NLP model:

```bash
uv sync
uv run python -m spacy download en_core_web_lg
```

### Port conflicts on Mac

macOS Monterey and later reserves port `5000` (AirPlay Receiver) and `7000` (AirPlay). ConsentFlow uses `5432`, `6379`, `8000`, `3000`, `29092`, `4317`, `4318`, `8889`, and `13133` — **none of these conflict** with system-reserved Mac ports.

### `curl` on Mac

All `curl` commands in this README work as-is on macOS. Mac ships `curl` by default.

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

**6. Try the Gate 05 Policy Auditor:**

```bash
curl -X POST http://localhost:8000/policy/scan \
  -H "Content-Type: application/json" \
  -d '{
    "integration_name": "Test AI",
    "policy_text": "We may use your data to train our AI models."
  }'
# Response 201: Overall risk level "critical", 1 finding
```

**7. Launch the frontend dashboard:**

```bash
cd consentflow-frontend
npm install
npm run dev
```

Open http://localhost:3000 to view the dashboard.

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
| `ANTHROPIC_API_KEY` | Anthropic API key for Gate 05 ToS scanner | *(empty)* | Yes (for Gate 05) |
| `NEXT_PUBLIC_API_URL` | Backend URL for frontend | `http://localhost:8000` | No |

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

### `GET /dashboard/stats`

Returns aggregated metrics for the dashboard UI.

**Response `200`:**
```json
{
  "users": 150,
  "granted": 342,
  "blocked": 137,
  "purposes": {
    "analytics": 89,
    "inference": 156,
    "model_training": 45,
    "pii": 52
  },
  "checks_24h_total": 1247,
  "checks_24h_allowed": 1110,
  "checks_24h_blocked": 137,
  "checks_sparkline": [12, 45, 67, 89, 34, 56, 78, 23, 45, 67, 89, 12, 34, 56, 78, 90, 12, 34, 56, 78, 34, 56, 78, 90]
}
```

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
| Prometheus metrics | http://localhost:8889/metrics |
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
uv run pytest tests/test_policy_auditor.py # Gate 05 LLM policy logic
uv run pytest tests/test_gate05_e2e.py     # Gate 05 E2E (I/O mocked)
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
| `test_policy_auditor.py` | Gate 05 ToS scan logic, LLM findings validation, URL fetch |
| `test_gate05_e2e.py` | Full Gate 05 API + DB pipeline execution without live services |

---

## Frontend

ConsentFlow includes a **Next.js 14 dashboard** for interactive consent management and monitoring.

### Pages

| Page | Route | Purpose |
|------|-------|---------|
| Landing | `/` | Marketing page with animated architecture diagram |
| Dashboard | `/dashboard` | Live metrics, health status, recent audit events |
| Users | `/users` | User registration and UUID lookup |
| Consent | `/consent` | Grant/revoke consent, view consent matrix |
| Audit | `/audit` | Full audit trail with filtering and detail drawer |
| Webhook | `/webhook` | OneTrust-style webhook simulator |
| Inference | `/infer` | Live test of the ConsentMiddleware gate |
| Policy | `/policy` | Gate 05 — LLM-powered Terms of Service auditor |

### Running the Frontend

```bash
cd consentflow-frontend
npm install
npm run dev
```

The dashboard will be available at **http://localhost:3000**.

**Prerequisites:** FastAPI backend must be running on `localhost:8000`.

### Frontend Architecture

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Vanilla CSS with CSS variables
- **State:** TanStack Query v5 (React Query)
- **HTTP:** Axios with interceptors
- **Animations:** Framer Motion + GSAP

### API Proxy Pattern

All frontend API calls go through Next.js API route proxies at `/api/*` to avoid CORS issues. The proxies forward requests to the FastAPI backend at `localhost:8000`.

| Frontend Path | Proxies To |
|---------------|------------|
| `GET /api/health` | `GET /health` |
| `GET /api/dashboard-stats` | `GET /dashboard/stats` |
| `POST /api/users` | `POST /users` |
| `GET /api/users/{id}` | `GET /users/{id}` |
| `GET /api/consent` | `GET /consent` |
| `POST /api/consent` | `POST /consent` |
| `POST /api/consent/revoke` | `POST /consent/revoke` |
| `GET /api/audit` | `GET /audit/trail` |
| `POST /api/webhook` | `POST /webhook/consent-revoke` |
| `POST /api/infer` | `POST /infer/predict` |
| `POST /api/policy` | `POST /policy/scan` |
| `GET /api/policy` | `GET /policy/scans` |

### Cross-Page State

The frontend uses `sessionStorage.active_user_id` to persist the current user UUID across pages:
- Set when a user is registered or looked up
- Read to pre-fill forms on Consent, Webhook, and Inference pages
- Attached as `X-User-ID` header on every API call via Axios interceptor

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

# ConsentFlow

Consent-aware middleware for AI pipelines.

Python
FastAPI
Docker
License: MIT
Build Status

## Table of contents

- [Problem  solution](#problem--solution)
- [Architecture overview](#architecture-overview)
- [Project structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Setup  installation](#setup--installation)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
- [Consent enforcement pipeline](#consent-enforcement-pipeline)
- [Kafka topics](#kafka-topics)
- [Database schema](#database-schema)
- [Observability](#observability)
- [Running tests](#running-tests)
- [Contributing](#contributing)
- [License](#license)

## Problem & solution

Modern AI applications collect consent at the UI layer (website, app, CMP), but downstream data infrastructure typically has no native consent signal. Once data lands in feature stores, training corpora, model registries, or inference paths, consent revocation often becomes a manual, delayed, or missing operation. This creates legal risk, governance gaps, and broken user trust.

The failure mode is systemic: revocation is handled as a frontend concern, while AI pipelines are built as backend/data concerns. In practice, teams can revoke a toggle in UI and still train on stale personal data, serve inferences to users with revoked consent, and compute drift analytics using disallowed samples.

ConsentFlow closes this gap by operating as middleware between consent sources and AI pipeline execution points. It enforces consent during dataset registration, inference, training-quarantine workflows, and monitoring windows, with propagation via Kafka and observability via OpenTelemetry + Grafana.

## Architecture overview

```text
+-----------------------+
| UI / Consent Source   |
| (App / Web / CMP)     |
+-----------+-----------+
            |
            v
+-------------------------------+
| ConsentFlow Middleware        |
| - FastAPI API                 |
| - Consent SDK                 |
| - Redis cache                 |
| - PostgreSQL source of truth  |
| - Kafka producer/consumer     |
+---------------+---------------+
                |
                v
+---------------------------------------------+
| Pipeline Enforcement Checkpoints            |
| 1) Dataset Gate (MLflow artifact + metrics) |
| 2) Training Gate (Kafka -> quarantine tags) |
| 3) Inference Gate (ASGI middleware)         |
| 4) Drift Monitor (Evidently wrapper)        |
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

Component inventory:

- `FastAPI`: API layer, app lifespan, middleware, router orchestration.
- `PostgreSQL`: durable consent records (`consent_records`) + audit trail (`audit_log`) + users.
- `Redis`: low-latency consent read cache (`consent:{user_id}:{purpose}`).
- `Kafka`: revocation event propagation (`consent.revoked`) from webhook to downstream gates.
- `MLflow`: dataset gate artifacts/metrics and training quarantine tagging.
- `Presidio`: PII detection and anonymization for revoked records in dataset gate.
- `Evidently AI`: drift report execution in monitoring gate wrapper.
- `OpenTelemetry`: span instrumentation of gate decisions.
- `Grafana`: dashboarding over collector-exported Prometheus metrics.

## Project structure

```text
.
├── .env.example                                # Sample environment variables
├── .gitignore                                  # VCS ignore rules
├── .python-version                             # Python version pin (3.12)
├── Dockerfile                                  # Application container image
├── docker-compose.yml                          # Full local stack (app + infra + observability)
├── otel-collector-config.yaml                  # OTel collector pipelines/exporters
├── pyproject.toml                              # Dependencies, tooling, metadata
├── README.md                                   # Project documentation
├── uv.lock                                     # Fully pinned dependency lockfile
├── consentflow/
│   ├── __init__.py                             # Package marker
│   ├── anonymizer.py                           # Presidio-based recursive PII anonymizer
│   ├── dataset_gate.py                         # Consent-aware dataset registration gate
│   ├── inference_gate.py                       # ASGI middleware for inference consent checks
│   ├── langchain_gate.py                       # LangChain callback consent gate
│   ├── mlflow_utils.py                         # MLflow run/model quarantine helper functions
│   ├── monitoring_gate.py                      # Consent-aware Evidently drift monitor
│   ├── otel_dataset_gate.py                    # OTel wrapper + audit logging for dataset gate
│   ├── otel_inference_gate.py                  # OTel wrapper + audit logging for inference decisions
│   ├── otel_monitoring_gate.py                 # OTel wrapper + audit logging for drift checks
│   ├── otel_training_gate.py                   # OTel wrapper + audit logging for quarantine actions
│   ├── sdk.py                                  # Shared consent lookup SDK (Redis -> Postgres fallback)
│   ├── telemetry.py                            # OTel tracer configuration/factory
│   ├── training_gate.py                        # Kafka consumer that quarantines MLflow runs
│   ├── migrations/
│   │   ├── 001_init.sql                        # users + consent_records schema
│   │   └── 002_audit_log.sql                   # audit_log schema and indexes
│   └── app/
│       ├── __init__.py                         # Package marker
│       ├── cache.py                            # Redis lifecycle + cache helpers
│       ├── config.py                           # Pydantic settings + DSN helpers
│       ├── db.py                               # asyncpg pool lifecycle + health check
│       ├── kafka_producer.py                   # Async revocation event producer
│       ├── main.py                             # FastAPI app factory + lifespan + routes
│       ├── models.py                           # Pydantic request/response contracts
│       └── routers/
│           ├── __init__.py                     # Router package marker
│           ├── audit.py                        # GET /audit/trail endpoint
│           ├── consent.py                      # /consent CRUD endpoints
│           ├── infer.py                        # /infer/predict dummy model endpoint
│           └── webhook.py                      # /webhook/consent-revoke ingress
├── grafana/
│   ├── dashboards/
│   │   └── consentflow.json                    # Provisioned ConsentFlow dashboard
│   └── provisioning/
│       ├── dashboards/
│       │   └── dashboard.yaml                  # Dashboard provider config
│       └── datasources/
│           └── prometheus.yaml                 # Prometheus datasource config
└── tests/
    ├── __init__.py                             # Tests package marker
    ├── conftest.py                             # Shared fakes + ASGI test client
    ├── test_consent.py                         # Consent endpoint unit tests
    ├── test_health.py                          # Health endpoint smoke test
    ├── test_monitoring_gate.py                 # Drift monitor unit tests
    ├── test_step3.py                           # Dataset gate integration-style test
    ├── test_step4.py                           # Inference gate tests
    ├── test_step5.py                           # Training gate + mlflow_utils tests
    └── test_step7.py                           # OTel wrappers + audit API tests
```

## Prerequisites

- Python `3.12+` (project pin: `3.12`, `requires-python >=3.12`)
- Docker Engine (tested with Docker images in `docker-compose.yml`)
- Docker Compose v2 (`docker compose`)
- Optional for local non-Docker runs:
  - `[uv](https://docs.astral.sh/uv/)` (dependency management)
  - PostgreSQL `16` compatible
  - Redis `7` compatible

## Setup & installation

1. Clone the repository:

```bash
git clone <your-fork-or-origin-url>
cd ConsentFlow
```

1. Copy and configure environment:

```bash
cp .env.example .env
```

Edit `.env` with values for your environment.

1. Start infrastructure and app:

```bash
docker compose up --build
```

1. Run migrations:

Migrations are auto-applied at app startup from `consentflow/migrations/*.sql`.

If you need manual execution:

```bash
psql -U consentflow -d consentflow -f consentflow/migrations/001_init.sql
psql -U consentflow -d consentflow -f consentflow/migrations/002_audit_log.sql
```

1. Verify service health:

```bash
curl http://localhost:8000/health
```

Expected:

```json
{
  "status": "ok",
  "postgres": "ok",
  "redis": "ok"
}
```

Check key UIs:

- API docs: [http://localhost:8000/docs](http://localhost:8000/docs)
- Grafana: [http://localhost:3000](http://localhost:3000)
- OTel collector health: [http://localhost:13133](http://localhost:13133)

## Environment variables


| Variable             | Description                                    | Default                                                    | Required |
| -------------------- | ---------------------------------------------- | ---------------------------------------------------------- | -------- |
| `POSTGRES_HOST`      | PostgreSQL host                                | `localhost` (`postgres` in Docker app service)             | Yes      |
| `POSTGRES_PORT`      | PostgreSQL port                                | `5432`                                                     | Yes      |
| `POSTGRES_DB`        | PostgreSQL database name                       | `consentflow`                                              | Yes      |
| `POSTGRES_USER`      | PostgreSQL user                                | `consentflow`                                              | Yes      |
| `POSTGRES_PASSWORD`  | PostgreSQL password                            | `consentflow` (compose) / `changeme` (`.env.example`)      | Yes      |
| `REDIS_HOST`         | Redis host                                     | `localhost` (`redis` in Docker app service)                | Yes      |
| `REDIS_PORT`         | Redis port                                     | `6379`                                                     | Yes      |
| `REDIS_DB`           | Redis database index                           | `0`                                                        | Yes      |
| `REDIS_PASSWORD`     | Redis password (if auth enabled)               | *empty*                                                    | No       |
| `APP_ENV`            | Runtime environment label                      | `development` (settings) / `production` in compose app env | Yes      |
| `LOG_LEVEL`          | App logging verbosity                          | `INFO`                                                     | Yes      |
| `CONSENT_CACHE_TTL`  | Redis TTL in seconds for consent cache entries | `60`                                                       | Yes      |
| `KAFKA_BROKER_URL`   | Kafka bootstrap server                         | `localhost:29092` (`kafka:9092` in compose app env)        | Yes      |
| `KAFKA_TOPIC_REVOKE` | Revocation topic name                          | `consent.revoked`                                          | Yes      |
| `OTEL_ENABLED`       | Enable OTel SDK/exporter setup                 | `false`                                                    | No       |
| `OTEL_ENDPOINT`      | OTLP gRPC endpoint                             | `http://localhost:4317`                                    | No       |
| `OTEL_SERVICE_NAME`  | Service name in OTel resource attrs            | `consentflow`                                              | No       |


## API reference

### `GET /health`

Description: Liveness/health probe for Postgres + Redis.

Request body schema:

```json
{}
```

Response body schema:

```json
{
  "type": "object",
  "properties": {
    "status": { "type": "string" },
    "postgres": { "type": "string" },
    "redis": { "type": "string" }
  },
  "required": ["status", "postgres", "redis"]
}
```

Example:

```bash
curl http://localhost:8000/health
```

Possible errors:

- `500`: Coming soon

---

### `POST /consent`

Description: Upsert a consent record (`user_id + purpose + data_type` uniqueness).

Request body schema:

```json
{
  "type": "object",
  "properties": {
    "user_id": { "type": "string", "format": "uuid" },
    "data_type": { "type": "string", "minLength": 1, "maxLength": 128 },
    "purpose": { "type": "string", "minLength": 1, "maxLength": 256 },
    "status": { "type": "string", "enum": ["granted", "revoked"] }
  },
  "required": ["user_id", "data_type", "purpose", "status"]
}
```

Response body schema:

```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "user_id": { "type": "string", "format": "uuid" },
    "data_type": { "type": "string" },
    "purpose": { "type": "string" },
    "status": { "type": "string", "enum": ["granted", "revoked"] },
    "updated_at": { "type": "string", "format": "date-time" }
  },
  "required": ["id", "user_id", "data_type", "purpose", "status", "updated_at"]
}
```

Example:

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

Possible errors:

- `404`: user foreign key missing (`User <id> does not exist`)
- `500`: database error
- `422`: validation error

---

### `POST /consent/revoke`

Description: Revoke all consent rows for a given `user_id + purpose`.

Request body schema:

```json
{
  "type": "object",
  "properties": {
    "user_id": { "type": "string", "format": "uuid" },
    "purpose": { "type": "string", "minLength": 1, "maxLength": 256 }
  },
  "required": ["user_id", "purpose"]
}
```

Response body schema: same as `ConsentRecord` (above).

Example:

```bash
curl -X POST http://localhost:8000/consent/revoke \
  -H "Content-Type: application/json" \
  -d '{
    "user_id":"550e8400-e29b-41d4-a716-446655440000",
    "purpose":"analytics"
  }'
```

Possible errors:

- `404`: no matching consent records for `user_id + purpose`
- `422`: validation error

---

### `GET /consent/{user_id}/{purpose}`

Description: Resolve effective consent status (Redis cache first, Postgres fallback).

Request body schema:

```json
{}
```

Response body schema:

```json
{
  "type": "object",
  "properties": {
    "user_id": { "type": "string", "format": "uuid" },
    "purpose": { "type": "string" },
    "status": { "type": "string", "enum": ["granted", "revoked"] },
    "updated_at": { "type": "string", "format": "date-time" },
    "cached": { "type": "boolean" }
  },
  "required": ["user_id", "purpose", "status", "updated_at", "cached"]
}
```

Example:

```bash
curl http://localhost:8000/consent/550e8400-e29b-41d4-a716-446655440000/analytics
```

Possible errors:

- `404`: no consent record found
- `422`: invalid UUID/path validation

---

### `POST /webhook/consent-revoke`

Description: OneTrust-style webhook ingress; upserts revocation, invalidates cache, publishes Kafka event.

Request body schema:

```json
{
  "type": "object",
  "properties": {
    "userId": { "type": "string", "format": "uuid" },
    "purpose": { "type": "string", "minLength": 1, "maxLength": 256 },
    "consentStatus": { "type": "string", "const": "revoked" },
    "timestamp": { "type": "string", "format": "date-time" }
  },
  "required": ["userId", "purpose", "consentStatus", "timestamp"]
}
```

Response body schema:

```json
{
  "type": "object",
  "properties": {
    "status": { "type": "string", "enum": ["propagated", "partial"] },
    "user_id": { "type": "string", "format": "uuid" },
    "purpose": { "type": "string" },
    "kafka_published": { "type": "boolean" },
    "warning": { "type": ["string", "null"] }
  },
  "required": ["status", "user_id", "purpose", "kafka_published"]
}
```

Example:

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

Possible errors:

- `207`: partial success (DB/cache updated, Kafka publish failed)
- `422`: invalid payload (non-revoked status, malformed UUID, validation)
- `500`: DB error while applying revocation

---

### `POST /infer/predict`

Description: Dummy inference endpoint protected by consent middleware on `/infer` prefix.

Request body schema:

```json
{
  "type": "object",
  "properties": {
    "user_id": { "type": "string", "format": "uuid" }
  },
  "additionalProperties": true
}
```

Header alternative:

```http
X-User-ID: <uuid>
```

Response body schema:

```json
{
  "type": "object",
  "properties": {
    "status": { "type": "string" },
    "message": { "type": "string" },
    "user_id": { "type": ["string", "null"] },
    "prediction": { "type": "string" }
  },
  "required": ["status", "message", "user_id", "prediction"]
}
```

Example:

```bash
curl -X POST http://localhost:8000/infer/predict \
  -H "Content-Type: application/json" \
  -H "X-User-ID: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"prompt":"hello"}'
```

Possible errors:

- `400`: missing user identifier (header/body absent)
- `403`: consent revoked
- `503`: consent service unavailable (fail-closed)

---

### `GET /audit/trail`

Description: Query consent enforcement audit rows, with optional filters.

Query parameters:

- `user_id` (optional string)
- `gate_name` (optional string)
- `limit` (optional integer, default `100`, min `1`, max `1000`)

Request body schema:

```json
{}
```

Response body schema:

```json
{
  "type": "object",
  "properties": {
    "entries": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string", "format": "uuid" },
          "event_time": { "type": "string", "format": "date-time" },
          "user_id": { "type": "string" },
          "gate_name": { "type": "string" },
          "action_taken": { "type": "string" },
          "consent_status": { "type": "string" },
          "purpose": { "type": ["string", "null"] },
          "metadata": { "type": ["object", "null"] },
          "trace_id": { "type": ["string", "null"] }
        },
        "required": [
          "id", "event_time", "user_id", "gate_name",
          "action_taken", "consent_status", "purpose", "metadata", "trace_id"
        ]
      }
    },
    "total": { "type": "integer" }
  },
  "required": ["entries", "total"]
}
```

Example:

```bash
curl "http://localhost:8000/audit/trail?gate_name=inference_gate&limit=50"
```

Possible errors:

- `422`: query validation error
- `500`: Coming soon

## Consent enforcement pipeline

### Dataset gate (MLflow hook)

Implemented in `consentflow/dataset_gate.py`, with OTel wrapper in `consentflow/otel_dataset_gate.py`.

Flow:

1. Iterate through each dataset record.
2. Resolve consent via SDK (`is_user_consented`) for purpose `model_training` by default.
3. If granted: pass record unchanged.
4. If revoked/missing user: anonymize record with Presidio (`anonymize_record`).
5. Log MLflow metrics (`total_records`, `consented_count`, `anonymized_count`, `anonymized_ratio`).
6. Persist cleaned dataset artifact under `dataset_gate/<run_id>_cleaned_dataset.json`.
7. (OTel wrapper) emit span and optionally append an `audit_log` row.

### Training gate (Kafka consumer)

Implemented in `consentflow/training_gate.py`, with OTel wrapper in `consentflow/otel_training_gate.py`.

Flow:

1. Consume `consent.revoked` events.
2. Parse event and extract `user_id`.
3. Find impacted MLflow runs via `search_runs_by_user`.
4. Apply quarantine tags to each run (`consent_status=quarantined`, `revoked_user`, reason, timestamp, step).
5. Record `QuarantineRecord` with Kafka metadata (`offset`, `partition`).
6. (OTel wrapper) emit `training_gate.quarantine` span and optional audit row.

### Inference gate (middleware/callback)

Implemented in `consentflow/inference_gate.py` (ASGI middleware) and `consentflow/langchain_gate.py` (LangChain callback).

Flow:

1. Match protected route prefix (default `/infer`).
2. Resolve `user_id` from `X-User-ID` header, then JSON body fallback.
3. Query consent for purpose `inference`.
4. Enforce fail-closed semantics:
  - missing user -> `400`
  - revoked -> `403`
  - consent service error -> `503`
5. If granted: forward request to handler.
6. (OTel helper available in `otel_inference_gate.py`) log span + optional audit row.

### Drift monitor (Evidently AI integration)

Implemented in `consentflow/monitoring_gate.py`, with OTel wrapper in `consentflow/otel_monitoring_gate.py`.

Flow:

1. Tag each monitoring sample with `_consent_status` (`granted`/`revoked`).
2. Optionally run Evidently `DataDriftPreset` (skippable in tests).
3. Scan window for revoked samples and emit structured `DriftAlert` per revoked user.
4. Severity:
  - `warning`: revoked rows < threshold
  - `critical`: revoked rows >= threshold (default threshold `5`)
5. Return `DriftCheckResult` containing tagged dataframe, alerts, counts.
6. (OTel wrapper) emit span and optional audit row.

## Kafka topics


| Topic             | Purpose                                                        | Message schema                                                                                | Producer                                                                                           | Consumer                                                 |
| ----------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `consent.revoked` | Propagate revocation events to downstream pipeline checkpoints | `{"event":"consent.revoked","user_id":"<uuid>","purpose":"<string>","timestamp":"<iso8601>"}` | `publish_revocation` in `consentflow/app/kafka_producer.py` (invoked by `/webhook/consent-revoke`) | `TrainingGateConsumer` in `consentflow/training_gate.py` |


## Database schema

### `users`


| Column       | Type          | Constraints                     |
| ------------ | ------------- | ------------------------------- |
| `id`         | `UUID`        | PK, default `gen_random_uuid()` |
| `email`      | `TEXT`        | `NOT NULL`, `UNIQUE`            |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL`, default `NOW()`     |


### `consent_records`


| Column       | Type          | Constraints                                        |
| ------------ | ------------- | -------------------------------------------------- |
| `id`         | `UUID`        | PK, default `gen_random_uuid()`                    |
| `user_id`    | `UUID`        | FK -> `users(id)`, `ON DELETE CASCADE`, `NOT NULL` |
| `data_type`  | `TEXT`        | `NOT NULL`                                         |
| `purpose`    | `TEXT`        | `NOT NULL`                                         |
| `status`     | `TEXT`        | `NOT NULL`, check in `('granted','revoked')`       |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL`, default `NOW()`                        |


Indexes:

- Unique: `(user_id, purpose, data_type)`
- Query index: `(user_id, purpose, status)`

### `audit_log`


| Column           | Type          | Constraints                     |
| ---------------- | ------------- | ------------------------------- |
| `id`             | `UUID`        | PK, default `gen_random_uuid()` |
| `event_time`     | `TIMESTAMPTZ` | `NOT NULL`, default `NOW()`     |
| `user_id`        | `TEXT`        | `NOT NULL`                      |
| `gate_name`      | `TEXT`        | `NOT NULL`                      |
| `action_taken`   | `TEXT`        | `NOT NULL`                      |
| `consent_status` | `TEXT`        | `NOT NULL`                      |
| `purpose`        | `TEXT`        | nullable                        |
| `metadata`       | `JSONB`       | nullable                        |
| `trace_id`       | `TEXT`        | nullable                        |


Indexes:

- `idx_audit_log_user_id`
- `idx_audit_log_event_time` (`DESC`)
- `idx_audit_log_gate_name`

Relationships:

- `consent_records.user_id -> users.id` (FK)
- `audit_log` is intentionally denormalized (`user_id` stored as `TEXT` to support aggregate/non-UUID contexts)

Append-only consent events design decision:

- Current implementation is **state-upsert** in `consent_records` (latest state per unique triple), not an append-only consent event ledger.
- `audit_log` is append-only for gate actions, but not a canonical consent-event stream.
- Full append-only consent-event table: **Coming soon**.

## Observability

Access points:

- Grafana: [http://localhost:3000](http://localhost:3000)
- OTel Collector OTLP gRPC: `localhost:4317`
- OTel Collector Prometheus scrape endpoint: `localhost:8889/metrics`
- OTel Collector health check: [http://localhost:13133](http://localhost:13133)
- Audit API: `GET /audit/trail`

Provisioned Grafana dashboard:

- `ConsentFlow Observability` (`uid: consentflow-observability`)

Current tracked metrics/panels include:

- OTel spans accepted rate
- OTel spans exported rate
- accepted spans by transport (activity proxy)
- refused spans rate
- exporter queue size
- processor batch send rate

OpenTelemetry trace structure:

- Span names:
  - `dataset_gate.check`
  - `inference_gate.check`
  - `training_gate.quarantine`
  - `monitoring_gate.check`
- Common attributes:
  - `gate_name`
  - `consent_status`
  - `action_taken`
  - gate-specific context (`user_id`, `path`, `run_id`, counts, window bounds)
- Trace IDs can be persisted in `audit_log.trace_id` for correlation.

Grafana trace exploration integration details (Tempo/Jaeger backend wiring): **Coming soon**.

## Running tests

Run full suite:

```bash
uv run pytest
```

Run specific test modules:

```bash
uv run pytest tests/test_consent.py
uv run pytest tests/test_step7.py
```

What is covered:

- REST API behavior (`/health`, `/consent`, `/webhook`, `/audit`, `/infer`)
- Dataset gate anonymization logic
- Training gate Kafka-event quarantine flow
- MLflow helper behavior
- Monitoring gate alert semantics and edge cases
- OTel wrapper span attributes and audit-trail response shape

Coverage target:

- Coming soon

## Contributing

Contributing workflow and branch/PR conventions:

- Coming soon

Recommended baseline process:

1. Create feature branch from `main`
2. Implement changes + tests
3. Run `uv run pytest`
4. Open PR with clear scope and test evidence

## License

MIT
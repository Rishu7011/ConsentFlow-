# ConsentFlow — Backend Reference

> **Version:** 0.3.0 | **Python:** ≥ 3.12 | **Framework:** FastAPI 0.115+

---

## 1. Project Overview

ConsentFlow is a Python middleware layer that enforces user consent revocation across an AI pipeline in real time. When a user revokes consent through a UI, CMP (e.g. OneTrust), or direct API call, ConsentFlow immediately writes the revocation to PostgreSQL, invalidates the Redis cache, and publishes a `consent.revoked` event to Apache Kafka. Five enforcement gates — dataset, inference, training, drift monitoring, and policy auditing — subscribe to this signal and block or anonymize the user's data at every stage of the AI lifecycle. Gate 05 (Policy Auditor) additionally uses Claude to scan third-party Terms of Service for consent bypass clauses before any integration goes live.

---

## 2. Tech Stack

| Component | Role | Version |
|-----------|------|---------|
| FastAPI | REST API framework, ASGI server | ≥ 0.115 |
| Uvicorn | ASGI server (production) | ≥ 0.30 |
| PostgreSQL | Authoritative consent store | 16 (Docker) |
| asyncpg | Async PostgreSQL driver | ≥ 0.29 |
| Redis | Consent cache (TTL 60 s) | 7 (Docker) |
| redis[hiredis] | Async Redis client | ≥ 5.0 |
| Apache Kafka | Revocation event bus | Confluent 7.6 |
| aiokafka | Async Kafka producer/consumer | ≥ 0.11 |
| MLflow | Experiment tracking / quarantine | ≥ 2.13 |
| Microsoft Presidio | PII detection and anonymization | ≥ 2.2 |
| Evidently AI | Data drift monitoring | ≥ 0.4 |
| Anthropic Claude | LLM policy analysis (Gate 05) | claude-sonnet-4-20250514 |
| httpx | Async HTTP client (policy URL fetch) | ≥ 0.27 |
| OpenTelemetry | Distributed tracing | SDK ≥ 1.24 |
| Grafana | Metrics/trace visualization | 10.4.2 |
| Pydantic v2 | Request/response validation | ≥ 2.7 |
| pydantic-settings | Environment-based config | ≥ 2.3 |

---

## 3. Folder Structure

```
consentflow-backend/
├── .env                        # Active environment variables (not committed)
├── .env.example                # Template for .env
├── .python-version             # Python 3.12 pin
├── Dockerfile                  # Multi-stage production image
├── docker-compose.yml          # Full stack: Postgres, Redis, Kafka, OTel, Grafana
├── otel-collector-config.yaml  # OTel Collector pipeline config
├── pyproject.toml              # Project metadata + dependencies (uv/hatch) v0.3.0
├── seed_db.py                  # One-shot seeder script (optional)
├── grafana/
│   ├── provisioning/           # Auto-provision datasources and dashboards
│   └── dashboards/             # JSON dashboard definitions
├── consentflow/
│   ├── __init__.py
│   ├── sdk.py                  # is_user_consented() — shared consent check
│   ├── anonymizer.py           # Presidio PII detection & masking
│   ├── dataset_gate.py         # Gate 01: per-record consent filter + MLflow
│   ├── training_gate.py        # Gate 02: Kafka consumer, MLflow quarantine
│   ├── inference_gate.py       # Gate 03: ASGI ConsentMiddleware (fail-closed)
│   ├── monitoring_gate.py      # Gate 04: Evidently drift + revoked-sample alerts
│   ├── policy_auditor.py       # Gate 05: Claude LLM ToS scanner
│   ├── langchain_gate.py       # LangChain callback adapter for inference gate
│   ├── mlflow_utils.py         # MLflow run search + quarantine tag helpers
│   ├── telemetry.py            # OTel tracer factory (configure_otel/get_tracer)
│   ├── otel_dataset_gate.py    # OTel-traced wrapper for dataset gate
│   ├── otel_inference_gate.py  # OTel-traced wrapper + audit_log writer
│   ├── otel_training_gate.py   # OTel-traced wrapper for training gate
│   ├── otel_monitoring_gate.py # OTel-traced wrapper for monitoring gate
│   ├── migrations/
│   │   ├── 001_init.sql        # users + consent_records tables
│   │   ├── 002_audit_log.sql   # audit_log table
│   │   ├── 003_seed_demo_user.sql # Inserts demo UUID 550e8400-…
│   │   └── 004_policy_scans.sql   # Gate 05 policy_scans table
│   └── app/
│       ├── __init__.py
│       ├── main.py             # FastAPI app factory + lifespan (7 routers)
│       ├── config.py           # Settings (pydantic-settings, reads .env)
│       ├── db.py               # asyncpg pool lifecycle
│       ├── cache.py            # Redis helpers (get/set/invalidate)
│       ├── kafka_producer.py   # AIOKafkaProducer lifecycle + publish_revocation
│       ├── models.py           # All Pydantic request/response models
│       └── routers/
│           ├── __init__.py
│           ├── users.py        # GET/POST /users, POST /users/register
│           ├── consent.py      # GET/POST /consent, POST /consent/revoke
│           ├── webhook.py      # POST /webhook/consent-revoke
│           ├── infer.py        # POST /infer/predict (demo endpoint)
│           ├── audit.py        # GET /audit/trail
│           ├── dashboard.py    # GET /dashboard/stats
│           └── policy.py       # POST /policy/scan, GET /policy/scans, GET /policy/scans/{id}
└── tests/
    ├── conftest.py             # Shared pytest fixtures (FakePool, FakeRedis, FakeConnection)
    ├── test_health.py          # Health endpoint
    ├── test_consent.py         # Consent CRUD + cache
    ├── test_step3.py           # Dataset gate
    ├── test_step4.py           # Inference gate middleware
    ├── test_step5.py           # Training gate Kafka consumer
    ├── test_step7.py           # OTel wrappers + audit trail
    ├── test_monitoring_gate.py # Drift monitor
    ├── test_policy_auditor.py  # Gate 05 unit tests (analyze_policy, fetch errors, JSON parse)
    └── test_gate05_e2e.py      # Gate 05 end-to-end smoke tests (all I/O mocked)
```

---

## 4. Environment Variables

All variables are read by `consentflow/app/config.py` via `pydantic-settings`. The `.env` file is loaded automatically when `Settings()` is instantiated.

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `POSTGRES_HOST` | PostgreSQL hostname | `localhost` | No |
| `POSTGRES_PORT` | PostgreSQL port | `5432` | No |
| `POSTGRES_DB` | Database name | `consentflow` | No |
| `POSTGRES_USER` | Database user | `consentflow` | No |
| `POSTGRES_PASSWORD` | Database password | `consentflow` | **Yes** (change in prod) |
| `REDIS_HOST` | Redis hostname | `localhost` | No |
| `REDIS_PORT` | Redis port | `6379` | No |
| `REDIS_DB` | Redis logical database index | `0` | No |
| `REDIS_PASSWORD` | Redis auth password | `None` | No |
| `APP_ENV` | Application environment | `development` | No |
| `LOG_LEVEL` | Logging level (`DEBUG`/`INFO`/`WARNING`/`ERROR`) | `INFO` | No |
| `CONSENT_CACHE_TTL` | Redis cache TTL in seconds | `60` | No |
| `KAFKA_BROKER_URL` | Kafka broker address (inside Docker: `kafka:9092`) | `localhost:29092` | No |
| `KAFKA_TOPIC_REVOKE` | Topic for consent-revoked events | `consent.revoked` | No |
| `OTEL_ENABLED` | Enable OpenTelemetry tracing | `false` | No |
| `OTEL_ENDPOINT` | OTLP gRPC exporter endpoint | `http://localhost:4317` | No |
| `OTEL_SERVICE_NAME` | OTel `service.name` resource attribute | `consentflow` | No |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key (Gate 05 only) | `None` | **Yes** for Gate 05 |

> **Docker Compose note:** Inside the `app` container, `KAFKA_BROKER_URL` is automatically set to `kafka:9092`. Outside Docker, use `localhost:29092`.

---

## 5. Database Schema

Migrations are applied at startup in alphabetical order from `consentflow/migrations/`.

### 5.1 `users`
```sql
CREATE TABLE users (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email      TEXT        NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5.2 `consent_records`
```sql
CREATE TABLE consent_records (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data_type  TEXT        NOT NULL,
    purpose    TEXT        NOT NULL,
    status     TEXT        NOT NULL CHECK (status IN ('granted', 'revoked')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique: one record per (user, purpose, data_type) triple
CREATE UNIQUE INDEX idx_consent_user_purpose_datatype
    ON consent_records (user_id, purpose, data_type);

-- Performance index for SDK lookups
CREATE INDEX idx_consent_user_purpose_status
    ON consent_records (user_id, purpose, status);
```

### 5.3 `audit_log`
```sql
CREATE TABLE audit_log (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    event_time     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    user_id        TEXT         NOT NULL,   -- TEXT (not UUID): can be "UNKNOWN"
    gate_name      TEXT         NOT NULL,   -- 'dataset_gate' | 'inference_gate' | ...
    action_taken   TEXT         NOT NULL,   -- 'passed' | 'blocked' | 'anonymized' | ...
    consent_status TEXT         NOT NULL,   -- 'granted' | 'revoked'
    purpose        TEXT,                    -- nullable
    metadata       JSONB,                   -- gate-specific extra data
    trace_id       TEXT                     -- OTel W3C trace ID hex string
);

CREATE INDEX idx_audit_log_user_id    ON audit_log (user_id);
CREATE INDEX idx_audit_log_event_time ON audit_log (event_time DESC);
CREATE INDEX idx_audit_log_gate_name  ON audit_log (gate_name);
```

### 5.4 Demo user seed (migration 003)
```sql
INSERT INTO users (id, email)
VALUES ('550e8400-e29b-41d4-a716-446655440000', 'demo@consentflow.dev')
ON CONFLICT (id) DO NOTHING;
```

### 5.5 `policy_scans` (migration 004)
```sql
CREATE TABLE policy_scans (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    scanned_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    integration_name  TEXT        NOT NULL,
    policy_url        TEXT,
    policy_text_hash  TEXT        NOT NULL,  -- SHA-256 of the policy text
    overall_risk_level TEXT       NOT NULL CHECK (overall_risk_level IN ('low','medium','high','critical')),
    findings_count    INTEGER     NOT NULL DEFAULT 0,
    findings          JSONB       NOT NULL DEFAULT '[]',
    raw_summary       TEXT        NOT NULL DEFAULT ''
);

CREATE INDEX idx_policy_scans_scanned_at      ON policy_scans (scanned_at DESC);
CREATE INDEX idx_policy_scans_risk_level      ON policy_scans (overall_risk_level);
CREATE INDEX idx_policy_scans_integration     ON policy_scans (integration_name);
```

---

## 6. API Endpoint Reference

Base URL (local): `http://localhost:8000`

### 6.1 `GET /health`

**Purpose:** Liveness check — returns Postgres and Redis status.

**Request:** None

**Response 200:**
```json
{
  "status": "ok",
  "postgres": "ok",
  "redis": "ok"
}
```

**Response 200 (degraded):**
```json
{
  "status": "degraded",
  "postgres": "ok",
  "redis": "error: Connection refused"
}
```

| Code | Meaning |
|------|---------|
| 200 | Always returned (check `status` field) |

---

### 6.2 `GET /users`

**Purpose:** List all users with consent summary.

**Request:** None

**Response 200:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "demo@consentflow.dev",
    "created_at": "2024-07-15T10:00:00Z",
    "consents": 3,
    "status": "active"
  }
]
```

`status` values: `"active"` (≥1 granted consent), `"revoked"` (all revoked), `"pending"` (no consents).

| Code | Meaning |
|------|---------|
| 200 | Success |
| 500 | Database error |

---

### 6.3 `POST /users`

**Purpose:** Create a new user. Returns the generated UUID.

**Request body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | `string` (EmailStr) | Yes | User's email address |

**Response 201:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "demo@consentflow.dev",
  "created_at": "2024-07-15T10:00:00Z"
}
```

| Code | Meaning |
|------|---------|
| 201 | User created |
| 409 | Email already registered |
| 422 | Invalid email format |
| 500 | Database error |

---

### 6.4 `POST /users/register`

**Purpose:** Alias for `POST /users` (frontend-friendly path). Identical request/response shape.

---

### 6.5 `GET /users/{user_id}`

**Purpose:** Look up a user by UUID, including consent summary.

**Path params:** `user_id` — UUID string

**Response 200:** Same shape as a single `UserListRecord` (see 6.2).

| Code | Meaning |
|------|---------|
| 200 | Found |
| 404 | User not found |
| 422 | `user_id` is not a valid UUID |

---

### 6.6 `GET /consent`

**Purpose:** List the 1000 most recent consent records across all users.

**Request:** None

**Response 200:**
```json
[
  {
    "id": "uuid",
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "data_type": "pii",
    "purpose": "analytics",
    "status": "granted",
    "updated_at": "2024-07-15T10:30:00Z"
  }
]
```

| Code | Meaning |
|------|---------|
| 200 | Success |
| 500 | Database error |

---

### 6.7 `POST /consent`

**Purpose:** Upsert a consent record (create or update).

**Request body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | `UUID` | Yes | User's UUID |
| `data_type` | `string` (1–128 chars) | Yes | Data category (e.g. `"pii"`, `"usage"`) |
| `purpose` | `string` (1–256 chars) | Yes | Processing purpose (e.g. `"analytics"`) |
| `status` | `"granted"` \| `"revoked"` | Yes | Consent status |

**Response 200:**
```json
{
  "id": "uuid",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "data_type": "pii",
  "purpose": "analytics",
  "status": "granted",
  "updated_at": "2024-07-15T10:30:00Z"
}
```

| Code | Meaning |
|------|---------|
| 200 | Record upserted |
| 404 | `user_id` does not exist (FK violation) |
| 422 | Validation error |
| 500 | Database error |

> **Note:** Cache is invalidated after any write.

---

### 6.8 `POST /consent/revoke`

**Purpose:** Bulk-revoke all consent records for a user+purpose pair. Sets `status='revoked'` for every `data_type` row matching the given `user_id` and `purpose`.

**Request body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | `UUID` | Yes | User's UUID |
| `purpose` | `string` (1–256 chars) | Yes | Purpose to revoke |

**Response 200:** Returns the most recently updated `ConsentRecord`.

| Code | Meaning |
|------|---------|
| 200 | Revoked |
| 404 | No consent records found for user+purpose |
| 422 | Validation error |

---

### 6.9 `GET /consent/{user_id}/{purpose}`

**Purpose:** Get the current consent status for a user+purpose pair. Redis-cached (TTL 60 s).

**Path params:**
- `user_id` — UUID string
- `purpose` — consent purpose string

**Response 200:**
```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "purpose": "analytics",
  "status": "granted",
  "updated_at": "2024-07-15T10:30:00Z",
  "cached": true
}
```

`cached: true` means the result was served from Redis.

| Code | Meaning |
|------|---------|
| 200 | Found |
| 404 | No consent record for user+purpose |
| 422 | Invalid UUID |

---

### 6.10 `POST /webhook/consent-revoke`

**Purpose:** Receive an OneTrust-style consent-revocation webhook. Idempotent — safe to call multiple times for the same user+purpose.

**Request body (camelCase — OneTrust style):**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | `string` (UUID) | Yes | UUID of the user |
| `purpose` | `string` (1–256 chars) | Yes | Revoked purpose |
| `consentStatus` | `string` | Yes | Must be `"revoked"` |
| `timestamp` | `string` (ISO-8601) | Yes | Event timestamp |

**Response 200:**
```json
{
  "status": "propagated",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "purpose": "analytics",
  "kafka_published": true,
  "warning": null
}
```

**Response 207 (Kafka failed, DB+cache succeeded):**
```json
{
  "status": "partial",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "purpose": "analytics",
  "kafka_published": false,
  "warning": "Kafka publish failed: ..."
}
```

| Code | Meaning |
|------|---------|
| 200 | Fully propagated: DB + cache + Kafka |
| 207 | DB+cache updated, Kafka failed |
| 422 | `consentStatus` ≠ `"revoked"`, or invalid UUID |
| 500 | Database error |

---

### 6.11 `POST /infer/predict`

**Purpose:** Demo AI inference endpoint, protected by `ConsentMiddleware`. Only reachable when the user has active consent.

**Identity resolution (in order):**
1. `X-User-ID` HTTP header
2. JSON body field `user_id`

**Request body:**
```json
{ "user_id": "550e8400-e29b-41d4-a716-446655440000", "prompt": "..." }
```

**Response 200 (consent granted):**
```json
{
  "status": "success",
  "message": "Inference completed safely.",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "prediction": "dummy_output"
}
```

| Code | Meaning |
|------|---------|
| 200 | Inference allowed |
| 400 | `user_id` missing from request |
| 403 | Consent revoked for this user |
| 503 | Consent service unavailable (fail-closed) |

---

### 6.12 `GET /audit/trail`

**Purpose:** Time-ordered log of consent enforcement actions from all four gates.

**Query parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `user_id` | `string` | `null` | Filter by user ID |
| `gate_name` | `string` | `null` | Filter by gate (`dataset_gate`, `inference_gate`, `training_gate`, `monitoring_gate`) |
| `limit` | `int` [1–1000] | `100` | Maximum rows to return |

**Response 200:**
```json
{
  "entries": [
    {
      "id": "uuid",
      "event_time": "2024-07-15T10:30:00Z",
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "gate_name": "inference_gate",
      "action_taken": "blocked",
      "consent_status": "revoked",
      "purpose": "inference",
      "metadata": { "path": "/infer/predict" },
      "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736"
    }
  ],
  "total": 142
}
```

| Code | Meaning |
|------|---------|
| 200 | Success |
| 500 | Database error |

---

### 6.13 `GET /dashboard/stats`

**Purpose:** Aggregated metrics for the Next.js dashboard.

**Request:** None

**Response 200:**
```json
{
  "users": 12,
  "granted": 45,
  "blocked": 8,
  "purposes": { "analytics": 20, "inference": 15, "training": 10 },
  "checks_24h_total": 137,
  "checks_24h_allowed": 129,
  "checks_24h_blocked": 8,
  "checks_sparkline": [0, 0, 3, 5, 8, 12, ...]
}
```

`checks_sparkline` is an array of 24 integers — one per hour slot (oldest → newest).

New fields added in v0.3.0:
- `policy_scans_total` — total rows in `policy_scans` table
- `policy_scans_critical` — rows where `overall_risk_level = 'critical'`

Both default to `0` if the `policy_scans` table does not exist (graceful degradation).

| Code | Meaning |
|------|---------|
| 200 | Success |

---

### 6.14 `POST /policy/scan`

**Purpose:** Fetch and analyse an AI plugin's privacy policy using Claude. Detects seven categories of consent-bypass clauses.

**Requires:** `ANTHROPIC_API_KEY` set in `.env` (returns 503 if missing).

**Request body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `integration_name` | `string` (1–256 chars) | Yes | Human-readable name of the plugin/integration |
| `policy_url` | `string` (URL) | One of these | Publicly reachable URL of the privacy policy |
| `policy_text` | `string` | One of these | Raw policy text to scan |

At least one of `policy_url` or `policy_text` must be supplied (enforced by model_validator).

**Response 201:**
```json
{
  "scan_id": "uuid",
  "integration_name": "OpenAI Plugin",
  "overall_risk_level": "critical",
  "findings": [
    {
      "id": "finding_1",
      "severity": "critical",
      "category": "Training on Inputs",
      "clause_excerpt": "We may use your inputs to improve our models...",
      "explanation": "Training on user inputs without explicit opt-out violates GDPR Art. 6",
      "article_reference": "GDPR Article 6(1)"
    }
  ],
  "findings_count": 1,
  "raw_summary": "One critical clause detected...",
  "scanned_at": "2024-07-15T10:30:00Z",
  "policy_url": "https://example.com/privacy"
}
```

| Code | Meaning |
|------|---------|
| 201 | Scan complete |
| 422 | Could not fetch policy URL |
| 502 | LLM analysis failed |
| 503 | `ANTHROPIC_API_KEY` not configured |

---

### 6.15 `GET /policy/scans`

**Purpose:** Paginated list of past policy scan summaries, newest first.

**Query parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | `int` [1–100] | `20` | Max rows |
| `offset` | `int` | `0` | Pagination offset |
| `risk_level` | `string` | `null` | Filter: `low`\|`medium`\|`high`\|`critical` |

**Response 200:** Array of `PolicyScanListItem`:
```json
[
  {
    "scan_id": "uuid",
    "integration_name": "OpenAI Plugin",
    "overall_risk_level": "critical",
    "findings_count": 3,
    "scanned_at": "2024-07-15T10:30:00Z"
  }
]
```

---

### 6.16 `GET /policy/scans/{scan_id}`

**Purpose:** Retrieve the full result of a single scan by its UUID.

**Response 200:** Full `PolicyScanResult` (same shape as POST /policy/scan response).

| Code | Meaning |
|------|---------|
| 200 | Found |
| 404 | Scan not found |

---

## 7. Auth Strategy

ConsentFlow does **not** implement authentication (no JWT, no session cookies). Identity is passed by the caller:

- **`X-User-ID` header** — primary method; works for all HTTP methods.
- **JSON body `user_id` field** — fallback for POST/PUT/PATCH requests.

The `ConsentMiddleware` checks these two sources in order and returns `400` if neither is present.

---

## 8. Middleware Behavior — ConsentMiddleware

`ConsentMiddleware` is a Starlette `BaseHTTPMiddleware` installed at the application level. It **only** activates for paths matching `protected_prefixes` (currently `["/infer"]`). All other routes pass through unconditionally.

**Decision logic:**
1. Extract `user_id` (header → body).
2. Check Redis cache (`consent:{user_id}:{purpose}`, TTL 60 s).
3. Fall back to PostgreSQL if cache miss.
4. **Fail-closed**: any exception in steps 2–3 returns `503`.

**Responses:**
| Condition | HTTP Status |
|-----------|-------------|
| `user_id` absent | 400 |
| Consent check throws | 503 |
| Consent revoked (or no record) | 403 |
| Consent granted | Pass-through |

**Configuration** (in `main.py`):
```python
app.add_middleware(
    ConsentMiddleware,
    protected_prefixes=["/infer"],
    purpose="inference",
)
```

---

## 9. Third-Party Integrations

### Redis Cache
- **Key schema:** `consent:{user_id}:{purpose}`
- **TTL:** `CONSENT_CACHE_TTL` (default 60 s)
- **Invalidation:** On every write (`POST /consent`, `POST /consent/revoke`, `POST /webhook/consent-revoke`)
- **Cache miss behavior:** Falls through to PostgreSQL; result cached on read.

### Kafka
- **Topic:** `consent.revoked` (configured via `KAFKA_TOPIC_REVOKE`)
- **Producer:** `AIOKafkaProducer` with `acks="all"`, 3 retries, 10 s timeout
- **Partition key:** `user_id` (preserves ordering for a single user)
- **Message schema:**
  ```json
  {
    "event": "consent.revoked",
    "user_id": "<uuid-string>",
    "purpose": "<purpose-string>",
    "timestamp": "<ISO-8601 UTC>"
  }
  ```
- **Consumer (Training Gate):** `group_id="consentflow-training-gate"`, `auto_offset_reset="earliest"`

### Microsoft Presidio
- **Engine:** `AnalyzerEngine` + `AnonymizerEngine` (module-level singletons, loaded once)
- **Model:** spaCy `en_core_web_lg`
- **Operator:** Replace detected PII with `<REDACTED>`
- **Used by:** `dataset_gate.py` → `anonymizer.py`

### OTel Span Names
| Gate | Span Name |
|------|-----------|
| Dataset gate | `dataset_gate.check` |
| Inference gate | `inference_gate.check` |
| Training gate | `training_gate.check` |
| Monitoring gate | `monitoring_gate.check` |
| Policy Auditor | writes `gate_name="policy_auditor"` to `audit_log` (no OTel span in v0.3.0) |

**Common span attributes:** `gate_name`, `user_id`, `consent_status`, `action_taken`, `purpose`

---

## 10. Error Code Reference

| HTTP Code | Cause |
|-----------|-------|
| 200 | Success |
| 201 | Resource created (POST /users, POST /policy/scan) |
| 207 | Partial success (webhook: DB OK, Kafka failed) |
| 400 | Missing `user_id` on protected `/infer` routes |
| 403 | Consent revoked — inference blocked |
| 404 | Resource not found (user, consent record, policy scan) |
| 409 | Email already registered |
| 422 | Pydantic validation error (invalid field type/format); or policy URL unreachable |
| 500 | Database error |
| 502 | LLM analysis failed (Gate 05 — Anthropic API error) |
| 503 | Consent service unavailable (fail-closed on infra error); or `ANTHROPIC_API_KEY` not set |

---

## 11. Frontend Integration Notes

- **CORS:** The API allows `http://localhost:3000` and `http://localhost:3001`. Any other origin will be rejected. Add origins via code change in `main.py`.
- **UUID strictness:** All `user_id` fields must be valid UUID v4 strings (e.g. `550e8400-e29b-41d4-a716-446655440000`). Passing a plain integer or abbreviated string will return `422`.
- **Field naming:** Backend uses `snake_case` for all JSON fields (both request and response). The webhook endpoint is the only exception — it accepts the **camelCase** OneTrust payload (`userId`, `consentStatus`) but returns `snake_case`.
- **Polling recommendations:** The `/health` endpoint is safe to poll at 5–10 s intervals. The `/dashboard/stats` and `/audit/trail` endpoints should be polled at 10–30 s to avoid DB pressure.
- **Demo user:** `550e8400-e29b-41d4-a716-446655440000` is always present after migrations. Use it in demos without needing to create a user first.

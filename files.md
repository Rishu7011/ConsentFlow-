# ConsentFlow — File Reference

Every file in the project with a detailed entry covering purpose, public API, data structures, behavioral details, and dependencies.

---

## Backend: `consentflow-backend/`

---

### `.env` / `.env.example`
**What it does:** Environment variable configuration file. `.env` is the active config (not committed). `.env.example` is the template.  
**Public API:** N/A  
**Key data structures:** See `config.py` for all variable names and defaults  
**Behavioral details:** Read by `pydantic-settings` at app startup. Variables are case-insensitive.  
**Dependencies:** Read by `consentflow/app/config.py`

---

### `Dockerfile`
**What it does:** Multi-stage Docker image definition. Installs Python dependencies with `uv`, copies source, and starts Uvicorn.  
**Public API:** N/A  
**Behavioral details:** Exposes port 8000. Entry point: `uvicorn consentflow.app.main:app --host 0.0.0.0 --port 8000`  
**Dependencies:** `pyproject.toml`, `uv.lock`

---

### `docker-compose.yml`
**What it does:** Defines the full local development stack: 6 services.

| Service | Image | Ports | Health check |
|---------|-------|-------|-------------|
| `postgres` | postgres:16 | 5432:5432 | `pg_isready` |
| `redis` | redis:7 | 6379:6379 | `redis-cli ping` |
| `zookeeper` | confluentinc/cp-zookeeper:7.6.0 | 2181:2181 | `cub zk-ready` |
| `kafka` | confluentinc/cp-kafka:7.6.0 | 9092:9092, 29092:29092 | `cub kafka-ready` |
| `app` | (built from Dockerfile) | 8000:8000 | `curl /health` |
| `otel-collector` | otel/opentelemetry-collector-contrib:0.102.1 | 4317, 4318, 8889, 13133 | — |
| `grafana` | grafana/grafana:10.4.2 | 3000:3000 | `wget /api/health` |

**Behavioral details:** Kafka uses two listeners: `PLAINTEXT` (internal, 9092) and `PLAINTEXT_HOST` (external, 29092). App container waits for Postgres, Redis, and Kafka health checks before starting. `consent.revoked` topic is pre-created at startup.

**Dependencies:** `otel-collector-config.yaml`, `grafana/provisioning/`, `grafana/dashboards/`

---

### `otel-collector-config.yaml`
**What it does:** Configures the OTel Collector pipeline: OTLP gRPC receiver, Prometheus exporter, and batch processor.  
**Public API:** N/A  
**Behavioral details:** Receives spans from the app on port 4317; exposes Prometheus metrics on 8889; port 13133 is the collector's own health endpoint.

---

### `pyproject.toml`
**What it does:** Project metadata, dependency declarations, tool config (ruff, mypy, pytest).  
**Key data:** Version `0.3.0`, requires Python ≥ 3.12. Runtime deps include `anthropic≥0.26.0` and `httpx≥0.27.0` (Gate 05).  
**Behavioral details:** `asyncio_mode = "auto"` set for pytest; testpaths = `["tests"]`

---

### `seed_db.py`
**What it does:** Standalone one-shot script to seed demo data into the database.  
**Public API:** Run with `python seed_db.py`  
**Behavioral details:** Inserts demo users and consent records; idempotent via `ON CONFLICT DO NOTHING`; not required for normal startup (migration 003 handles the demo user)

---

## `consentflow/` package

---

### `consentflow/__init__.py`
**What it does:** Package marker; exports version string.  
**Public API:** `__version__ = "0.2.0"`

---

### `consentflow/sdk.py`
**What it does:** Reusable async SDK for checking whether a user has active consent. All four gates use this function.

**Public API:**
```python
async def is_user_consented(
    user_id: str | UUID,
    purpose: str,
    *,
    redis_client: Redis | None = None,
    db_pool: asyncpg.Pool | None = None,
) -> bool

def is_user_consented_sync(user_id, purpose, *, redis_client=None, db_pool=None) -> bool
```

**Key data structures:** Redis key `consent:{user_id}:{purpose}`; JSON payload `{ "status": "granted"|"revoked" }`

**Behavioral details:**
- Priority: Redis → PostgreSQL → `False` (deny by default)
- Creates ad-hoc connections if pool/client not supplied (teardown after call)
- Any exception in Redis path falls through to Postgres
- `is_user_consented_sync` uses `asyncio.run()` — do NOT call inside a running event loop

**Dependencies:** `app/config.py`, `asyncpg`, `redis.asyncio`

---

### `consentflow/anonymizer.py`
**What it does:** PII detection and masking via Microsoft Presidio. Called by `dataset_gate.py` for every revoked-user record.

**Public API:**
```python
def anonymize_record(record: dict[str, Any]) -> dict[str, Any]
```

**Key data structures:** Presidio `AnalyzerEngine` and `AnonymizerEngine` (module-level singletons). Operator: replace all PII with `<REDACTED>`.

**Behavioral details:**
- Recursively processes nested dicts and lists
- Non-string values (int, float, bool, None) are left untouched
- Engines are lazily loaded on first call; spaCy `en_core_web_lg` loaded at that point (~2–3 s)
- Returns a new dict — original is never mutated

**Dependencies:** `presidio-analyzer`, `presidio-anonymizer`, `spacy`

---

### `consentflow/dataset_gate.py`
**What it does:** Gate 1 — consent-aware dataset registration. Iterates a dataset, checks consent per record, anonymizes revoked-user records, logs metrics+artifact to MLflow.

**Public API:**
```python
async def register_dataset_with_consent_check(
    dataset: list[dict[str, Any]],
    run_id: str,
    *,
    purpose: str = "model_training",
    redis_client: Any = None,
    db_pool: Any = None,
    mlflow_experiment: str = "ConsentFlow / Dataset Gate",
) -> GateResult
```

**Key data structures:**
```python
@dataclass
class GateResult:
    run_id: str
    total_records: int
    consented_count: int
    anonymized_count: int
    mlflow_run_id: str
    artifact_path: str
    cleaned_dataset: list[dict]
```

**Behavioral details:**
- Records missing `user_id` are treated as revoked
- MLflow experiment set to `"ConsentFlow / Dataset Gate"` by default
- Artifact logged as `dataset_gate/{run_id}_cleaned_dataset.json`
- Metrics logged: `total_records`, `consented_count`, `anonymized_count`, `anonymized_ratio`
- Tags logged: `pipeline_run_id`, `purpose`, `step="dataset_gate"`

**Dependencies:** `sdk.py`, `anonymizer.py`, `mlflow`

---

### `consentflow/training_gate.py`
**What it does:** Gate 2 — Kafka consumer that quarantines MLflow runs when consent is revoked.

**Public API:**
```python
class TrainingGateConsumer:
    def __init__(self, consumer, *, search_runs_fn=None, quarantine_fn=None): ...
    async def run(self) -> None: ...

async def run_training_gate_consumer() -> None  # factory + entry point
```

**Key data structures:**
```python
@dataclass
class QuarantineRecord:
    user_id: str
    run_id: str
    experiment_id: str
    flagged_at: str
    reason: str = "consent_revoked"
    kafka_offset: int = -1
    kafka_partition: int = -1
```

**Behavioral details:**
- Parses Kafka message value (bytes → JSON)
- Calls `mlflow_utils.search_runs_by_user()` to find affected runs
- Applies `consent_status=quarantined` tag via `mlflow_utils.apply_quarantine_tags()`
- Does NOT delete or retrain models
- Dependency injection: `search_runs_fn` and `quarantine_fn` for testing
- Consumer group: `consentflow-training-gate`

**Dependencies:** `mlflow_utils.py`, `app/config.py`, `aiokafka`

---

### `consentflow/inference_gate.py`
**What it does:** Gate 3 — ASGI middleware that enforces consent at inference time.

**Public API:**
```python
class ConsentMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, protected_prefixes=["/infer"], purpose="inference"): ...
    async def dispatch(self, request, call_next): ...
```

**Behavioral details:**
- Only activates for paths starting with `protected_prefixes`
- User ID extracted: `X-User-ID` header first, then `user_id` in JSON body
- Fail-closed: consent check exception → 503
- Pass-through for all unprotected paths (zero overhead)

**Error responses:**
| Condition | Status | Body |
|-----------|--------|------|
| Missing user_id | 400 | `{"error": "Missing user identifier..."}` |
| Infra failure | 503 | `{"error": "Consent service unavailable..."}` |
| Revoked | 403 | `{"error": "Inference blocked...", "user_id": "..."}` |

**Dependencies:** `sdk.py`, `starlette.middleware.base`

---

### `consentflow/monitoring_gate.py`
**What it does:** Gate 04 — consent-aware Evidently drift monitor. Tags samples with consent status and fires severity-graded alerts for revoked-user samples.

**Public API:**
```python
class ConsentAwareDriftMonitor:
    def __init__(self, *, consent_fn=None, purpose="monitoring", severity_threshold=5): ...
    def tag_samples_with_consent(self, df, user_id_col="user_id") -> pd.DataFrame: ...
    def run_drift_report(self, reference_df, current_df, column_mapping=None) -> Any: ...
    def check_for_revoked_samples(self, tagged_df, window_start="", window_end="") -> list[DriftAlert]: ...
    def run_consent_aware_drift_check(self, reference_df, current_df, *, ...) -> DriftCheckResult: ...
```

**Key data structures:**
```python
@dataclass
class DriftAlert:
    user_id: str
    window_start: str; window_end: str
    revoked_count: int
    severity: str  # "warning" | "critical"
    timestamp: str

@dataclass
class DriftCheckResult:
    tagged_df: pd.DataFrame
    report: Any            # Evidently Report | None
    alerts: list[DriftAlert]
    has_revoked_samples: bool
    revoked_count: int
```

**Behavioral details:**
- Adds `_consent_status` column to DataFrame (fail-closed: errors → "revoked")
- Strips `_consent_status` before passing to Evidently (internal column)
- `severity_threshold=5`: <5 revoked rows → "warning", ≥5 → "critical"
- `run_evidently=False` skips Evidently (for testing)
- Evidently imported lazily (not needed when `run_evidently=False`)

**Dependencies:** `sdk.py`, `evidently`, `pandas`

---

### `consentflow/policy_auditor.py`
**What it does:** Gate 05 — LLM-powered privacy policy / Terms of Service scanner. Fetches a policy document (by URL or raw text), calls Claude claude-sonnet-4-20250514 with a structured system prompt, and returns a list of consent-bypass findings with severity, clause excerpt, plain-English explanation, and GDPR/CCPA article references. Every scan is persisted to `policy_scans` and logged to `audit_log`.

**Public API:**
```python
class PolicyAuditor:
    def __init__(self, db_pool, redis_client, anthropic_api_key: str): ...
    async def fetch_policy(self, url: str) -> str                           # raises PolicyFetchError
    async def analyze_policy(
        self, text: str, integration_name: str
    ) -> tuple[list[dict], str, str]                                        # findings, summary, risk_level
    async def scan(
        self, request: PolicyScanRequest, pool, redis_client
    ) -> dict                                                               # full PolicyScanResult dict

class PolicyFetchError(Exception): ...
```

**Bypass categories detected (7):**
1. Training on Inputs
2. Third-Party Sharing
3. Data Retention Overrides
4. Weak Jurisdiction Clauses
5. Shadow Profiling
6. Downstream Consent Signal Overrides
7. Retroactive Policy Changes

**Behavioral details:**
- Fail-closed: malformed LLM JSON → returns single `"Analysis Failure"` finding with `severity="critical"`
- `policy_text_hash` is SHA-256(policy text); stored for future dedup/caching
- Two asyncpg `execute()` calls per scan: `INSERT INTO policy_scans`, `INSERT INTO audit_log`
- `audit_log` uses `gate_name="policy_auditor"`, `action_taken="scanned"`

**Dependencies:** `anthropic`, `httpx`, `app/models.py`, `asyncpg`

---

### `consentflow/langchain_gate.py`
**What it does:** LangChain callback handler adapter that integrates consent checking into LangChain LLM call chains.  
**Public API:** `ConsentCallbackHandler` class implementing LangChain's `BaseCallbackHandler`  
**Behavioral details:** Checks consent before `on_llm_start`; raises `PermissionError` if revoked  
**Dependencies:** `sdk.py`, `langchain-core`

---

### `consentflow/mlflow_utils.py`
**What it does:** Utility functions for searching MLflow runs by user_id and applying quarantine tags.

**Public API:**
```python
def search_runs_by_user(user_id: str) -> list[Run]
def apply_quarantine_tags(run_id: str, user_id: str, *, reason: str, timestamp: str) -> None
```

**Behavioral details:**
- `search_runs_by_user`: searches all experiments in the MLflow tracking store for runs tagged with `user_id`
- `apply_quarantine_tags`: sets `consent_status=quarantined`, `quarantine_reason`, `quarantine_timestamp`, `quarantine_user_id` on the run

**Dependencies:** `mlflow`

---

### `consentflow/telemetry.py`
**What it does:** OTel tracer factory. Configures the global OTLP gRPC exporter at startup; `get_tracer()` returns the active tracer or a no-op tracer if OTel is disabled.

**Public API:**
```python
def configure_otel(endpoint: str, service_name: str) -> None
def get_tracer(name: str) -> Any
```

**Behavioral details:**
- `configure_otel` is idempotent — safe to call multiple times
- `get_tracer` always returns a valid tracer (no-op if not configured)
- Both functions lazy-import OTel SDK to avoid import errors in test environments

**Dependencies:** `opentelemetry-sdk`, `opentelemetry-exporter-otlp-proto-grpc`

---

### `consentflow/otel_dataset_gate.py`
**What it does:** OTel-traced wrapper around `register_dataset_with_consent_check`. Creates a `dataset_gate.check` span and writes one row to `audit_log`.

**Public API:**
```python
async def traced_register_dataset(
    dataset, run_id, *, tracer=None, db_pool=None, redis_client=None,
    purpose="model_training", mlflow_experiment="..."
) -> GateResult
```

**Behavioral details:** Span attributes: `gate_name`, `run_id`, `purpose`, `consent_status`, `action_taken`, `total_records`, `anonymized_count`. Audit insert is fire-and-forget.

**Dependencies:** `dataset_gate.py`, `telemetry.py`, `asyncpg`

---

### `consentflow/otel_inference_gate.py`
**What it does:** OTel-traced helper for recording inference gate decisions. Creates `inference_gate.check` span and writes `audit_log` row.

**Public API:**
```python
async def traced_inference_check(
    user_id: str, consented: bool, *, path="", purpose="inference",
    tracer=None, db_pool=None
) -> str  # "passed" | "blocked"
```

**Behavioral details:** Span attributes: `gate_name`, `user_id`, `consent_status`, `action_taken`, `path`, `purpose`. Audit insert skipped if `db_pool=None`.

**Dependencies:** `telemetry.py`, `asyncpg`

---

### `consentflow/otel_training_gate.py`
**What it does:** OTel-traced wrapper for the training gate consumer.

**Public API:**
```python
async def traced_process_revocation(
    user_id, *, tracer=None, db_pool=None, ...
) -> list[QuarantineRecord]
```

**Dependencies:** `training_gate.py`, `telemetry.py`, `asyncpg`

---

### `consentflow/otel_monitoring_gate.py`
**What it does:** OTel-traced wrapper for the monitoring gate.

**Public API:**
```python
def traced_drift_check(monitor, reference_df, current_df, *, tracer=None, db_pool=None, ...) -> DriftCheckResult
```

**Dependencies:** `monitoring_gate.py`, `telemetry.py`, `asyncpg`

---

## `consentflow/app/` subpackage

---

### `consentflow/app/main.py`
**What it does:** FastAPI application factory and lifespan manager.

**Public API:**
```python
def create_app() -> FastAPI
app = create_app()          # module-level singleton
```

**Behavioral details:**
- Lifespan: startup — Postgres pool → Redis client → Kafka producer → apply migrations
- Shutdown (reverse): Kafka producer → Redis client → Postgres pool
- CORS allowed origins: `http://localhost:3000`, `http://localhost:3001`
- `ConsentMiddleware` installed on `protected_prefixes=["/infer"]`
- All 7 routers registered: users, consent, webhook, infer, audit, dashboard, policy

**Dependencies:** All routers, `db.py`, `cache.py`, `kafka_producer.py`, `models.py`, `config.py`, `inference_gate.py`

---

### `consentflow/app/config.py`
**What it does:** Centralized application configuration using pydantic-settings.

**Public API:**
```python
settings = Settings()       # module-level singleton
```

**Key data structures:** `Settings` class with `postgres_dsn`, `asyncpg_dsn`, `redis_url` as computed properties. Includes `anthropic_api_key: str | None = None` for Gate 05.

**Behavioral details:** Reads `.env` file (case-insensitive). All variables have defaults — app starts without a `.env` file using development defaults. Gate 05 is disabled gracefully when `anthropic_api_key` is unset.

---

### `consentflow/app/db.py`
**What it does:** asyncpg connection pool lifecycle.

**Public API:**
```python
async def create_pool() -> Pool
async def close_pool(pool: Pool) -> None
async def check_postgres(pool: Pool) -> str  # "ok" | "error: ..."
```

**Behavioral details:** Pool config: `min_size=2`, `max_size=10`, `command_timeout=30`, `statement_cache_size=0` (pgBouncer compatible).

**Dependencies:** `config.py`, `asyncpg`

---

### `consentflow/app/cache.py`
**What it does:** Redis helpers for consent lookup caching.

**Public API:**
```python
async def create_redis_client() -> Redis
async def close_redis_client(client: Redis) -> None
async def check_redis(client: Redis) -> str
async def get_consent_cache(client, user_id, purpose) -> dict | None
async def set_consent_cache(client, user_id, purpose, payload, ttl=None) -> None
async def invalidate_consent_cache(client, user_id, purpose) -> None
```

**Key data structures:** Redis key: `consent:{user_id}:{purpose}`. Value: JSON-encoded consent payload dict.

**Behavioral details:**
- Cache GET/SET failures are logged but never raised (cache is non-critical)
- Default TTL from `settings.consent_cache_ttl` (60 s)
- `set_consent_cache` stores `{ "user_id", "purpose", "status", "updated_at" }`

**Dependencies:** `config.py`, `redis.asyncio`

---

### `consentflow/app/kafka_producer.py`
**What it does:** AIOKafkaProducer lifecycle + message publish helper.

**Public API:**
```python
async def create_kafka_producer() -> AIOKafkaProducer
async def close_kafka_producer(producer: AIOKafkaProducer) -> None
async def publish_revocation(producer, user_id, purpose, timestamp) -> None
```

**Key data structures:** Message schema — `{ "event": "consent.revoked", "user_id", "purpose", "timestamp" }`

**Behavioral details:**
- Producer config: `acks="all"`, `retry_backoff_ms=200`, `request_timeout_ms=10_000`
- Partition key = `user_id` (ordering guarantee per user)
- `publish_revocation` re-raises `KafkaError` — callers decide on fallback

**Dependencies:** `config.py`, `aiokafka`

---

### `consentflow/app/models.py`
**What it does:** All Pydantic v2 request and response models.

**Public API (all models):**
```
ConsentStatus (Enum): granted | revoked
ConsentUpsertRequest: user_id, data_type, purpose, status
ConsentRevokeRequest: user_id, purpose
UserCreateRequest: email (EmailStr)
ConsentRecord: id, user_id, data_type, purpose, status, updated_at
ConsentStatusResponse: user_id, purpose, status, updated_at, cached
UserRecord: id, email, created_at
UserListRecord: id, email, created_at, consents (int), status (str)
HealthResponse: status, postgres, redis
AuditLogEntry: id, event_time, user_id, gate_name, action_taken, consent_status, purpose?, metadata?, trace_id?
AuditTrailResponse: entries (list[AuditLogEntry]), total (int)

# Gate 05 — added v0.3.0
PolicyFinding: id, severity, category, clause_excerpt, explanation, article_reference
PolicyScanRequest: integration_name, policy_url?, policy_text?  [model_validator: one required]
PolicyScanResult: scan_id, integration_name, overall_risk_level, findings, findings_count, raw_summary, scanned_at, policy_url
PolicyScanListItem: scan_id, integration_name, overall_risk_level, findings_count, scanned_at
```

**`DashboardStatsResponse` fields (v0.3.0):**  
`users`, `granted`, `blocked`, `purposes`, `checks_24h_{total,allowed,blocked}`, `checks_sparkline`, `policy_scans_total` (default 0), `policy_scans_critical` (default 0)

**Behavioral details:** All response models use `model_config = {"from_attributes": True}` for asyncpg row compatibility.

---

### `consentflow/app/routers/users.py`
**What it does:** User management endpoints — list, create, register alias, get by ID.

**Endpoints:**
- `GET /users` → `list[UserListRecord]`
- `POST /users` → `UserRecord` (201)
- `POST /users/register` → `UserRecord` (201, alias)
- `GET /users/{user_id}` → `UserListRecord`

**Behavioral details:** `POST /users/register` shares `_create_user()` with `POST /users`. Derived `status` field computed via SQL CASE expression. Returns 409 on duplicate email.

**Dependencies:** `models.py`, `asyncpg`

---

### `consentflow/app/routers/consent.py`
**What it does:** Consent CRUD — list, upsert, bulk revoke, get status.

**Endpoints:**
- `GET /consent` → `list[ConsentRecord]` (1000 most recent)
- `POST /consent` → `ConsentRecord` (upsert)
- `POST /consent/revoke` → `ConsentRecord`
- `GET /consent/{user_id}/{purpose}` → `ConsentStatusResponse`

**Behavioral details:** Upsert uses `ON CONFLICT (user_id, purpose, data_type)`. POST /consent/revoke updates all `data_type` rows for the user+purpose pair. Cache invalidated after every write.

**Dependencies:** `models.py`, `cache.py`, `asyncpg`

---

### `consentflow/app/routers/webhook.py`
**What it does:** OneTrust-style webhook ingress for consent revocation.

**Endpoints:**
- `POST /webhook/consent-revoke` → `WebhookRevokeResponse`

**Local Pydantic models:**
```
OneTrustRevokePayload: userId, purpose, consentStatus, timestamp (camelCase)
WebhookRevokeResponse: status, user_id, purpose, kafka_published, warning?
```

**Behavioral details:**
- Validates `consentStatus == "revoked"` (422 otherwise)
- Validates UUID via `UUID(body.userId)` (422 on bad format)
- Idempotent: `INSERT ... ON CONFLICT DO UPDATE` with `data_type='webhook'`
- Returns 207 if Kafka fails (DB+cache still committed)

**Dependencies:** `cache.py`, `kafka_producer.py`, `asyncpg`, `aiokafka`

---

### `consentflow/app/routers/infer.py`
**What it does:** Demo inference endpoint for testing `ConsentMiddleware`.

**Endpoints:**
- `POST /infer/predict` → `{ status, message, user_id, prediction }`

**Behavioral details:** If this handler runs, the request passed the middleware (consent was granted). Reads `user_id` from body or `X-User-ID` header for logging only.

**Dependencies:** None

---

### `consentflow/app/routers/audit.py`
**What it does:** Time-ordered audit trail with optional filtering.

**Endpoints:**
- `GET /audit/trail?user_id=&gate_name=&limit=100` → `AuditTrailResponse`

**Behavioral details:** Builds dynamic WHERE clause; runs count query + data query in single connection. JSONB `metadata` column deserialized from string on asyncpg return. Results ordered `event_time DESC`.

**Dependencies:** `models.py`, `asyncpg`

---

### `consentflow/app/routers/dashboard.py`
**What it does:** Aggregated metrics for the Next.js dashboard.

**Endpoints:**
- `GET /dashboard/stats` → `DashboardStatsResponse`

**Local Pydantic model:**
```
DashboardStatsResponse: users, granted, blocked, purposes, checks_24h_total,
                        checks_24h_allowed, checks_24h_blocked, checks_sparkline,
                        policy_scans_total (default 0), policy_scans_critical (default 0)
```

**Behavioral details:** Sparkline is 24-element array bucketed by hour (index 0 = 24 hours ago, index 23 = now). Gate 05 counts queried live from `policy_scans`; wrapped in `try/except` so missing table returns `0` gracefully.

**Dependencies:** `asyncpg`

---

### `consentflow/app/routers/policy.py`
**What it does:** Gate 05 — REST endpoints for policy scanning.

**Endpoints:**
- `POST /policy/scan` → `PolicyScanResult` (201)
- `GET /policy/scans` → `list[PolicyScanListItem]` (paginated)
- `GET /policy/scans/{scan_id}` → `PolicyScanResult`

**Behavioral details:**
- Instantiates `PolicyAuditor` with `settings.anthropic_api_key`; returns 503 if key missing
- `POST /policy/scan` accepts `PolicyScanRequest`; calls `PolicyAuditor.scan()`, serializes `PolicyScanResult`
- List endpoint supports `limit`, `offset`, `risk_level` query params
- Raises 404 if `scan_id` not found; raises 422 if URL unreachable (re-raised from `PolicyFetchError`)

**Dependencies:** `policy_auditor.py`, `models.py`, `config.py`, `asyncpg`

---

## Migrations

### `migrations/001_init.sql`
Creates `users` and `consent_records` tables with indexes. Idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

### `migrations/002_audit_log.sql`
Creates `audit_log` table with JSONB `metadata` column and three indexes (user_id, event_time DESC, gate_name). Idempotent.

### `migrations/003_seed_demo_user.sql`
Inserts demo user `550e8400-e29b-41d4-a716-446655440000` / `demo@consentflow.dev`. Idempotent via `ON CONFLICT (id) DO NOTHING`.

### `migrations/004_policy_scans.sql`
Creates `policy_scans` table for Gate 05 scan persistence. Columns: `id`, `scanned_at`, `integration_name`, `policy_url`, `policy_text_hash`, `overall_risk_level`, `findings_count`, `findings` (JSONB), `raw_summary`. Three indexes: `scanned_at DESC`, `overall_risk_level`, `integration_name`. Idempotent.

---

## Tests

### `tests/conftest.py`
Shared pytest fixtures. `FakeConnection` — asyncpg stub with `fetchrow/fetch/execute/fetchval`. `FakePool` — asyncpg pool stub (context manager). `FakeRedis` — in-memory Redis stub. `client` fixture — `AsyncClient` with fakes injected into `app.state`. Sets `asyncio_mode="auto"`.

### `tests/test_health.py`
Tests `GET /health` returns 200 and expected JSON shape.

### `tests/test_consent.py`
Tests all consent endpoints: upsert, revoke, status lookup with Redis hit/miss behavior, 404 on unknown user.

### `tests/test_step3.py`
Tests dataset gate: consented records pass through, revoked records are anonymized, MLflow metrics and artifact logged.

### `tests/test_step4.py`
Tests `ConsentMiddleware`: 400 on missing user_id, 403 on revoked, 200 on granted, 503 on consent service error.

### `tests/test_step5.py`
Tests `TrainingGateConsumer`: injected mock consumer, search_runs_fn, quarantine_fn; verifies QuarantineRecord creation.

### `tests/test_step7.py`
Tests OTel gate wrappers and `GET /audit/trail` endpoint with filter combinations.

### `tests/test_monitoring_gate.py`
Tests `ConsentAwareDriftMonitor`: consent tagging, severity thresholds, alert generation, `run_consent_aware_drift_check` with `run_evidently=False`.

### `tests/test_policy_auditor.py`
Gate 05 unit tests. Five focused tests:
- `test_scan_with_text` — happy path raw-text scan, asserts full result shape
- `test_scan_url_fetch_error` — httpx `ConnectError` → `PolicyFetchError` raised
- `test_analyze_bad_json` — malformed LLM response → single `"Analysis Failure"` critical finding
- `test_overall_risk_level_critical` — three critical findings → level surfaced as `"critical"`
- `test_post_scan_endpoint` — FastAPI `TestClient` with mocked `.scan()`; asserts HTTP 201

### `tests/test_gate05_e2e.py`
Gate 05 end-to-end smoke tests (all I/O mocked). Five tests:
- `test_full_scan_flow_url_mode` — URL mode: httpx → LLM → DB; asserts exactly 2 `execute()` calls (policy_scans + audit_log), `overall_risk_level=="critical"`, 2 findings
- `test_full_scan_flow_paste_mode` — paste mode: asserts HTTP client is never called, 0 findings, `risk_level=="low"`
- `test_api_endpoint_post_scan` — FastAPI `TestClient`; mocked `.scan()`; asserts HTTP 201 + valid UUID
- `test_api_endpoint_get_scans` — `GET /policy/scans`; `ScanListPool` returns 3 rows; asserts HTTP 200 + list length 3
- `test_risk_level_propagation` — three sub-assertions: correct LLM label passed through, absent key defaults to `"low"`, full `scan()` end-to-end propagates `"critical"`

---

## Frontend: `consentflow-frontend/`

---

### `app/layout.tsx`
**What it does:** Root HTML layout wrapping all pages with `QueryProvider`, Geist Sans/Mono fonts, `suppressHydrationWarning`.  
**Dependencies:** `components/providers/QueryProvider`, `next/font/google`

### `app/globals.css`
**What it does:** Global CSS reset and design token definitions (colors, typography, base element styles).

### `app/page.tsx`
**What it does:** Landing page — animated hero, architecture flow diagram (AnimatedBeam), gate explanations, tech stack pills.  
**Dependencies:** `components/layout/Navbar`, `components/magicui/animated-beam`, `framer-motion`, `gsap`

### `app/dashboard/page.tsx`
**What it does:** Dashboard with live metrics from `GET /dashboard/stats` (including `policy_scans_total` and `policy_scans_critical`), audit table from `useAuditTrail`, 10 s health polling, and Gate 05 "Policies Scanned" metric card with shield icon.  
**Dependencies:** `components/dashboard/MetricCard`, `components/dashboard/HealthWidget`, `hooks/useAuditTrail`, `lib/axios`

### `app/policy/page.tsx`
**What it does:** Gate 05 — Policy Auditor UI. URL / paste-text input, risk-level banner (color-coded: low=green, medium=amber, high=red, critical=red+pulse), per-finding expandable cards (clause excerpt, explanation, GDPR/CCPA article ref), scan history table.  
**Dependencies:** `Sidebar`, `hooks/usePolicyAuditor`

### `app/users/page.tsx`
**What it does:** User registry with search, register form (POST /users/register), detail view, sessionStorage active user setter.  
**Dependencies:** `Sidebar`, `lib/axios`

### `app/consent/page.tsx`
**What it does:** Consent manager — list, filter, grant/revoke form.  
**Dependencies:** `Sidebar`, `lib/axios`

### `app/audit/page.tsx`
**What it does:** Paginated, filterable audit trail viewer.  
**Dependencies:** `Sidebar`, `hooks/useAuditTrail`

### `app/webhook/page.tsx`
**What it does:** OneTrust webhook simulator with editable JSON payload and propagation status indicators.  
**Dependencies:** `Sidebar`, `lib/axios`

### `app/infer/page.tsx`
**What it does:** Inference gate tester — UUID + prompt form, shows allowed/blocked/error result states.  
**Dependencies:** `Sidebar`, `lib/axios`

### `app/api/*/route.ts`
**What it does:** Next.js API route handlers that proxy each backend endpoint to avoid browser CORS issues.  
**Available routes:** `/api/health`, `/api/audit`, `/api/consent`, `/api/users`, `/api/infer`, `/api/webhook`, `/api/dashboard-stats`, `/api/policy`

### `lib/axios.ts`
**What it does:** Singleton Axios instance with `baseURL='/api'`, 10 s timeout, request interceptor (attaches `X-User-ID` from sessionStorage), response interceptor (dispatches `api:error` custom event on 500/503).

### `hooks/useAuditTrail.ts`
**What it does:** TanStack Query hook for `GET /api/audit` with optional `user_id`, `gate_name`, `limit` filters and configurable `refetchInterval`.

### `hooks/useConsent.ts`
**What it does:** TanStack Query hook for consent record fetching and mutation.

### `hooks/useHealth.ts`
**What it does:** TanStack Query hook for `GET /api/health`.

### `hooks/useUsers.ts`
**What it does:** TanStack Query hook for user list and single-user fetching.

### `types/api.ts`
**What it does:** Legacy Axios instance using `NEXT_PUBLIC_API_URL` directly (superseded by `lib/axios.ts` with proxy). Contains early TypeScript type definitions.

### `hooks/usePolicyAuditor.ts`
**What it does:** TanStack Query hooks for Gate 05.  
- `useScanPolicy()` — mutation for `POST /api/policy` (scan submission)
- `usePolicyScans()` — query for `GET /api/policy` (scan history)
- `usePolicyScan(scanId)` — query for `GET /api/policy/{scanId}` (detail view)

### `app/api/policy/route.ts`
**What it does:** Next.js API route handler proxying all Gate 05 requests to FastAPI.  
- `POST /api/policy` → `POST http://localhost:8000/policy/scan`
- `GET /api/policy` → `GET http://localhost:8000/policy/scans`
- `GET /api/policy/{scanId}` → `GET http://localhost:8000/policy/scans/{scanId}`

### `next.config.ts`
**What it does:** Next.js configuration (currently default/empty — no rewrites or custom headers configured).

### `.env.local`
**What it does:** Frontend environment variables. `NEXT_PUBLIC_API_URL=http://localhost:8000`.

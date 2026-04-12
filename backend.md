# ConsentFlow Backend Reference

This document serves as a comprehensive reference for frontend developers and other contributors integrating with the ConsentFlow backend.

## 1. Project Overview

ConsentFlow is a consent-enforcement middleware and data layer for AI pipelines. It provides a REST API to manage user consent records and enforces these rules in real-time. When a user revokes consent, the system updates its internal database, invalidates local caches, and broadcasts the event via Kafka so that downstream ML pipeline stages can halt or scrub data accordingly.

**Tech Stack:**
- **Framework:** FastAPI (Python)
- **Database:** PostgreSQL (via `asyncpg` driver)
- **Cache:** Redis (for fast, frequent consent checks)
- **Message Broker:** Kafka (via `aiokafka` for revocation events)
- **Observability:** OpenTelemetry (OTEL)

**Entry Point:**
The main FastAPI application is instantiated in `consentflow/app/main.py`. To start the server for local development, you typically run:
```bash
uvicorn consentflow.app.main:app --reload
```
Alternatively, the project is structured to run via `docker-compose`.

---

## 2. Folder Structure

```text
consentflow/
├── app/
│   ├── main.py              # FastAPI app creation, lifespan events (DB/Redis/Kafka init)
│   ├── config.py            # Environment variable definitions and validation (Pydantic)
│   ├── db.py                # PostgreSQL asyncpg connection pool management
│   ├── cache.py             # Redis interactions (get/set/invalidate consent cache)
│   ├── models.py            # Pydantic schemas (requests, responses, DB models)
│   ├── kafka_producer.py    # aiokafka publisher for consent revocation events
│   └── routers/             # API route handlers
│       ├── users.py         # User registration and lookup endpoints
│       ├── consent.py       # Consent CRUD operations
│       ├── webhook.py       # Ingress for external (OneTrust-style) revocation events
│       ├── infer.py         # Example inference endpoint protected by middleware
│       └── audit.py         # Endpoints for retrieving consent audit trails
├── inference_gate.py        # FastAPI middleware that blocks inference if consent is revoked
├── *_gate.py                # Implementations of various AI lifecycle gates (dataset, monitoring, etc.)
└── migrations/              # Raw SQL migration files executed during app startup
```

---

## 3. Environment Variables

The application relies on `.env` files. Ensure you have a valid `.env` to run the application natively.

| Variable | Description | Example |
|---|---|---|
| `POSTGRES_HOST` | Hostname of the PostgreSQL database. | `localhost` |
| `POSTGRES_PORT` | Port of the Postgres DB. | `5432` |
| `POSTGRES_DB` | Name of the database. | `consentflow` |
| `POSTGRES_USER` | DB user. | `consentflow` |
| `POSTGRES_PASSWORD` | DB password. | `changeme` |
| `REDIS_HOST` | Redis cache hostname. | `localhost` |
| `REDIS_PORT` | Redis cache port. | `6379` |
| `REDIS_DB` | Redis logical DB index. | `0` |
| `REDIS_PASSWORD` | Optional Redis password. | `secret` |
| `APP_ENV` | Application environment state. | `development` or `production` |
| `LOG_LEVEL` | Python logging level. | `INFO` |
| `CONSENT_CACHE_TTL` | Cache duration in seconds for Redis keys. | `60` |
| `KAFKA_BROKER_URL` | URL of the Kafka broker. | `localhost:29092` |
| `KAFKA_TOPIC_REVOKE` | Topic for broadcasting consent revocation. | `consent.revoked` |
| `OTEL_ENABLED` | (Optional) Enable OpenTelemetry observability. | `true` or `false` |
| `OTEL_ENDPOINT` | (Optional) OTLP gRPC endpoint URL. | `http://localhost:4317` |
| `OTEL_SERVICE_NAME`| (Optional) Service name for telemetry. | `consentflow` |

---

## 4. Database & Models

The system consists primarily of three entities. Relationships: A User has many Consent Records. Audit Logs track generic events loosely linked to user strings.

### **Users**
| Field | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | Primary Key | Auto-generated standard UUID. |
| `email` | String | Unique | The user's email address. |
| `created_at` | DateTime | | Timestamp of creation. |

### **Consent Records**
| Field | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | Primary Key | Auto-generated standard UUID. |
| `user_id` | UUID | Foreign Key (`users.id`) | Maps to the data owner. |
| `data_type` | String | | Category of data (e.g. 'pii', 'webhook'). |
| `purpose` | String | | Purpose of processing (e.g. 'analytics', 'inference'). |
| `status` | Enum | `granted` \| `revoked` | The effective state of consent. |
| `updated_at` | DateTime | | Timestamp of last status change. |

### **Audit Logs**
| Field | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | Primary Key | Unique log ID. |
| `event_time` | DateTime | | Occurence timestamp. |
| `user_id` | String | | Target user ID string. |
| `gate_name` | String | | Which gate emitted the log (e.g. `inference_gate`). |
| `action_taken`| String | | Consequent action (e.g. ALLOW, BLOCKED). |
| `consent_status`| String | | Effective consent at check-time. |
| `purpose` | String | Nullable | Purpose checked for. |
| `metadata` | JSON/Dict| Nullable | Extra context / error dumps. |
| `trace_id` | String | Nullable | Link to OpenTelemetry traces. |

---

## 5. API Endpoints (Full Reference)

### System Observability
#### `GET /health`
Liveness check returning component connection status.
- **Auth Required:** No
- **Response:** `200 OK`
```json
{
  "status": "ok",
  "postgres": "ok",
  "redis": "ok"
}
```

### Users
#### `POST /users`
Register a new user.
- **Auth Required:** No
- **Request Body:**
```json
{ "email": "test@example.com" }
```
- **Response:** `201 Created`
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "test@example.com",
  "created_at": "2024-07-15T10:30:00Z"
}
```
- **Errors:** `409 Conflict` (Email exists)

#### `GET /users/{user_id}`
Retrieve a user by UUID.
- **Auth Required:** No
- **Params:** `user_id` (UUID format)
- **Response:** `200 OK` (Same schema as `POST /users`)
- **Errors:** `404 Not Found`

### Consent Management
#### `POST /consent`
Upserts a consent record (Creates or updates in-place).
- **Auth Required:** No
- **Request Body:**
```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "data_type": "pii",
  "purpose": "analytics",
  "status": "granted"
}
```
- **Response:** `200 OK`
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "data_type": "pii",
  "purpose": "analytics",
  "status": "granted",
  "updated_at": "2024-07-15T10:30:00Z"
}
```
- **Errors:** `404 Not Found` (User doesn't exist)

#### `POST /consent/revoke`
Revokes consent for ALL `data_type` rows matching a `user_id` and `purpose`.
- **Auth Required:** No
- **Request Body:**
```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "purpose": "analytics"
}
```
- **Response:** `200 OK` (Returns the most recently modified record schema similar to `POST /consent` above)
- **Errors:** `404 Not Found` (No records matched to revoke)

#### `GET /consent/{user_id}/{purpose}`
Retrieve the boolean status for a specific purpose. Backed by a Redis cache.
- **Auth Required:** No
- **Response:** `200 OK`
```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "purpose": "analytics",
  "status": "granted",
  "updated_at": "2024-07-15T10:30:00Z",
  "cached": true
}
```
- **Errors:** `404 Not Found`

### Webhook
#### `POST /webhook/consent-revoke`
Accepts automated OneTrust-style payloads. Replaces state to `revoked` and emits a Kafka event.
- **Auth Required:** No
- **Request Body:**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "purpose": "analytics",
  "consentStatus": "revoked",
  "timestamp": "2024-07-15T10:30:00Z"
}
```
- **Response:** `200 OK`
```json
{
  "status": "propagated",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "purpose": "analytics",
  "kafka_published": true,
  "warning": null
}
```
- **Errors:** 
  - `422 Unprocessable Entity` (Invalid payload shapes, or status wasn't 'revoked')
  - `207 Multi-Status` (DB succeeded, Kafka failed. Similar schema but status is "partial")

### Audit Trail
#### `GET /audit/trail`
Get structural logs of consent checks.
- **Auth Required:** No
- **Query Params:**
  - `user_id` (String UUID, optional)
  - `gate_name` (String, optional)
  - `limit` (Int, default: 100, max: 1000)
- **Response:** `200 OK`
```json
{
  "entries": [
    {
      "id": "e8a93e32-23f2-4912-9844-0c1f5442fb8e",
      "event_time": "2024-07-15T10:30:00Z",
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "gate_name": "inference_gate",
      "action_taken": "ALLOW",
      "consent_status": "granted",
      "purpose": "inference",
      "metadata": null,
      "trace_id": null
    }
  ],
  "total": 1
}
```

### Example Inference Gate Testing
#### `POST /infer/predict`
Dummy endpoint utilized to test `ConsentMiddleware` middleware logic in front of an ML model.
- **Auth Required:** Soft mechanism (ConsentMiddleware triggers on `X-User-ID`)
- **Headers Needed:** `X-User-ID: {uuid}` OR pass `user_id` in the JSON body.
- **Response:** `200 OK`
```json
{
  "status": "success",
  "message": "Inference completed safely.",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "prediction": "dummy_output"
}
```

---

## 6. Authentication & Authorization

- **No Traditional Auth:** The application does not use JWT, OAuth, or sessions extensively. It serves as an internal API layer over the DB and Redis logic.
- **Auth Strategy (Middleware Identity):** The proxy logic guarding endpoints relies on identity passing. It looks for user strings either natively included in POST Bodies mapped as `user_id`, or as a request header `X-User-ID`.
- **Public Routes:** Currently, all endpoints (including user creation and consent CRUD) are completely unprotected by permissions or role boundaries. 
- *⚠️ Note:* Since management endpoints are not protected, frontend clients theoretically shouldn't expose those endpoints randomly. Ensure this API sits behind a robust, authenticated gateway in production (VPC/BFF layer).

---

## 7. Middleware

#### `ConsentMiddleware`
Mapped via `inference_gate.py`, injected in `app/main.py`.
- **Application Scope:** Applies globally to paths starting with `/infer` (configurable).
- **Behavior:**
  1. Extracts a `User ID` via the `X-User-ID` header, OR parsing `user_id` out of the JSON request body.
  2. Queries the consent API validation method using the Redis Cache -> Postgres strategy for the purpose "inference".
  3. If missing: Rejects `400 Bad Request`.
  4. If user revoked/Not Found: Rejects `403 Forbidden`.
  5. If Redis/DB errors: Fails closed and blocks `503 Service Unavailable`.
  6. Otherwise, `.call_next()` proxies the request to the original `/infer` endpoint router.

---

## 8. Third-Party Integrations

1. **Redis:** Employed globally across the endpoints to aggressively cache consent requests, saving DB overhead on repetitive identical tests within the specified TTL (`CONSENT_CACHE_TTL=60`).
2. **PostgreSQL (`asyncpg`):** Primary database storage structure handling SQL transactional constraints, upserts, and relationships.
3. **Kafka (`aiokafka`):** When `/webhook/consent-revoke` processes successfully, the application synchronously broadcasts the new revoked consent profile to the `consent.revoked` topic alerting other pipeline components to act immediately.
4. **OpenTelemetry:** Tracing middleware natively implemented into application lifespan loops dynamically gathering logs and storing formatted telemetry outputs into `audit_log` trails.

---

## 9. Error Handling

### Global HTTP Context
FastAPI will output standard HTTP `422 Unprocessable Entity` structures for Pydantic schema validation failures (like poorly formatted UUIDs).

### Common Application Codes
- `400 Bad Request`: Endpoint requires an identity variable but couldn't resolve it out of bodies/headers.
- `403 Forbidden`: Consent validation was processed, but the profile mandates data usage was revoked.
- `404 Not Found`: Expected entities were not present in the database.
- `409 Conflict`: Usually occurs on user creation against Unique constraints (e.g., duplicated email addresses).
- `500 Server Error`: Postgres failures underneath asyncpg fetches.
- `503 Service Unavailable`: Dependent tools representing consent engines fail, gating middleware will fail-close to block inference queries by default.
- `207 Multi-Status`: Indicates the webhook data persisted safely (DB/Cache), but an asynchronous/synchronous background task failed heavily (Cannot publish to Kafka).

---

## 10. Frontend Integration Notes

1. **Base URL:** API binds natively via root mapping (No `/api` or `/v1` prefix namespaces) relative to the server location binding.
2. **CORS (⚠️ Note):** Within `main.py`, FastAPI `CORSMiddleware` is **strictly missing**. Browsers attempting cross-domain AJAX requests will fail outright due to CORS violation blocks. If hosting decoupled, you will need to amend `main.py` with the FastAPI `add_middleware(CORSMiddleware)` snippet defining your `allowed_origins=[...]` safely, or proxy requests via your Frontend (like Next.js API Routes).
3. **HTTP Identity Headers:** When building queries towards guarded scopes (like `/infer/predict` tests), explicitly ensure axios/fetch definitions assign `{ "X-User-ID": "valid-uuid-here" }`.
4. **Data Shapes:** Be highly mindful of string formats. The application uses rigid UUID parsers. Providing standard string IDs (or random integers) will cause `422` validation failure cascades globally.
5. **No File Uploads, No WebSockets:** Operations utilize classic REST JSON structures. Real-time updates occur system-to-system over Kafka, not over frontend socket loops. Frontend state polling (e.g. SWR/TanStack) should be employed to auto-refresh consent matrices.

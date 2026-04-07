# ConsentFlow

**Consent-enforcement middleware for AI pipelines.**

ConsentFlow is a backend service that acts as the foundational data layer for tracking and enforcing user consent in AI-driven applications. It exposes a simple REST API, backed by PostgreSQL (persistent store) and Redis (60-second read cache).

---

## Architecture

```
Client ──► FastAPI app
               │
               ├── Redis  (consent:{user_id}:{purpose}  TTL 60s)
               └── PostgreSQL  (consent_records table)
```

---

## Quick Start (local dev with Docker)

```bash
# 1. Copy env file and edit credentials if needed
cp .env.example .env

# 2. Start all services (postgres + redis + app)
docker compose up --build

# 3. Visit the interactive API docs
open http://localhost:8000/docs
```

---

## Local Dev (without Docker)

Requires [uv](https://docs.astral.sh/uv/getting-started/installation/) and local Postgres/Redis.

```bash
# Install all dependencies (including dev)
uv sync

# Configure environment
cp .env.example .env
# edit .env with your local Postgres / Redis credentials

# Run migrations manually (first time)
psql -U consentflow -d consentflow -f consentflow/migrations/001_init.sql

# Start the dev server with hot-reload
uv run uvicorn consentflow.app.main:app --reload
```

The app auto-applies all migrations in `consentflow/migrations/` on every startup — safe to run repeatedly (all DDL uses `IF NOT EXISTS`).

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check (Postgres + Redis) |
| `POST` | `/consent` | Upsert a consent record |
| `GET` | `/consent/{user_id}/{purpose}` | Get current status (Redis-cached) |
| `POST` | `/consent/revoke` | Revoke consent for a user+purpose |

Full interactive docs at `/docs` (Swagger UI) and `/redoc`.

### Example requests

```bash
# Grant consent
curl -X POST http://localhost:8000/consent \
  -H 'Content-Type: application/json' \
  -d '{
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "data_type": "pii",
    "purpose": "analytics",
    "status": "granted"
  }'

# Check status (cached after first hit)
curl http://localhost:8000/consent/550e8400-e29b-41d4-a716-446655440000/analytics

# Revoke
curl -X POST http://localhost:8000/consent/revoke \
  -H 'Content-Type: application/json' \
  -d '{
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "purpose": "analytics"
  }'
```

---

## Package management

This project uses **[uv](https://docs.astral.sh/uv/)** exclusively.

```bash
# Add a new production dependency
uv add <package>

# Add a new dev dependency
uv add --dev <package>

# Run any script inside the project virtualenv
uv run <command>
```

Never use `pip`, `pip-compile`, or `requirements.txt`.

---

## Project structure

```
consentflow/
├── app/
│   ├── main.py          # FastAPI app factory + lifespan
│   ├── config.py        # Settings via pydantic-settings
│   ├── models.py        # Pydantic v2 request/response models
│   ├── db.py            # asyncpg connection pool
│   ├── cache.py         # Redis helpers (get/set/invalidate)
│   └── routers/
│       └── consent.py   # /consent endpoints
└── migrations/
    └── 001_init.sql     # Initial schema (users + consent_records)
docker-compose.yml
Dockerfile
pyproject.toml
uv.lock
.env.example
```

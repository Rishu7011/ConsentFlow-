"""
main.py — FastAPI application entry point.

Lifespan:
  - Startup:  create asyncpg pool + Redis client, run DB migrations
  - Shutdown: gracefully close both connections
"""
from __future__ import annotations

import logging
import pathlib
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from consentflow.app.cache import (
    check_redis,
    close_redis_client,
    create_redis_client,
)
from consentflow.app.config import settings
from consentflow.app.db import check_postgres, close_pool, create_pool
from consentflow.app.models import HealthResponse
from consentflow.app.routers import consent as consent_router

# ── Logging ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

MIGRATIONS_DIR = pathlib.Path(__file__).parent.parent / "migrations"


# ── Lifespan ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    FastAPI lifespan context manager.
    Sets up the DB pool and Redis client, runs SQL migrations on startup,
    then tears everything down on shutdown.
    """
    # ── Startup ──────────────────────────────────────────────────────────────
    logger.info("Starting ConsentFlow (env=%s)", settings.app_env)

    # PostgreSQL
    pool = await create_pool()
    app.state.db_pool = pool

    # Run migrations in order
    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    async with pool.acquire() as conn:
        for migration in migration_files:
            logger.info("Applying migration: %s", migration.name)
            sql = migration.read_text(encoding="utf-8")
            await conn.execute(sql)

    # Redis
    redis_client = await create_redis_client()
    app.state.redis_client = redis_client

    logger.info("ConsentFlow startup complete ✓")
    yield

    # ── Shutdown ─────────────────────────────────────────────────────────────
    logger.info("Shutting down ConsentFlow…")
    await close_redis_client(app.state.redis_client)
    await close_pool(app.state.db_pool)
    logger.info("ConsentFlow shutdown complete ✓")


# ── Application factory ────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    app = FastAPI(
        title="ConsentFlow",
        description=(
            "Consent-enforcement middleware for AI pipelines. "
            "Provides a foundational data layer and REST API for managing "
            "user consent records."
        ),
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # ── Routers ───────────────────────────────────────────────────────────────
    app.include_router(consent_router.router)

    # ── Health endpoint ───────────────────────────────────────────────────────
    @app.get(
        "/health",
        response_model=HealthResponse,
        tags=["observability"],
        summary="Liveness check",
        description="Returns the health of Postgres and Redis connections.",
    )
    async def health(request: Request) -> HealthResponse:
        pg_status = await check_postgres(request.app.state.db_pool)
        redis_status = await check_redis(request.app.state.redis_client)
        overall = "ok" if pg_status == "ok" and redis_status == "ok" else "degraded"
        return HealthResponse(
            status=overall,
            postgres=pg_status,
            redis=redis_status,
        )

    return app


app = create_app()

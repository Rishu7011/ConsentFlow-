"""
routers/users.py — User registration endpoint.

Endpoints
---------
POST   /users          — create a new user (returns the new UUID)
GET    /users/{user_id} — look up an existing user by UUID
"""
from __future__ import annotations

import logging
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, status

from consentflow.app.models import UserCreateRequest, UserRecord

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["users"])


# ── Dependency helpers ─────────────────────────────────────────────────────────

def _get_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.db_pool


# ── POST /users ────────────────────────────────────────────────────────────────

@router.post(
    "",
    response_model=UserRecord,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user",
    description=(
        "Creates a new user row with a server-generated UUID. "
        "The UUID returned here is what you pass as `user_id` in "
        "consent requests. Returns 409 if the e-mail is already registered."
    ),
)
async def create_user(
    body: UserCreateRequest,
    pool: asyncpg.Pool = Depends(_get_pool),
) -> UserRecord:
    sql = """
        INSERT INTO users (email)
        VALUES ($1)
        RETURNING id, email, created_at
    """
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(sql, body.email)
    except asyncpg.UniqueViolationError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A user with email '{body.email}' already exists.",
        )
    except asyncpg.PostgresError as exc:
        logger.error("DB error creating user: %s", exc)
        raise HTTPException(status_code=500, detail="Database error")

    return UserRecord(
        id=row["id"],
        email=row["email"],
        created_at=row["created_at"],
    )


# ── GET /users/{user_id} ───────────────────────────────────────────────────────

@router.get(
    "/{user_id}",
    response_model=UserRecord,
    status_code=status.HTTP_200_OK,
    summary="Look up a user by UUID",
    description="Returns the user record for the given UUID, or 404 if not found.",
)
async def get_user(
    user_id: UUID,
    pool: asyncpg.Pool = Depends(_get_pool),
) -> UserRecord:
    sql = """
        SELECT id, email, created_at
          FROM users
         WHERE id = $1
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(sql, user_id)

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id} not found.",
        )

    return UserRecord(
        id=row["id"],
        email=row["email"],
        created_at=row["created_at"],
    )

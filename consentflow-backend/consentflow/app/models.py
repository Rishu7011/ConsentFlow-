from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, model_validator


class ConsentStatus(str, Enum):
    granted = "granted"
    revoked = "revoked"


# ── Request models ─────────────────────────────────────────────────────────────


class ConsentUpsertRequest(BaseModel):
    """Payload for POST /consent — grant or revoke a consent record."""

    user_id: UUID = Field(..., description="UUID of the user")
    data_type: str = Field(..., min_length=1, max_length=128, description="Category of data (e.g. 'pii', 'usage')")
    purpose: str = Field(..., min_length=1, max_length=256, description="Processing purpose (e.g. 'analytics')")
    status: ConsentStatus = Field(..., description="'granted' or 'revoked'")


class ConsentRevokeRequest(BaseModel):
    """Payload for POST /consent/revoke."""

    user_id: UUID = Field(..., description="UUID of the user")
    purpose: str = Field(..., min_length=1, max_length=256, description="Purpose to revoke")


class UserCreateRequest(BaseModel):
    """Payload for creating a new user (utility endpoint)."""

    email: EmailStr = Field(..., description="User's e-mail address")


# ── Response models ────────────────────────────────────────────────────────────


class ConsentRecord(BaseModel):
    """Full consent record returned from the DB."""

    id: UUID
    user_id: UUID
    data_type: str
    purpose: str
    status: ConsentStatus
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConsentStatusResponse(BaseModel):
    """Lightweight status lookup response for GET /consent/{user_id}/{purpose}."""

    user_id: UUID
    purpose: str
    status: ConsentStatus
    updated_at: datetime
    cached: bool = Field(default=False, description="True when the result was served from Redis")


class UserRecord(BaseModel):
    id: UUID
    email: str
    created_at: datetime

    model_config = {"from_attributes": True}


class HealthResponse(BaseModel):
    status: str = "ok"
    postgres: str
    redis: str


# ── Step 7: Audit log models ───────────────────────────────────────────────────


class AuditLogEntry(BaseModel):
    """A single row from the audit_log table."""

    id: UUID
    event_time: datetime
    user_id: str
    gate_name: str
    action_taken: str
    consent_status: str
    purpose: str | None = None
    metadata: dict | None = None
    trace_id: str | None = None

    model_config = {"from_attributes": True}


class AuditTrailResponse(BaseModel):
    """Response envelope for GET /audit/trail."""

    entries: list[AuditLogEntry]
    total: int

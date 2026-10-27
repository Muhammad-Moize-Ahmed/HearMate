import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from ...core.schemas import InputModel
from ...db.models import TherapistApprovalStatus, UserRole, UserStatus


class TherapistOut(BaseModel):
    id: uuid.UUID
    email: str
    first_name: str
    last_name: str
    email_verified: bool
    license_number: str | None
    organization: str | None
    specialization: str | None
    approval_status: TherapistApprovalStatus
    rejection_reason: str | None
    reviewed_at: datetime | None
    created_at: datetime


class RejectTherapistIn(InputModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class AdminUserOut(BaseModel):
    """An adult account, as an admin sees it. Children never appear here except as a count."""

    id: uuid.UUID
    email: str
    first_name: str
    last_name: str
    role: UserRole
    status: UserStatus
    email_verified: bool
    therapist_status: TherapistApprovalStatus | None = Field(
        description="Therapists only; null for other roles"
    )
    children_count: int | None = Field(description="Parents only; null for other roles")
    created_at: datetime
    last_login_at: datetime | None


class AdminUserPageOut(BaseModel):
    items: list[AdminUserOut]
    total: int = Field(description="Matching accounts across all pages")
    limit: int
    offset: int


class TherapistCountsOut(BaseModel):
    total: int
    pending: int
    approved: int
    rejected: int


class AdminStatsOut(BaseModel):
    """Counts only: no names, usernames or other personal details."""

    parents: int
    therapists: TherapistCountsOut
    admins: int
    disabled_accounts: int
    children: int
    sessions_completed_last_7_days: int
    sessions_completed_last_30_days: int

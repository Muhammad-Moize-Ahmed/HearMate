import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, StringConstraints

from ...db.models import TherapistApprovalStatus


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


class RejectTherapistIn(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]

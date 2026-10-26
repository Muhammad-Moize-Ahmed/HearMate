import uuid
from datetime import datetime

from pydantic import BaseModel

from ...core.schemas import InputModel
from ...db.models import TherapistApprovalStatus, TherapistLinkStatus
from ..auth.schemas import Email
from ..children.schemas import ChildSummaryOut


class InviteTherapistIn(InputModel):
    email: Email


class TherapistBriefOut(BaseModel):
    id: uuid.UUID
    first_name: str
    last_name: str
    email: str
    organization: str | None
    specialization: str | None
    approval_status: TherapistApprovalStatus


class ParentBriefOut(BaseModel):
    first_name: str
    last_name: str


class ParentLinkOut(BaseModel):
    """A therapist on a child's care team, as the parent sees it."""

    id: uuid.UUID
    status: TherapistLinkStatus
    therapist: TherapistBriefOut
    created_at: datetime
    accepted_at: datetime | None


class TherapistLinkOut(BaseModel):
    """An invitation or active link, as the therapist sees it."""

    id: uuid.UUID
    status: TherapistLinkStatus
    child: ChildSummaryOut
    parent: ParentBriefOut
    created_at: datetime
    accepted_at: datetime | None

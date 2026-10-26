import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.audit import record_event
from ...core.errors import NotFoundError
from ...db.models import TherapistApprovalStatus, TherapistProfile, User, UserRole
from ...providers.email import EmailMessage
from ..auth import emails
from .schemas import TherapistOut


class AdminService:
    def __init__(self, db: Session, *, admin_id: uuid.UUID, client_ip: str | None) -> None:
        self.db = db
        self.admin_id = admin_id
        self.client_ip = client_ip
        self.outbox: list[EmailMessage] = []

    def list_therapists(self, status: TherapistApprovalStatus | None) -> list[TherapistOut]:
        query = (
            select(User, TherapistProfile)
            .join(TherapistProfile, TherapistProfile.user_id == User.id)
            .where(User.role == UserRole.THERAPIST)
            .order_by(TherapistProfile.created_at)
        )
        if status is not None:
            query = query.where(TherapistProfile.approval_status == status)
        return [_to_out(user, profile) for user, profile in self.db.execute(query)]

    def decide(
        self, therapist_id: uuid.UUID, *, approve: bool, reason: str | None = None
    ) -> TherapistOut:
        user = self.db.get(User, therapist_id)
        profile = self.db.get(TherapistProfile, therapist_id)
        if user is None or profile is None or user.role is not UserRole.THERAPIST:
            raise NotFoundError("Therapist not found")

        profile.approval_status = (
            TherapistApprovalStatus.APPROVED if approve else TherapistApprovalStatus.REJECTED
        )
        profile.rejection_reason = None if approve else reason
        profile.reviewed_by_id = self.admin_id
        profile.reviewed_at = datetime.now(UTC)
        record_event(
            self.db,
            "therapist_approved" if approve else "therapist_rejected",
            resource_type="user",
            resource_id=user.id,
            actor_user_id=self.admin_id,
            ip_address=self.client_ip,
        )
        self.db.commit()
        self.outbox.append(
            emails.therapist_decision(user.email, user.first_name, approved=approve, reason=reason)
        )
        return _to_out(user, profile)


def _to_out(user: User, profile: TherapistProfile) -> TherapistOut:
    return TherapistOut(
        id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        email_verified=user.email_verified_at is not None,
        license_number=profile.license_number,
        organization=profile.organization,
        specialization=profile.specialization,
        approval_status=profile.approval_status,
        rejection_reason=profile.rejection_reason,
        reviewed_at=profile.reviewed_at,
        created_at=profile.created_at,
    )

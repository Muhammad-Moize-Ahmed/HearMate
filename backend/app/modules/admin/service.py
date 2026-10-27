import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.orm import Session

from ...core.audit import record_event
from ...core.errors import NotFoundError
from ...db.models import (
    Child,
    GameSession,
    SessionStatus,
    TherapistApprovalStatus,
    TherapistProfile,
    User,
    UserRole,
    UserStatus,
)
from ...providers.email import EmailMessage
from ..auth import emails
from .schemas import (
    AdminStatsOut,
    AdminUserOut,
    AdminUserPageOut,
    TherapistCountsOut,
    TherapistOut,
)


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

    def list_users(
        self,
        *,
        search: str | None,
        role: UserRole | None,
        status: UserStatus | None,
        limit: int,
        offset: int,
    ) -> AdminUserPageOut:
        """Adult accounts, newest first. Read-only; children are only counted per parent."""
        filters: list[ColumnElement[bool]] = []
        if search:
            pattern = f"%{_escape_like(search)}%"
            full_name = User.first_name + " " + User.last_name
            filters.append(
                or_(
                    User.email.ilike(pattern, escape="\\"),
                    full_name.ilike(pattern, escape="\\"),
                )
            )
        if role is not None:
            filters.append(User.role == role)
        if status is not None:
            filters.append(User.status == status)

        total = self.db.scalar(select(func.count()).select_from(User).where(*filters)) or 0
        children = (
            select(Child.parent_id, func.count().label("n")).group_by(Child.parent_id).subquery()
        )
        rows = self.db.execute(
            select(User, TherapistProfile.approval_status, children.c.n)
            .outerjoin(TherapistProfile, TherapistProfile.user_id == User.id)
            .outerjoin(children, children.c.parent_id == User.id)
            .where(*filters)
            .order_by(User.created_at.desc(), User.id)
            .limit(limit)
            .offset(offset)
        )
        items = [
            AdminUserOut(
                id=user.id,
                email=user.email,
                first_name=user.first_name,
                last_name=user.last_name,
                role=user.role,
                status=user.status,
                email_verified=user.email_verified_at is not None,
                therapist_status=approval if user.role is UserRole.THERAPIST else None,
                children_count=(n or 0) if user.role is UserRole.PARENT else None,
                created_at=user.created_at,
                last_login_at=user.last_login_at,
            )
            for user, approval, n in rows
        ]
        return AdminUserPageOut(items=items, total=total, limit=limit, offset=offset)

    def stats(self) -> AdminStatsOut:
        """Counts only, for the dashboard."""
        roles: dict[UserRole, int] = dict(
            self.db.execute(select(User.role, func.count()).group_by(User.role)).all()
        )
        approvals: dict[TherapistApprovalStatus, int] = dict(
            self.db.execute(
                select(TherapistProfile.approval_status, func.count())
                .join(User, User.id == TherapistProfile.user_id)
                .where(User.role == UserRole.THERAPIST)
                .group_by(TherapistProfile.approval_status)
            ).all()
        )
        now = datetime.now(UTC)

        def completed_since(days: int) -> int:
            return (
                self.db.scalar(
                    select(func.count())
                    .select_from(GameSession)
                    .where(
                        GameSession.status == SessionStatus.COMPLETED,
                        GameSession.completed_at >= now - timedelta(days=days),
                    )
                )
                or 0
            )

        return AdminStatsOut(
            parents=roles.get(UserRole.PARENT, 0),
            therapists=TherapistCountsOut(
                total=roles.get(UserRole.THERAPIST, 0),
                pending=approvals.get(TherapistApprovalStatus.PENDING, 0),
                approved=approvals.get(TherapistApprovalStatus.APPROVED, 0),
                rejected=approvals.get(TherapistApprovalStatus.REJECTED, 0),
            ),
            admins=roles.get(UserRole.ADMIN, 0),
            disabled_accounts=self.db.scalar(
                select(func.count()).select_from(User).where(User.status == UserStatus.DISABLED)
            )
            or 0,
            children=self.db.scalar(select(func.count()).select_from(Child)) or 0,
            sessions_completed_last_7_days=completed_since(7),
            sessions_completed_last_30_days=completed_since(30),
        )

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


def _escape_like(text: str) -> str:
    """Make LIKE wildcards in a search match themselves."""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

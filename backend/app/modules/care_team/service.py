import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...auth.policies import get_editable_child
from ...auth.principal import Principal
from ...core.audit import record_event
from ...core.errors import ConflictError, NotFoundError, PermissionDeniedError
from ...db.models import (
    Child,
    TherapistChildLink,
    TherapistLinkStatus,
    TherapistProfile,
    User,
    UserRole,
    UserStatus,
)
from ...providers.email import EmailMessage
from ..children.service import to_child_summary
from . import emails
from .schemas import ParentBriefOut, ParentLinkOut, TherapistBriefOut, TherapistLinkOut

LIVE = (TherapistLinkStatus.PENDING, TherapistLinkStatus.ACTIVE)


class CareTeamService:
    """Parent invites a therapist to one child; the therapist accepts; either side can end it."""

    def __init__(self, db: Session, principal: Principal, *, client_ip: str | None) -> None:
        self.db = db
        self.principal = principal
        self.client_ip = client_ip
        self.outbox: list[EmailMessage] = []

    # ------------------------------------------------------------------ parent side

    def list_for_child(self, child_id: uuid.UUID) -> list[ParentLinkOut]:
        child = get_editable_child(self.db, self.principal, child_id)
        rows = self.db.execute(
            select(TherapistChildLink, User, TherapistProfile)
            .join(User, User.id == TherapistChildLink.therapist_id)
            .join(TherapistProfile, TherapistProfile.user_id == User.id)
            .where(TherapistChildLink.child_id == child.id, TherapistChildLink.status.in_(LIVE))
            .order_by(TherapistChildLink.created_at)
        )
        return [_parent_view(link, user, profile) for link, user, profile in rows]

    def invite(self, child_id: uuid.UUID, email: str) -> ParentLinkOut:
        child = get_editable_child(self.db, self.principal, child_id)
        therapist = self.db.scalar(
            select(User).where(
                User.email == email,
                User.role == UserRole.THERAPIST,
                User.status == UserStatus.ACTIVE,
            )
        )
        profile = self.db.get(TherapistProfile, therapist.id) if therapist else None
        if therapist is None or profile is None:
            raise NotFoundError(
                "No therapist account uses that email. Ask them to sign up as a therapist first.",
                code="therapist_not_found",
            )
        if self._live_link(therapist.id, child.id) is not None:
            raise ConflictError(
                "This therapist is already invited or linked", code="already_linked"
            )

        link = TherapistChildLink(
            therapist_id=therapist.id,
            child_id=child.id,
            granted_by_parent_id=self.principal.id,
            status=TherapistLinkStatus.PENDING,
        )
        self.db.add(link)
        try:
            self.db.flush()
        except IntegrityError as exc:  # a concurrent invite created the same link
            self.db.rollback()
            raise ConflictError(
                "This therapist is already invited or linked", code="already_linked"
            ) from exc
        self._audit(link, "therapist_invited")
        self.db.commit()

        parent = self.db.get(User, self.principal.id)
        assert parent is not None  # noqa: S101 - the caller is an authenticated parent
        self.outbox.append(
            emails.therapist_invited(
                therapist.email, therapist.first_name, _full_name(parent), child.display_name
            )
        )
        return _parent_view(link, therapist, profile)

    def revoke_for_child(self, child_id: uuid.UUID, link_id: uuid.UUID) -> None:
        child = get_editable_child(self.db, self.principal, child_id)
        link = self.db.get(TherapistChildLink, link_id)
        if link is None or link.child_id != child.id or link.status not in LIVE:
            raise NotFoundError("Link not found")
        self._revoke(link, "therapist_link_revoked_by_parent")

    # ------------------------------------------------------------------ therapist side

    def list_mine(self, status: TherapistLinkStatus | None) -> list[TherapistLinkOut]:
        statuses = (status,) if status is not None else LIVE
        rows = self.db.execute(
            select(TherapistChildLink, Child, User)
            .join(Child, Child.id == TherapistChildLink.child_id)
            .join(User, User.id == Child.parent_id)
            .where(
                TherapistChildLink.therapist_id == self.principal.id,
                TherapistChildLink.status.in_(statuses),
            )
            .order_by(TherapistChildLink.created_at)
        )
        return [_therapist_view(link, child, parent) for link, child, parent in rows]

    def accept(self, link_id: uuid.UUID) -> TherapistLinkOut:
        if not self.principal.therapist_approved:
            raise PermissionDeniedError(
                "Your therapist account is awaiting admin approval", code="therapist_not_approved"
            )
        link = self._my_link(link_id)
        if link.status is not TherapistLinkStatus.PENDING:
            raise ConflictError("This invitation is no longer pending", code="not_pending")

        link.status = TherapistLinkStatus.ACTIVE
        link.accepted_at = datetime.now(UTC)
        self._audit(link, "therapist_link_accepted")
        self.db.commit()

        child = self.db.get(Child, link.child_id)
        parent = self.db.get(User, child.parent_id) if child else None
        therapist = self.db.get(User, self.principal.id)
        assert child and parent and therapist  # noqa: S101 - rows exist via foreign keys
        self.outbox.append(
            emails.invitation_accepted(
                parent.email, parent.first_name, _full_name(therapist), child.display_name
            )
        )
        return _therapist_view(link, child, parent)

    def leave(self, link_id: uuid.UUID) -> None:
        """Decline an invitation or stop following a child."""
        link = self._my_link(link_id)
        self._revoke(link, "therapist_link_ended_by_therapist")

    # ------------------------------------------------------------------ helpers

    def _my_link(self, link_id: uuid.UUID) -> TherapistChildLink:
        link = self.db.get(TherapistChildLink, link_id)
        if link is None or link.therapist_id != self.principal.id or link.status not in LIVE:
            raise NotFoundError("Link not found")
        return link

    def _live_link(self, therapist_id: uuid.UUID, child_id: uuid.UUID) -> TherapistChildLink | None:
        return self.db.scalar(
            select(TherapistChildLink).where(
                TherapistChildLink.therapist_id == therapist_id,
                TherapistChildLink.child_id == child_id,
                TherapistChildLink.status.in_(LIVE),
            )
        )

    def _revoke(self, link: TherapistChildLink, action: str) -> None:
        link.status = TherapistLinkStatus.REVOKED
        link.revoked_at = datetime.now(UTC)
        self._audit(link, action)
        self.db.commit()

    def _audit(self, link: TherapistChildLink, action: str) -> None:
        record_event(
            self.db,
            action,
            resource_type="therapist_link",
            resource_id=link.id,
            actor_user_id=self.principal.id,
            child_id=link.child_id,
            ip_address=self.client_ip,
            details={"therapist_id": str(link.therapist_id)},
        )


def _full_name(user: User) -> str:
    return f"{user.first_name} {user.last_name}".strip()


def _parent_view(link: TherapistChildLink, user: User, profile: TherapistProfile) -> ParentLinkOut:
    return ParentLinkOut(
        id=link.id,
        status=link.status,
        therapist=TherapistBriefOut(
            id=user.id,
            first_name=user.first_name,
            last_name=user.last_name,
            email=user.email,
            organization=profile.organization,
            specialization=profile.specialization,
            approval_status=profile.approval_status,
        ),
        created_at=link.created_at,
        accepted_at=link.accepted_at,
    )


def _therapist_view(link: TherapistChildLink, child: Child, parent: User) -> TherapistLinkOut:
    return TherapistLinkOut(
        id=link.id,
        status=link.status,
        child=to_child_summary(child),
        parent=ParentBriefOut(first_name=parent.first_name, last_name=parent.last_name),
        created_at=link.created_at,
        accepted_at=link.accepted_at,
    )

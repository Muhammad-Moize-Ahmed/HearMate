import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...auth.passwords import hash_secret
from ...auth.policies import get_editable_child, get_viewable_child
from ...auth.principal import Principal, PrincipalKind
from ...core.audit import record_event
from ...core.errors import ConflictError, PermissionDeniedError
from ...db.models import Child, RefreshToken, TherapistChildLink, TherapistLinkStatus
from .schemas import (
    ChildCreateIn,
    ChildLoginIn,
    ChildLoginOut,
    ChildOut,
    ChildSummaryOut,
    ChildUpdateIn,
    age_in_years,
)


class ChildrenService:
    def __init__(self, db: Session, principal: Principal, *, client_ip: str | None) -> None:
        self.db = db
        self.principal = principal
        self.client_ip = client_ip

    def list(self) -> list[Child]:
        """The children this caller may see: own, linked (therapist) or self (child)."""
        match self.principal.kind:
            case PrincipalKind.PARENT:
                query = select(Child).where(Child.parent_id == self.principal.id)
            case PrincipalKind.CHILD:
                query = select(Child).where(Child.id == self.principal.id)
            case PrincipalKind.THERAPIST:
                if not self.principal.therapist_approved:
                    return []
                query = (
                    select(Child)
                    .join(TherapistChildLink, TherapistChildLink.child_id == Child.id)
                    .where(
                        TherapistChildLink.therapist_id == self.principal.id,
                        TherapistChildLink.status == TherapistLinkStatus.ACTIVE,
                    )
                )
            case PrincipalKind.ADMIN:
                raise PermissionDeniedError("Admins do not have access to children's data")
        return list(self.db.scalars(query.order_by(Child.created_at)))

    def get(self, child_id: uuid.UUID) -> Child:
        child = get_viewable_child(self.db, self.principal, child_id)
        self._audit_therapist_access(child, "child_viewed")
        return child

    def create(self, data: ChildCreateIn) -> Child:
        child = Child(parent_id=self.principal.id, **data.model_dump())
        self.db.add(child)
        self.db.flush()
        self._audit(child, "child_created")
        self.db.commit()
        return child

    def update(self, child_id: uuid.UUID, data: ChildUpdateIn) -> Child:
        child = get_editable_child(self.db, self.principal, child_id)
        changes = data.model_dump(exclude_unset=True)
        for field, value in changes.items():
            setattr(child, field, value)
        self._audit(child, "child_updated", details={"fields": sorted(changes)})
        self.db.commit()
        self.db.refresh(child)
        return child

    def set_login(self, child_id: uuid.UUID, data: ChildLoginIn) -> Child:
        """Create or change the child's username and PIN. Signs the child out everywhere."""
        child = get_editable_child(self.db, self.principal, child_id)
        taken = self.db.scalar(
            select(Child.id).where(Child.username == data.username, Child.id != child.id)
        )
        if taken is not None:
            raise ConflictError("That username is already taken", code="username_taken")

        child.username = data.username
        child.pin_hash = hash_secret(data.pin)
        child.failed_login_count = 0
        child.locked_until = None
        self._revoke_child_sessions(child)
        self._audit(child, "child_login_set")
        try:
            self.db.commit()
        except IntegrityError as exc:  # another child took the username at the same moment
            self.db.rollback()
            raise ConflictError("That username is already taken", code="username_taken") from exc
        self.db.refresh(child)
        return child

    def remove_login(self, child_id: uuid.UUID) -> Child:
        child = get_editable_child(self.db, self.principal, child_id)
        child.username = None
        child.pin_hash = None
        self._revoke_child_sessions(child)
        self._audit(child, "child_login_removed")
        self.db.commit()
        self.db.refresh(child)
        return child

    def _revoke_child_sessions(self, child: Child) -> None:
        self.db.execute(
            update(RefreshToken)
            .where(RefreshToken.child_id == child.id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )

    def _audit(self, child: Child, action: str, details: dict[str, object] | None = None) -> None:
        record_event(
            self.db,
            action,
            resource_type="child",
            resource_id=child.id,
            actor_user_id=self.principal.id,
            child_id=child.id,
            ip_address=self.client_ip,
            details=details,
        )

    def _audit_therapist_access(self, child: Child, action: str) -> None:
        """Parents can later see which professionals looked at their child's data, and when."""
        if self.principal.kind is PrincipalKind.THERAPIST:
            self._audit(child, action)
            self.db.commit()


def to_child_out(child: Child, viewer: Principal) -> ChildOut:
    is_parent = viewer.kind is PrincipalKind.PARENT and child.parent_id == viewer.id
    login = ChildLoginOut(username=child.username) if is_parent and child.username else None
    return ChildOut(
        id=child.id,
        display_name=child.display_name,
        date_of_birth=child.date_of_birth,
        age_years=age_in_years(child.date_of_birth),
        gender=child.gender,
        avatar=child.avatar,
        hearing_difficulties=child.hearing_difficulties,
        speech_challenges=child.speech_challenges,
        interests=child.interests,
        focus_areas=child.focus_areas,
        learning_environment=child.learning_environment,
        attention_span=child.attention_span,
        preferred_learning_style=child.preferred_learning_style,
        session_length_minutes=child.session_length_minutes,
        notes=None if viewer.is_child else child.notes,
        timezone=child.timezone,
        login=login,
        created_at=child.created_at,
        updated_at=child.updated_at,
    )


def to_child_summary(child: Child) -> ChildSummaryOut:
    return ChildSummaryOut(
        id=child.id,
        display_name=child.display_name,
        age_years=age_in_years(child.date_of_birth),
        avatar=child.avatar,
    )

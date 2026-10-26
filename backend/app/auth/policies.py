"""Who may do what with a child's data. Every child-scoped route goes through these.

Admins manage accounts but deliberately get no access to children's therapy data.
"""

import uuid

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from ..core.errors import NotFoundError, PermissionDeniedError
from ..db.models import Child, TherapistChildLink, TherapistLinkStatus
from .principal import Principal, PrincipalKind


def _has_active_link(db: Session, therapist_id: uuid.UUID, child_id: uuid.UUID) -> bool:
    return bool(
        db.scalar(
            select(
                exists().where(
                    TherapistChildLink.therapist_id == therapist_id,
                    TherapistChildLink.child_id == child_id,
                    TherapistChildLink.status == TherapistLinkStatus.ACTIVE,
                )
            )
        )
    )


def can_view_child(db: Session, principal: Principal, child: Child) -> bool:
    match principal.kind:
        case PrincipalKind.PARENT:
            return child.parent_id == principal.id
        case PrincipalKind.CHILD:
            return child.id == principal.id
        case PrincipalKind.THERAPIST:
            return principal.therapist_approved and _has_active_link(db, principal.id, child.id)
        case PrincipalKind.ADMIN:
            return False


def can_edit_child(principal: Principal, child: Child) -> bool:
    """Profile, login and sharing settings: the owning parent only."""
    return principal.kind is PrincipalKind.PARENT and child.parent_id == principal.id


def can_manage_plan(db: Session, principal: Principal, child: Child) -> bool:
    """Learning plans and therapist notes: an approved therapist linked to the child."""
    return (
        principal.kind is PrincipalKind.THERAPIST
        and principal.therapist_approved
        and _has_active_link(db, principal.id, child.id)
    )


def can_read_plan(db: Session, principal: Principal, child: Child) -> bool:
    """Learning plans and therapist notes are read by the parent and the managing therapists.

    Not the child: notes are clinical and written for adults.
    """
    return can_edit_child(principal, child) or can_manage_plan(db, principal, child)


def get_viewable_child(db: Session, principal: Principal, child_id: uuid.UUID) -> Child:
    """404 (not 403) when the caller can't see the child, so IDs reveal nothing."""
    child = db.get(Child, child_id)
    if child is None or not can_view_child(db, principal, child):
        raise NotFoundError("Child not found")
    return child


def get_editable_child(db: Session, principal: Principal, child_id: uuid.UUID) -> Child:
    child = get_viewable_child(db, principal, child_id)
    if not can_edit_child(principal, child):
        raise PermissionDeniedError("Only the child's parent can change this")
    return child


def get_plan_readable_child(db: Session, principal: Principal, child_id: uuid.UUID) -> Child:
    child = get_viewable_child(db, principal, child_id)
    if not can_read_plan(db, principal, child):
        raise PermissionDeniedError("Learning plans and notes are for parents and therapists")
    return child


def get_plan_managed_child(db: Session, principal: Principal, child_id: uuid.UUID) -> Child:
    child = get_viewable_child(db, principal, child_id)
    if not can_manage_plan(db, principal, child):
        raise PermissionDeniedError("Only a linked therapist can manage the learning plan")
    return child

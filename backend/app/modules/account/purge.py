"""Permanent deletion: a whole family, one child, or a therapist's account.

Rows go by the database's ON DELETE rules (see db/models): a family's data cascades from the
parent's and children's rows; a deleted therapist's notes and learning plans stay with the child,
with no author (SET NULL). The audit log needs explicit work, because it also names people where no
foreign key reaches: ids kept as plain strings (`resource_id`, `details`) and IP addresses.

Nothing here commits; the caller does, once, so a deletion happens completely or not at all.
"""

import uuid
from collections.abc import Collection
from dataclasses import dataclass

from sqlalchemy import delete, false, func, literal, or_, select, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from ...core.audit import record_event
from ...db.models import (
    AuditLog,
    Child,
    GameSession,
    LearningPlan,
    SessionStatus,
    TherapistChildLink,
    TherapistLinkStatus,
    TherapistNote,
    User,
)

# Pending invitations and active links; revoked ones gave up access already.
LIVE_LINK = TherapistChildLink.status != TherapistLinkStatus.REVOKED


@dataclass(frozen=True, slots=True)
class FamilyCounts:
    children: list[str]  # display names, in name order
    games_played: int
    therapists: int


@dataclass(frozen=True, slots=True)
class TherapistCounts:
    linked_children: int
    notes: int
    learning_plans: int


@dataclass(frozen=True, slots=True)
class LinkedParent:
    """A parent to tell that their child's therapist has gone (read before the links go)."""

    email: str
    first_name: str
    children: int


def family_counts(db: Session, parent_id: uuid.UUID) -> FamilyCounts:
    names = list(
        db.scalars(
            select(Child.display_name)
            .where(Child.parent_id == parent_id)
            .order_by(Child.display_name)
        )
    )
    in_family = Child.parent_id == parent_id
    games = db.scalar(
        select(func.count())
        .select_from(GameSession)
        .join(Child, Child.id == GameSession.child_id)
        .where(in_family, GameSession.status == SessionStatus.COMPLETED)
    )
    therapists = db.scalar(
        select(func.count(func.distinct(TherapistChildLink.therapist_id)))
        .join(Child, Child.id == TherapistChildLink.child_id)
        .where(in_family, LIVE_LINK)
    )
    return FamilyCounts(names, games or 0, therapists or 0)


def therapist_counts(db: Session, therapist_id: uuid.UUID) -> TherapistCounts:
    linked = db.scalar(
        select(func.count(func.distinct(TherapistChildLink.child_id))).where(
            TherapistChildLink.therapist_id == therapist_id, LIVE_LINK
        )
    )
    notes = db.scalar(
        select(func.count())
        .select_from(TherapistNote)
        .where(TherapistNote.therapist_id == therapist_id)
    )
    plans = db.scalar(
        select(func.count())
        .select_from(LearningPlan)
        .where(LearningPlan.created_by_id == therapist_id)
    )
    return TherapistCounts(linked or 0, notes or 0, plans or 0)


def linked_parents(db: Session, therapist_id: uuid.UUID) -> list[LinkedParent]:
    rows = db.execute(
        select(User.email, User.first_name, func.count(func.distinct(Child.id)))
        .select_from(TherapistChildLink)
        .join(Child, Child.id == TherapistChildLink.child_id)
        .join(User, User.id == Child.parent_id)
        .where(TherapistChildLink.therapist_id == therapist_id, LIVE_LINK)
        .group_by(User.id, User.email, User.first_name)
        .order_by(User.email)
    )
    return [LinkedParent(email, first_name, children) for email, first_name, children in rows]


def delete_family(db: Session, parent: User) -> int:
    """The parent's account and all of every child's data. Returns how many children went."""
    child_ids = list(db.scalars(select(Child.id).where(Child.parent_id == parent.id)))
    _forget_in_audit_log(db, user_ids=[parent.id], child_ids=child_ids)
    db.execute(delete(User).where(User.id == parent.id))  # children and their data cascade
    record_event(
        db,
        "account_deleted",
        resource_type="user",
        details={"role": "parent", "children": len(child_ids)},
    )
    return len(child_ids)


def delete_child(db: Session, child: Child, *, parent_id: uuid.UUID, ip: str | None) -> None:
    """One child and all of their data. The event names the parent only, never the child."""
    _forget_in_audit_log(db, user_ids=[], child_ids=[child.id])
    db.execute(delete(Child).where(Child.id == child.id))
    record_event(db, "child_deleted", resource_type="child", actor_user_id=parent_id, ip_address=ip)


def delete_therapist(db: Session, therapist: User) -> TherapistCounts:
    """The therapist's account. Links and invitations end (cascade); notes and plans stay."""
    therapist_id = therapist.id
    counts = therapist_counts(db, therapist_id)
    # Their own account events go. Their reads and writes of a child's data stay, as the family's
    # record of who saw their child's data, but with no actor and no IP.
    db.execute(
        delete(AuditLog).where(AuditLog.actor_user_id == therapist_id, AuditLog.child_id.is_(None))
    )
    db.execute(
        update(AuditLog)
        .where(AuditLog.actor_user_id == therapist_id)
        .values(actor_user_id=None, ip_address=None)
    )
    # Other people's events about them (an admin's approval, a parent removing them) keep no id.
    db.execute(
        update(AuditLog).where(AuditLog.resource_id == str(therapist_id)).values(resource_id=None)
    )
    db.execute(
        update(AuditLog)
        .where(AuditLog.details["therapist_id"].astext == str(therapist_id))
        .values(details=AuditLog.details.op("-", return_type=JSONB)(literal("therapist_id")))
    )
    db.execute(delete(User).where(User.id == therapist_id))
    record_event(
        db,
        "account_deleted",
        resource_type="user",
        details={
            "role": "therapist",
            "links_ended": counts.linked_children,
            "notes_kept": counts.notes,
            "learning_plans_kept": counts.learning_plans,
        },
    )
    return counts


def _forget_in_audit_log(
    db: Session, *, user_ids: Collection[uuid.UUID], child_ids: Collection[uuid.UUID]
) -> None:
    """Delete every audit row by or about these people, whoever the actor was.

    Child-scoped events carry `child_id`; account events name the account as actor or resource.
    """
    names = [str(i) for i in [*user_ids, *child_ids]]
    db.execute(
        delete(AuditLog).where(
            or_(
                AuditLog.actor_user_id.in_(user_ids) if user_ids else false(),
                AuditLog.actor_child_id.in_(child_ids) if child_ids else false(),
                AuditLog.child_id.in_(child_ids) if child_ids else false(),
                AuditLog.resource_id.in_(names),
            )
        )
    )

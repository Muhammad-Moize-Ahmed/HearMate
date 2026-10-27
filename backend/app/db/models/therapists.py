import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, SmallInteger, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base, TimestampMixin, UUIDPrimaryKeyMixin, str_enum, timestamptz
from .enums import Difficulty, TherapistApprovalStatus, TherapistLinkStatus


class TherapistProfile(TimestampMixin, Base):
    """Professional details for a user with role=therapist. An admin must approve it."""

    __tablename__ = "therapist_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    license_number: Mapped[str | None] = mapped_column(String(100))
    organization: Mapped[str | None] = mapped_column(String(200))
    specialization: Mapped[str | None] = mapped_column(String(200))
    approval_status: Mapped[TherapistApprovalStatus] = mapped_column(
        str_enum(TherapistApprovalStatus, "therapist_approval_status"),
        default=TherapistApprovalStatus.PENDING,
    )
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(timestamptz())
    rejection_reason: Mapped[str | None] = mapped_column(Text)


class TherapistChildLink(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Access grant: a parent invites a therapist to one child; either side can revoke it."""

    __tablename__ = "therapist_child_links"
    __table_args__ = (
        # At most one live (pending or active) link per therapist/child pair.
        Index(
            "uq_therapist_child_links_live",
            "therapist_id",
            "child_id",
            unique=True,
            postgresql_where=text("status <> 'revoked'"),
        ),
    )

    therapist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    child_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("children.id", ondelete="CASCADE"), index=True
    )
    granted_by_parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    status: Mapped[TherapistLinkStatus] = mapped_column(
        str_enum(TherapistLinkStatus, "therapist_link_status"),
        default=TherapistLinkStatus.PENDING,
    )
    accepted_at: Mapped[datetime | None] = mapped_column(timestamptz())
    revoked_at: Mapped[datetime | None] = mapped_column(timestamptz())


class TherapistNote(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "therapist_notes"
    __table_args__ = (Index("ix_therapist_notes_child_created", "child_id", "created_at"),)

    # The author. Null once their account is deleted: the note stays with the child's record and
    # is shown as written by a former therapist.
    therapist_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    child_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)


class LearningPlan(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A therapist's practice plan for a child (UC-7). One active plan per child."""

    __tablename__ = "learning_plans"
    __table_args__ = (
        Index(
            "uq_learning_plans_one_active",
            "child_id",
            unique=True,
            postgresql_where=text("is_active"),
        ),
    )

    child_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("children.id", ondelete="CASCADE"), index=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(default=True)


class LearningPlanItem(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "learning_plan_items"
    __table_args__ = (
        CheckConstraint("sessions_per_week BETWEEN 1 AND 21", name="sessions_per_week_range"),
    )

    plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("learning_plans.id", ondelete="CASCADE"), index=True
    )
    game_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("games.id", ondelete="CASCADE"))
    sessions_per_week: Mapped[int] = mapped_column(SmallInteger)
    difficulty: Mapped[Difficulty | None] = mapped_column(str_enum(Difficulty, "difficulty"))
    notes: Mapped[str | None] = mapped_column(Text)

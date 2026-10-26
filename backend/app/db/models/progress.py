import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base, TimestampMixin, UUIDPrimaryKeyMixin, str_enum, timestamptz
from .enums import GoalStatus, SkillCategory


class SkillLevel(UUIDPrimaryKeyMixin, Base):
    """The adaptive engine's current level for a child in one skill category."""

    __tablename__ = "skill_levels"
    __table_args__ = (
        UniqueConstraint("child_id", "category"),
        CheckConstraint("level >= 1", name="level_positive"),
    )

    child_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"))
    category: Mapped[SkillCategory] = mapped_column(str_enum(SkillCategory, "skill_category"))
    level: Mapped[int] = mapped_column(SmallInteger, default=1)
    updated_at: Mapped[datetime] = mapped_column(
        timestamptz(), server_default=func.now(), onupdate=func.now()
    )


class LevelHistory(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "level_history"
    __table_args__ = (
        Index("ix_level_history_child_created", "child_id", "created_at"),
        CheckConstraint("old_level >= 1 AND new_level >= 1", name="levels_positive"),
    )

    child_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"))
    category: Mapped[SkillCategory] = mapped_column(str_enum(SkillCategory, "skill_category"))
    old_level: Mapped[int] = mapped_column(SmallInteger)
    new_level: Mapped[int] = mapped_column(SmallInteger)
    reason: Mapped[str] = mapped_column(Text)
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("game_sessions.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(timestamptz(), server_default=func.now())


class Goal(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A parent-set target for a child (UC-5), e.g. "5 listening sessions this week"."""

    __tablename__ = "goals"
    __table_args__ = (
        CheckConstraint("target_value > 0", name="target_positive"),
        CheckConstraint("current_value >= 0", name="current_non_negative"),
    )

    child_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("children.id", ondelete="CASCADE"), index=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[SkillCategory | None] = mapped_column(
        str_enum(SkillCategory, "skill_category")
    )
    target_value: Mapped[int] = mapped_column(Integer)
    current_value: Mapped[int] = mapped_column(Integer, default=0)
    due_date: Mapped[date | None]
    status: Mapped[GoalStatus] = mapped_column(
        str_enum(GoalStatus, "goal_status"), default=GoalStatus.ACTIVE
    )
    notes: Mapped[str | None] = mapped_column(Text)

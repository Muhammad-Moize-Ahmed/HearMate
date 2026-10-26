import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base, UUIDPrimaryKeyMixin, timestamptz


class Achievement(UUIDPrimaryKeyMixin, Base):
    """An unlocked badge. Names, icons and rules live in code, keyed by `code`."""

    __tablename__ = "achievements"
    __table_args__ = (UniqueConstraint("child_id", "code"),)

    child_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"))
    code: Mapped[str] = mapped_column(String(64))
    unlocked_at: Mapped[datetime] = mapped_column(timestamptz(), server_default=func.now())


class DailyActivity(UUIDPrimaryKeyMixin, Base):
    """Per-day totals; streaks are derived from consecutive dates."""

    __tablename__ = "daily_activity"
    __table_args__ = (
        UniqueConstraint("child_id", "activity_date"),
        CheckConstraint(
            "sessions_completed >= 0 AND points_earned >= 0 AND seconds_practised >= 0",
            name="totals_non_negative",
        ),
    )

    child_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"))
    # The child's local calendar date, decided by the service from the client's timezone.
    activity_date: Mapped[date]
    sessions_completed: Mapped[int] = mapped_column(Integer, default=0)
    points_earned: Mapped[int] = mapped_column(Integer, default=0)
    seconds_practised: Mapped[int] = mapped_column(Integer, default=0)

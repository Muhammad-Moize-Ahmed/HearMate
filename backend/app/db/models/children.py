import uuid
from datetime import date

from sqlalchemy import CheckConstraint, ForeignKey, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base, TimestampMixin, UUIDPrimaryKeyMixin, str_enum
from .enums import Gender
from .users import LoginLockoutMixin


class Child(UUIDPrimaryKeyMixin, LoginLockoutMixin, TimestampMixin, Base):
    __tablename__ = "children"
    __table_args__ = (
        # A child can log in only if the parent set both a username and a PIN.
        CheckConstraint("(username IS NULL) = (pin_hash IS NULL)", name="login_complete"),
        CheckConstraint("username = lower(username)", name="username_lowercase"),
        CheckConstraint(
            "session_length_minutes IS NULL OR session_length_minutes BETWEEN 1 AND 120",
            name="session_length_range",
        ),
    )

    parent_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    display_name: Mapped[str] = mapped_column(String(100))
    date_of_birth: Mapped[date]
    gender: Mapped[Gender | None] = mapped_column(str_enum(Gender, "gender"))
    avatar: Mapped[str] = mapped_column(String(32), default="bear")

    username: Mapped[str | None] = mapped_column(String(50), unique=True)
    pin_hash: Mapped[str | None] = mapped_column(String(255))

    # Assessment profile from the parent's form; free-form tags validated by the API layer.
    hearing_difficulties: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list, server_default="{}"
    )
    speech_challenges: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list, server_default="{}"
    )
    interests: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list, server_default="{}")
    focus_areas: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list, server_default="{}")
    learning_environment: Mapped[str | None] = mapped_column(String(50))
    attention_span: Mapped[str | None] = mapped_column(String(50))
    preferred_learning_style: Mapped[str | None] = mapped_column(String(50))
    session_length_minutes: Mapped[int | None] = mapped_column(SmallInteger)
    notes: Mapped[str | None] = mapped_column(Text)
    # IANA name (e.g. "Asia/Karachi"); None means the server's DEFAULT_TIMEZONE.
    timezone: Mapped[str | None] = mapped_column(String(64))

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, SmallInteger, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base, TimestampMixin, UUIDPrimaryKeyMixin, str_enum, timestamptz
from .enums import CodePurpose, UserRole, UserStatus


class LoginLockoutMixin:
    """Consecutive failed logins; the account is locked until `locked_until` after too many."""

    failed_login_count: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(timestamptz())


class User(UUIDPrimaryKeyMixin, LoginLockoutMixin, TimestampMixin, Base):
    """An adult account: parent, therapist or admin. Children are separate principals."""

    __tablename__ = "users"
    __table_args__ = (
        # Emails are stored lower-cased by the service layer; this enforces it.
        CheckConstraint("email = lower(email)", name="email_lowercase"),
    )

    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(str_enum(UserRole, "user_role"))
    status: Mapped[UserStatus] = mapped_column(
        str_enum(UserStatus, "user_status"), default=UserStatus.ACTIVE
    )
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    email_verified_at: Mapped[datetime | None] = mapped_column(timestamptz())
    last_login_at: Mapped[datetime | None] = mapped_column(timestamptz())


class RefreshToken(UUIDPrimaryKeyMixin, Base):
    """A hashed refresh token. Rotation keeps one family per login; reuse revokes the family."""

    __tablename__ = "refresh_tokens"
    __table_args__ = (
        CheckConstraint("(user_id IS NULL) <> (child_id IS NULL)", name="exactly_one_principal"),
        Index("ix_refresh_tokens_family_id", "family_id"),
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    child_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("children.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    family_id: Mapped[uuid.UUID]
    expires_at: Mapped[datetime] = mapped_column(timestamptz())
    revoked_at: Mapped[datetime | None] = mapped_column(timestamptz())
    created_at: Mapped[datetime] = mapped_column(timestamptz(), server_default=func.now())


class OneTimeCode(UUIDPrimaryKeyMixin, Base):
    """A short emailed code (verify email, reset password). Only an HMAC of the code is stored.

    Issuing a new code consumes older unused ones for the same user and purpose.
    """

    __tablename__ = "one_time_codes"
    __table_args__ = (
        Index("ix_one_time_codes_user_purpose", "user_id", "purpose", "created_at"),
        CheckConstraint("attempts >= 0", name="attempts_non_negative"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    purpose: Mapped[CodePurpose] = mapped_column(str_enum(CodePurpose, "code_purpose"))
    code_hash: Mapped[str] = mapped_column(String(128))
    attempts: Mapped[int] = mapped_column(SmallInteger, default=0)
    expires_at: Mapped[datetime] = mapped_column(timestamptz())
    consumed_at: Mapped[datetime | None] = mapped_column(timestamptz())
    created_at: Mapped[datetime] = mapped_column(timestamptz(), server_default=func.now())

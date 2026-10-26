import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base, UUIDPrimaryKeyMixin, str_enum, timestamptz
from .enums import ActorType


class AuditLog(UUIDPrimaryKeyMixin, Base):
    """Append-only record of who did what, especially who viewed or changed a child's data.

    Foreign keys use SET NULL so the trail survives account deletion.
    """

    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_child_occurred", "child_id", "occurred_at"),
        Index("ix_audit_log_actor_user_occurred", "actor_user_id", "occurred_at"),
    )

    occurred_at: Mapped[datetime] = mapped_column(timestamptz(), server_default=func.now())
    actor_type: Mapped[ActorType] = mapped_column(str_enum(ActorType, "actor_type"))
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    actor_child_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("children.id", ondelete="SET NULL")
    )
    # The child whose data was touched, if any.
    child_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("children.id", ondelete="SET NULL")
    )
    action: Mapped[str] = mapped_column(String(64))
    resource_type: Mapped[str] = mapped_column(String(64))
    resource_id: Mapped[str | None] = mapped_column(String(64))
    ip_address: Mapped[str | None] = mapped_column(INET)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")

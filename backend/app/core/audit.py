"""Append security-relevant events to the audit_log table (in the caller's transaction)."""

import uuid
from typing import Any

from sqlalchemy.orm import Session

from ..db.models import ActorType, AuditLog


def record_event(
    db: Session,
    action: str,
    *,
    resource_type: str,
    resource_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
    actor_child_id: uuid.UUID | None = None,
    child_id: uuid.UUID | None = None,
    ip_address: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    if actor_user_id is not None:
        actor_type = ActorType.USER
    elif actor_child_id is not None:
        actor_type = ActorType.CHILD
    else:
        actor_type = ActorType.SYSTEM
    db.add(
        AuditLog(
            action=action,
            actor_type=actor_type,
            actor_user_id=actor_user_id,
            actor_child_id=actor_child_id,
            child_id=child_id,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id else None,
            ip_address=ip_address,
            details=details or {},
        )
    )

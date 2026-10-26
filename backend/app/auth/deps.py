from collections.abc import Callable
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.deps import AppSettings
from ..core.errors import AuthenticationError, PermissionDeniedError
from ..db.models import Child, TherapistApprovalStatus, TherapistProfile, User, UserStatus
from ..db.session import get_db
from .principal import Principal, PrincipalKind, kind_for_role
from .tokens import decode_access_token

_bearer = HTTPBearer(auto_error=False, description="Access token from /auth/login")

DbSession = Annotated[Session, Depends(get_db)]


def principal_for_user(db: Session, user: User) -> Principal:
    kind = kind_for_role(user.role)
    approved = False
    if kind is PrincipalKind.THERAPIST:
        status = db.scalar(
            select(TherapistProfile.approval_status).where(TherapistProfile.user_id == user.id)
        )
        approved = status is TherapistApprovalStatus.APPROVED
    return Principal(kind=kind, id=user.id, therapist_approved=approved)


def get_principal(
    db: DbSession,
    settings: AppSettings,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> Principal:
    """The one place a request's identity is decided. Re-checks the account on every request."""
    if credentials is None:
        raise AuthenticationError()
    kind, principal_id = decode_access_token(
        credentials.credentials, secret_key=settings.secret_key()
    )

    if kind is PrincipalKind.CHILD:
        child = db.get(Child, principal_id)
        if child is None or not _account_active(db.get(User, child.parent_id)):
            raise AuthenticationError("Account no longer available", code="invalid_token")
        return Principal(kind=kind, id=child.id)

    user = db.get(User, principal_id)
    if user is None or not _account_active(user) or kind_for_role(user.role) is not kind:
        raise AuthenticationError("Account no longer available", code="invalid_token")
    return principal_for_user(db, user)


def _account_active(user: User | None) -> bool:
    return user is not None and user.status is UserStatus.ACTIVE


CurrentPrincipal = Annotated[Principal, Depends(get_principal)]


def require_kinds(*kinds: PrincipalKind) -> Callable[[Principal], Principal]:
    allowed = frozenset(kinds)

    def dependency(principal: CurrentPrincipal) -> Principal:
        if principal.kind not in allowed:
            raise PermissionDeniedError("You don't have access to this resource")
        return principal

    return dependency


def require_approved_therapist(principal: CurrentPrincipal) -> Principal:
    if principal.kind is not PrincipalKind.THERAPIST:
        raise PermissionDeniedError("Therapist account required")
    if not principal.therapist_approved:
        raise PermissionDeniedError(
            "Your therapist account is awaiting admin approval", code="therapist_not_approved"
        )
    return principal


AdminPrincipal = Annotated[Principal, Depends(require_kinds(PrincipalKind.ADMIN))]
ParentPrincipal = Annotated[Principal, Depends(require_kinds(PrincipalKind.PARENT))]
TherapistPrincipal = Annotated[Principal, Depends(require_kinds(PrincipalKind.THERAPIST))]
ApprovedTherapist = Annotated[Principal, Depends(require_approved_therapist)]

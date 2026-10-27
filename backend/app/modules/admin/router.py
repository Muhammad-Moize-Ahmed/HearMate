import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Query

from ...auth.deps import AdminPrincipal, DbSession
from ...core.deps import ClientIp, Limiter, Mailer
from ...db.models import TherapistApprovalStatus, UserRole, UserStatus
from ...providers.email import send_safely
from .schemas import AdminStatsOut, AdminUserPageOut, RejectTherapistIn, TherapistOut
from .service import AdminService


def limit_admin_requests(admin: AdminPrincipal, limiter: Limiter) -> None:
    """One budget per admin account across every admin route (non-admins get 401/403 first)."""
    limiter.hit(f"admin:{admin.id}", limit=120, window_seconds=60)


router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(limit_admin_requests)])


def get_admin_service(db: DbSession, admin: AdminPrincipal, ip: ClientIp) -> AdminService:
    return AdminService(db, admin_id=admin.id, client_ip=ip)


Service = Annotated[AdminService, Depends(get_admin_service)]


@router.get("/therapists")
def list_therapists(
    service: Service,
    status: Annotated[TherapistApprovalStatus | None, Query()] = None,
) -> list[TherapistOut]:
    """Therapist accounts, oldest first. Filter with e.g. `?status=pending`."""
    return service.list_therapists(status)


@router.get("/users")
def list_users(
    service: Service,
    q: Annotated[
        str | None,
        Query(min_length=1, max_length=100, description="Part of an email or name"),
    ] = None,
    role: Annotated[UserRole | None, Query()] = None,
    status: Annotated[UserStatus | None, Query(description="Account status")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> AdminUserPageOut:
    """Adult accounts (parents, therapists, admins), newest first. Read-only.

    Children are never listed; a parent's row only says how many children they have.
    """
    return service.list_users(
        search=q.strip() if q else None, role=role, status=status, limit=limit, offset=offset
    )


@router.get("/stats")
def stats(service: Service) -> AdminStatsOut:
    """Account, child and session counts for the dashboard. Counts only."""
    return service.stats()


@router.post("/therapists/{therapist_id}/approve")
def approve_therapist(
    therapist_id: uuid.UUID, service: Service, mailer: Mailer, background: BackgroundTasks
) -> TherapistOut:
    result = service.decide(therapist_id, approve=True)
    for message in service.outbox:
        background.add_task(send_safely, mailer, message)
    return result


@router.post("/therapists/{therapist_id}/reject")
def reject_therapist(
    therapist_id: uuid.UUID,
    body: RejectTherapistIn,
    service: Service,
    mailer: Mailer,
    background: BackgroundTasks,
) -> TherapistOut:
    result = service.decide(therapist_id, approve=False, reason=body.reason)
    for message in service.outbox:
        background.add_task(send_safely, mailer, message)
    return result

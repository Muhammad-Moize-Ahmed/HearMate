import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Query

from ...auth.deps import AdminPrincipal, DbSession
from ...core.deps import ClientIp, Mailer
from ...db.models import TherapistApprovalStatus
from ...providers.email import send_safely
from .schemas import RejectTherapistIn, TherapistOut
from .service import AdminService

router = APIRouter(prefix="/admin", tags=["admin"])


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

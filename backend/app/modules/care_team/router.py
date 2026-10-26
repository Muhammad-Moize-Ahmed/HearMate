import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Query, status

from ...auth.deps import DbSession, ParentPrincipal, TherapistPrincipal
from ...core.deps import ClientIp, Mailer
from ...db.models import TherapistLinkStatus
from ...providers.email import send_safely
from .schemas import InviteTherapistIn, ParentLinkOut, TherapistLinkOut
from .service import CareTeamService

parent_router = APIRouter(prefix="/children/{child_id}/therapists", tags=["care team"])
therapist_router = APIRouter(prefix="/therapist/links", tags=["care team"])


def get_parent_service(db: DbSession, principal: ParentPrincipal, ip: ClientIp) -> CareTeamService:
    return CareTeamService(db, principal, client_ip=ip)


def get_therapist_service(
    db: DbSession, principal: TherapistPrincipal, ip: ClientIp
) -> CareTeamService:
    return CareTeamService(db, principal, client_ip=ip)


ParentService = Annotated[CareTeamService, Depends(get_parent_service)]
TherapistService = Annotated[CareTeamService, Depends(get_therapist_service)]


def _send_outbox(service: CareTeamService, mailer: Mailer, background: BackgroundTasks) -> None:
    for message in service.outbox:
        background.add_task(send_safely, mailer, message)


@parent_router.get("")
def list_child_therapists(child_id: uuid.UUID, service: ParentService) -> list[ParentLinkOut]:
    """Therapists invited to or following this child."""
    return service.list_for_child(child_id)


@parent_router.post("", status_code=status.HTTP_201_CREATED)
def invite_therapist(
    child_id: uuid.UUID,
    body: InviteTherapistIn,
    service: ParentService,
    mailer: Mailer,
    background: BackgroundTasks,
) -> ParentLinkOut:
    """Invite a registered therapist (by email) to follow this child."""
    link = service.invite(child_id, body.email)
    _send_outbox(service, mailer, background)
    return link


@parent_router.delete("/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_therapist(child_id: uuid.UUID, link_id: uuid.UUID, service: ParentService) -> None:
    """Cancel an invitation or remove a therapist's access."""
    service.revoke_for_child(child_id, link_id)


@therapist_router.get("")
def list_my_links(
    service: TherapistService,
    status: Annotated[TherapistLinkStatus | None, Query()] = None,
) -> list[TherapistLinkOut]:
    """Invitations and children you follow. Defaults to pending and active ones."""
    return service.list_mine(status)


@therapist_router.post("/{link_id}/accept")
def accept_invitation(
    link_id: uuid.UUID, service: TherapistService, mailer: Mailer, background: BackgroundTasks
) -> TherapistLinkOut:
    """Accept an invitation. Needs an admin-approved therapist account."""
    link = service.accept(link_id)
    _send_outbox(service, mailer, background)
    return link


@therapist_router.delete("/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def leave_link(link_id: uuid.UUID, service: TherapistService) -> None:
    """Decline an invitation or stop following a child."""
    service.leave(link_id)

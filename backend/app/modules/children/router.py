import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status

from ...auth.deps import CurrentPrincipal, DbSession, ParentPrincipal
from ...auth.principal import Principal
from ...core.deps import ClientIp
from .schemas import ChildCreateIn, ChildLoginIn, ChildOut, ChildUpdateIn
from .service import ChildrenService, to_child_out

router = APIRouter(prefix="/children", tags=["children"])


def _service(db: DbSession, principal: Principal, ip: str | None) -> ChildrenService:
    return ChildrenService(db, principal, client_ip=ip)


def get_children_service(
    db: DbSession, principal: CurrentPrincipal, ip: ClientIp
) -> ChildrenService:
    return _service(db, principal, ip)


def get_parent_children_service(
    db: DbSession, principal: ParentPrincipal, ip: ClientIp
) -> ChildrenService:
    return _service(db, principal, ip)


Service = Annotated[ChildrenService, Depends(get_children_service)]
ParentService = Annotated[ChildrenService, Depends(get_parent_children_service)]


@router.get("")
def list_children(service: Service) -> list[ChildOut]:
    """Parents: their children. Therapists: children they're actively linked to. Child: self."""
    return [to_child_out(child, service.principal) for child in service.list()]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_child(body: ChildCreateIn, service: ParentService) -> ChildOut:
    return to_child_out(service.create(body), service.principal)


@router.get("/{child_id}")
def get_child(child_id: uuid.UUID, service: Service) -> ChildOut:
    return to_child_out(service.get(child_id), service.principal)


@router.patch("/{child_id}")
def update_child(child_id: uuid.UUID, body: ChildUpdateIn, service: ParentService) -> ChildOut:
    return to_child_out(service.update(child_id, body), service.principal)


@router.delete("/{child_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_child(child_id: uuid.UUID, service: ParentService) -> None:
    """Permanently deletes the child and all of their data."""
    service.delete(child_id)


@router.put("/{child_id}/login")
def set_child_login(child_id: uuid.UUID, body: ChildLoginIn, service: ParentService) -> ChildOut:
    """Set or change the child's username and PIN. Signs the child out of every device."""
    return to_child_out(service.set_login(child_id, body), service.principal)


@router.delete("/{child_id}/login")
def remove_child_login(child_id: uuid.UUID, service: ParentService) -> ChildOut:
    """Turn off the child's own sign-in and sign them out of every device."""
    return to_child_out(service.remove_login(child_id), service.principal)

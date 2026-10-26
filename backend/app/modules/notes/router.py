import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from ...auth.deps import CurrentPrincipal, DbSession
from ...core.deps import ClientIp
from .schemas import NoteIn, NoteOut
from .service import NotesService

router = APIRouter(prefix="/children/{child_id}/notes", tags=["therapist notes"])


def get_service(db: DbSession, principal: CurrentPrincipal, ip: ClientIp) -> NotesService:
    return NotesService(db, principal, client_ip=ip)


Service = Annotated[NotesService, Depends(get_service)]


@router.get("")
def list_notes(
    child_id: uuid.UUID,
    service: Service,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    before: Annotated[
        datetime | None, Query(description="Only notes written before this time (paging)")
    ] = None,
) -> list[NoteOut]:
    """Therapist notes, newest first. For the parent and linked therapists."""
    return service.list(child_id, limit=limit, before=before)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_note(child_id: uuid.UUID, body: NoteIn, service: Service) -> NoteOut:
    """Write a note. Needs an approved therapist with an active link to the child."""
    return service.create(child_id, body)


@router.patch("/{note_id}")
def update_note(child_id: uuid.UUID, note_id: uuid.UUID, body: NoteIn, service: Service) -> NoteOut:
    """Change your own note."""
    return service.update(child_id, note_id, body)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(child_id: uuid.UUID, note_id: uuid.UUID, service: Service) -> None:
    """Delete your own note."""
    service.delete(child_id, note_id)

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...auth.policies import get_plan_managed_child, get_plan_readable_child
from ...auth.principal import Principal, PrincipalKind
from ...core.audit import record_event
from ...core.errors import NotFoundError, PermissionDeniedError
from ...db.models import Child, TherapistNote, User
from .schemas import AuthorOut, NoteIn, NoteOut


class NotesService:
    """Therapist notes on a child: linked therapists write them, the parent reads them.

    A note can be changed or deleted only by its author, and only while still linked.
    """

    def __init__(self, db: Session, principal: Principal, *, client_ip: str | None) -> None:
        self.db = db
        self.principal = principal
        self.client_ip = client_ip

    def list(self, child_id: uuid.UUID, *, limit: int, before: datetime | None) -> list[NoteOut]:
        """Newest first. Pass the oldest `created_at` you have as `before` for the next page."""
        child = get_plan_readable_child(self.db, self.principal, child_id)
        query = (
            select(TherapistNote, User)
            .join(User, User.id == TherapistNote.therapist_id)
            .where(TherapistNote.child_id == child.id)
        )
        if before is not None:
            query = query.where(TherapistNote.created_at < before)
        rows = self.db.execute(
            query.order_by(TherapistNote.created_at.desc(), TherapistNote.id).limit(limit)
        )
        notes = [to_note_out(note, author) for note, author in rows]
        if self.principal.kind is PrincipalKind.THERAPIST:
            self._audit(child, "therapist_notes_viewed")
            self.db.commit()
        return notes

    def create(self, child_id: uuid.UUID, data: NoteIn) -> NoteOut:
        child = get_plan_managed_child(self.db, self.principal, child_id)
        note = TherapistNote(
            therapist_id=self.principal.id,
            child_id=child.id,
            body=data.body,
            # App clock: now() is fixed per transaction, so notes would tie when sorted.
            created_at=datetime.now(UTC),
        )
        self.db.add(note)
        self.db.flush()
        self._audit(child, "therapist_note_created", note)
        self.db.commit()
        return self._out(note)

    def update(self, child_id: uuid.UUID, note_id: uuid.UUID, data: NoteIn) -> NoteOut:
        child = get_plan_managed_child(self.db, self.principal, child_id)
        note = self._own_note(child, note_id)
        note.body = data.body
        self._audit(child, "therapist_note_updated", note)
        self.db.commit()
        self.db.refresh(note)
        return self._out(note)

    def delete(self, child_id: uuid.UUID, note_id: uuid.UUID) -> None:
        child = get_plan_managed_child(self.db, self.principal, child_id)
        note = self._own_note(child, note_id)
        self._audit(child, "therapist_note_deleted", note)
        self.db.delete(note)
        self.db.commit()

    def _own_note(self, child: Child, note_id: uuid.UUID) -> TherapistNote:
        note = self.db.get(TherapistNote, note_id)
        if note is None or note.child_id != child.id:
            raise NotFoundError("Note not found")
        if note.therapist_id != self.principal.id:
            raise PermissionDeniedError(
                "Only the therapist who wrote this note can change it", code="not_note_author"
            )
        return note

    def _out(self, note: TherapistNote) -> NoteOut:
        author = self.db.get(User, note.therapist_id)
        assert author is not None  # noqa: S101 - the foreign key cascades on delete
        return to_note_out(note, author)

    def _audit(self, child: Child, action: str, note: TherapistNote | None = None) -> None:
        record_event(
            self.db,
            action,
            resource_type="therapist_note",
            resource_id=note.id if note else None,
            actor_user_id=self.principal.id,
            child_id=child.id,
            ip_address=self.client_ip,
        )


def to_note_out(note: TherapistNote, author: User) -> NoteOut:
    return NoteOut(
        id=note.id,
        child_id=note.child_id,
        author=AuthorOut(id=author.id, first_name=author.first_name, last_name=author.last_name),
        body=note.body,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )

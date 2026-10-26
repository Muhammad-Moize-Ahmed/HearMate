import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, StringConstraints

from ...core.schemas import InputModel

Body = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]


class NoteIn(InputModel):
    body: Body


class AuthorOut(BaseModel):
    """The therapist who wrote a note or plan."""

    id: uuid.UUID
    first_name: str
    last_name: str


class NoteOut(BaseModel):
    id: uuid.UUID
    child_id: uuid.UUID
    author: AuthorOut
    body: str
    created_at: datetime
    updated_at: datetime

import uuid
from datetime import date, datetime
from typing import Annotated, Self

from pydantic import AfterValidator, BaseModel, Field, StringConstraints, model_validator

from ...core.schemas import InputModel
from ...db.models import GoalStatus, SkillCategory

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Notes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]
Target = Annotated[int, Field(ge=1, le=1000)]


def _not_in_past(value: date) -> date:
    if value < date.today():
        raise ValueError("due date cannot be in the past")
    return value


DueDate = Annotated[date, AfterValidator(_not_in_past)]


class GoalCreateIn(InputModel):
    title: Title
    category: SkillCategory | None = None
    target_value: Target
    due_date: DueDate | None = None
    notes: Notes | None = None


class GoalUpdateIn(InputModel):
    """Partial update. Progress (`current_value`) is computed from play, not set by hand."""

    title: Title | None = None
    category: SkillCategory | None = None
    target_value: Target | None = None
    due_date: DueDate | None = None
    status: GoalStatus | None = None
    notes: Notes | None = None

    @model_validator(mode="after")
    def _required_fields_cannot_be_cleared(self) -> Self:
        cleared = sorted(
            f
            for f in {"title", "target_value", "status"} & self.model_fields_set
            if getattr(self, f) is None
        )
        if cleared:
            raise ValueError(f"these fields cannot be null: {', '.join(cleared)}")
        return self


class GoalOut(BaseModel):
    id: uuid.UUID
    child_id: uuid.UUID
    title: str
    category: SkillCategory | None
    target_value: int
    current_value: int
    due_date: date | None
    status: GoalStatus
    notes: str | None
    created_at: datetime
    updated_at: datetime

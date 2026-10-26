import uuid
from datetime import datetime
from typing import Annotated, Self

from pydantic import AfterValidator, BaseModel, Field, StringConstraints, model_validator

from ...core.schemas import InputModel
from ...db.models import Difficulty
from ..games.schemas import SessionGameOut, Slug
from ..notes.schemas import AuthorOut

MAX_ITEMS = 20

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
PlanNotes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)]
ItemNotes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]


class PlanItemIn(InputModel):
    game: Slug
    sessions_per_week: Annotated[int, Field(ge=1, le=21)]
    difficulty: Difficulty | None = Field(
        default=None, description="Suggested tier; levels are still set by the adaptive engine"
    )
    notes: ItemNotes | None = None


def _one_item_per_game(items: list[PlanItemIn]) -> list[PlanItemIn]:
    if len({item.game for item in items}) != len(items):
        raise ValueError("each game can appear only once in a plan")
    return items


Items = Annotated[list[PlanItemIn], Field(max_length=MAX_ITEMS), AfterValidator(_one_item_per_game)]


class PlanCreateIn(InputModel):
    title: Title
    notes: PlanNotes | None = None
    items: Items = Field(default_factory=list)


class PlanUpdateIn(InputModel):
    """Partial update. `items`, when given, replaces the whole list."""

    title: Title | None = None
    notes: PlanNotes | None = None
    items: Items | None = None

    @model_validator(mode="after")
    def _required_fields_cannot_be_cleared(self) -> Self:
        cleared = sorted(
            f for f in {"title", "items"} & self.model_fields_set if getattr(self, f) is None
        )
        if cleared:
            raise ValueError(f"these fields cannot be null: {', '.join(cleared)}")
        return self


class PlanItemOut(BaseModel):
    id: uuid.UUID
    game: SessionGameOut
    sessions_per_week: int
    difficulty: Difficulty | None
    notes: str | None


class LearningPlanOut(BaseModel):
    id: uuid.UUID
    child_id: uuid.UUID
    title: str
    notes: str | None
    is_active: bool = Field(description="Only the active plan can be changed")
    created_by: AuthorOut | None = Field(description="Null if that account was deleted")
    items: list[PlanItemOut]
    created_at: datetime
    updated_at: datetime

from typing import Annotated, Literal

from pydantic import BaseModel, Field

from ...core.schemas import InputModel
from ..auth.schemas import Password


class ConfirmPasswordIn(InputModel):
    """The signed-in user's password, asked again before a permanent deletion."""

    password: Password


class ParentDeletionSummaryOut(BaseModel):
    """What deleting a parent's account removes, for the warning screen."""

    role: Literal["parent"]
    children: list[str] = Field(description="The children's display names, in name order")
    games_played: int = Field(description="Completed games across the family")
    therapists: int = Field(description="Therapists with access to, or invited to, a child")


class TherapistDeletionSummaryOut(BaseModel):
    """What deleting a therapist's account ends, and what stays with the children."""

    role: Literal["therapist"]
    linked_children: int = Field(description="Children whose care team they are in or invited to")
    notes: int = Field(description="Notes they wrote; these stay, by a former therapist")
    learning_plans: int = Field(description="Plans they started; these stay, by a former therapist")


DeletionSummaryOut = Annotated[
    ParentDeletionSummaryOut | TherapistDeletionSummaryOut, Field(discriminator="role")
]

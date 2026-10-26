import itertools
import uuid
from datetime import date, datetime
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    Field,
    StringConstraints,
    model_validator,
)

from ...core.schemas import InputModel
from ...db.models import Gender
from .options import (
    AttentionSpan,
    Avatar,
    FocusArea,
    HearingDifficulty,
    Interest,
    LearningEnvironment,
    LearningStyle,
    SpeechChallenge,
)

MAX_CHILD_AGE_YEARS = 18


def age_in_years(date_of_birth: date, today: date | None = None) -> int:
    today = today or date.today()
    had_birthday = (today.month, today.day) >= (date_of_birth.month, date_of_birth.day)
    return today.year - date_of_birth.year - (0 if had_birthday else 1)


def _valid_birth_date(value: date) -> date:
    today = date.today()
    if value > today:
        raise ValueError("date of birth cannot be in the future")
    if age_in_years(value, today) >= MAX_CHILD_AGE_YEARS:
        raise ValueError(f"HearMate is for children under {MAX_CHILD_AGE_YEARS}")
    return value


def _unique[T](values: list[T]) -> list[T]:
    return list(dict.fromkeys(values))


def _not_trivial_pin(pin: str) -> str:
    digits = [int(d) for d in pin]
    steps = {b - a for a, b in itertools.pairwise(digits)}
    if len(set(digits)) == 1 or steps in ({1}, {-1}):
        raise ValueError("choose a PIN that is harder to guess (no repeated or sequential digits)")
    return pin


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
BirthDate = Annotated[date, AfterValidator(_valid_birth_date)]
Notes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
SessionLength = Literal[5, 10, 15, 20, 30]
Tags = Annotated[list[HearingDifficulty], AfterValidator(_unique)]
Speech = Annotated[list[SpeechChallenge], AfterValidator(_unique)]
Interests = Annotated[list[Interest], AfterValidator(_unique)]
Focus = Annotated[list[FocusArea], AfterValidator(_unique)]
# Normalise first: StringConstraints checks `pattern` before applying strip/lower.
Username = Annotated[
    str,
    StringConstraints(pattern=r"^[a-z][a-z0-9._-]{2,29}$"),
    BeforeValidator(lambda v: v.strip().lower() if isinstance(v, str) else v),
]
Pin = Annotated[str, StringConstraints(pattern=r"^\d{4,8}$"), AfterValidator(_not_trivial_pin)]


class ChildCreateIn(InputModel):
    display_name: Name
    date_of_birth: BirthDate
    gender: Gender | None = None
    avatar: Avatar = Avatar.BEAR
    hearing_difficulties: Tags = Field(default_factory=list)
    speech_challenges: Speech = Field(default_factory=list)
    interests: Interests = Field(default_factory=list)
    focus_areas: Focus = Field(default_factory=list)
    learning_environment: LearningEnvironment | None = None
    attention_span: AttentionSpan | None = None
    preferred_learning_style: LearningStyle | None = None
    session_length_minutes: SessionLength | None = None
    notes: Notes | None = None


class ChildUpdateIn(InputModel):
    """Partial update: only fields present in the request are changed."""

    display_name: Name | None = None
    date_of_birth: BirthDate | None = None
    gender: Gender | None = None
    avatar: Avatar | None = None
    hearing_difficulties: Tags | None = None
    speech_challenges: Speech | None = None
    interests: Interests | None = None
    focus_areas: Focus | None = None
    learning_environment: LearningEnvironment | None = None
    attention_span: AttentionSpan | None = None
    preferred_learning_style: LearningStyle | None = None
    session_length_minutes: SessionLength | None = None
    notes: Notes | None = None

    @model_validator(mode="after")
    def _required_fields_cannot_be_cleared(self) -> Self:
        required = {
            "display_name",
            "date_of_birth",
            "avatar",
            "hearing_difficulties",
            "speech_challenges",
            "interests",
            "focus_areas",
        }
        cleared = sorted(f for f in required & self.model_fields_set if getattr(self, f) is None)
        if cleared:
            raise ValueError(f"these fields cannot be null: {', '.join(cleared)}")
        return self


class ChildLoginIn(InputModel):
    username: Username
    pin: Pin


class ChildLoginOut(BaseModel):
    username: str


class ChildOut(BaseModel):
    id: uuid.UUID
    display_name: str
    date_of_birth: date
    age_years: int
    gender: Gender | None
    avatar: str
    hearing_difficulties: list[str]
    speech_challenges: list[str]
    interests: list[str]
    focus_areas: list[str]
    learning_environment: str | None
    attention_span: str | None
    preferred_learning_style: str | None
    session_length_minutes: int | None
    notes: str | None = Field(description="Hidden from the child themselves")
    login: ChildLoginOut | None = Field(
        description="Child sign-in details; only shown to the parent"
    )
    created_at: datetime
    updated_at: datetime


class ChildSummaryOut(BaseModel):
    """Minimal child details, e.g. for a therapist deciding on an invitation."""

    id: uuid.UUID
    display_name: str
    age_years: int
    avatar: str

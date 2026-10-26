import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, Field, StringConstraints

from ...core.schemas import InputModel
from ...db.models import Difficulty, SessionStatus, SkillCategory

Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,64}$")]


class GameOut(BaseModel):
    slug: str
    title: str
    description: str
    category: SkillCategory
    icon: str
    rounds_per_session: int
    requires_microphone: bool
    supports_noise: bool = Field(description="Can be played with optional background noise")
    always_noise: bool = Field(description="Background noise is part of every round")


class StartSessionIn(InputModel):
    child_id: uuid.UUID
    game: Slug
    with_noise: bool = False


class AnswerIn(InputModel):
    answer: dict[str, Any] = Field(
        description='Game-specific: {"choice": id}, {"sequence": [ids]} or {"transcript": text}'
    )
    response_time_ms: int | None = Field(default=None, ge=0, le=600_000)


class RoundOut(BaseModel):
    index: int
    prompt: dict[str, Any]
    answered: bool
    is_correct: bool | None
    given_answer: dict[str, Any] | None
    correct_answer: dict[str, Any] | None = Field(
        description="Shown once the round is answered or the session has ended"
    )


class AnswerOut(BaseModel):
    index: int
    is_correct: bool
    score: float = Field(description="0-100 for this round (partial credit where it applies)")
    correct_answer: dict[str, Any]
    feedback: dict[str, Any]
    rounds_remaining: int


class SessionResultOut(BaseModel):
    total_rounds: int
    correct_rounds: int
    accuracy: float
    points: int
    duration_seconds: int | None
    level_before: int
    level_after: int
    level_reason: str | None


class SessionGameOut(BaseModel):
    slug: str
    title: str
    category: SkillCategory


class SessionOut(BaseModel):
    id: uuid.UUID
    child_id: uuid.UUID
    game: SessionGameOut
    status: SessionStatus
    difficulty: Difficulty
    level: int
    with_noise: bool
    started_at: datetime
    completed_at: datetime | None
    rounds: list[RoundOut]
    result: SessionResultOut | None


class SessionSummaryOut(BaseModel):
    id: uuid.UUID
    game: SessionGameOut
    status: SessionStatus
    difficulty: Difficulty
    level_at_start: int
    level_at_end: int | None
    accuracy: float | None
    points: int
    started_at: datetime
    completed_at: datetime | None


class SkillLevelOut(BaseModel):
    category: SkillCategory
    level: int
    difficulty: Difficulty

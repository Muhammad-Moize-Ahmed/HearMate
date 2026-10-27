import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints

from ...core.schemas import InputModel
from ...db.models import Difficulty, SessionStatus, SkillCategory
from ..progress.schemas import AchievementOut
from .definitions.base import ChoiceAnswer, SequenceAnswer, SpeechAnswer
from .noise import NoiseKind

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
    answer: ChoiceAnswer | SequenceAnswer | SpeechAnswer = Field(
        description='Game-specific: {"choice": id}, {"sequence": [ids]} or {"transcript": text}'
    )
    response_time_ms: int | None = Field(default=None, ge=0, le=600_000)


# Round details. They are stored as JSON per game (see definitions/base.py); these models give
# them a published shape, so clients get generated types instead of guessing.


def _if_used(description: str | None = None) -> Any:
    """A game-specific field: left out of the JSON when a game doesn't use it (not sent as null)."""
    return Field(default=None, exclude_if=lambda value: value is None, description=description)


class OptionOut(BaseModel):
    id: str
    label: str


class StimulusOut(BaseModel):
    type: Literal["sound", "speech", "speech_sequence"]
    audio_url: str = Field(description="WAV with any noise mixed in; needs the bearer token")


class NoiseOut(BaseModel):
    kind: NoiseKind
    snr_db: float = Field(description="Signal-to-noise ratio; lower is harder")


class PromptOut(BaseModel):
    instruction: str
    stimulus: StimulusOut
    options: list[OptionOut] = Field(description="Empty for speech games")
    noise: NoiseOut | None = Field(description="For display only: already in the audio")
    display_text: str | None = Field(description="Text to show (speech practice)")
    answer_length: int | None = _if_used("Word sequence: how many words to tap")


class GivenAnswerOut(BaseModel):
    choice: str | None = _if_used()
    sequence: list[str] | None = _if_used()
    transcript: str | None = _if_used()


class CorrectAnswerOut(BaseModel):
    choice: str | None = _if_used()
    sequence: list[str] | None = _if_used()
    text: str | None = _if_used("Speech practice: what to say")
    contrast: str | None = _if_used("Similar sounds: the sound contrast")


class WordFeedbackOut(BaseModel):
    expected: str
    heard: str | None
    score: float
    missed_sounds: list[str]


class FeedbackOut(BaseModel):
    contrast: str | None = _if_used()
    in_place: int | None = _if_used("Word sequence: words in the right place")
    length: int | None = _if_used()
    score: float | None = _if_used("Speech practice: 0-100")
    heard: str | None = _if_used("Speech practice: what was recognised")
    words: list[WordFeedbackOut] | None = _if_used()
    practise_sounds: list[str] | None = _if_used("ARPAbet sounds missed")


class RoundOut(BaseModel):
    index: int
    prompt: PromptOut
    answered: bool
    is_correct: bool | None
    given_answer: GivenAnswerOut | None
    correct_answer: CorrectAnswerOut | None = Field(
        description="Shown once the round is answered or the session has ended"
    )


class AnswerOut(BaseModel):
    index: int
    is_correct: bool
    score: float = Field(description="0-100 for this round (partial credit where it applies)")
    correct_answer: CorrectAnswerOut
    feedback: FeedbackOut
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
    # Celebration details, only in the response to /complete:
    streak_days: int | None = None
    new_achievements: list[AchievementOut] = Field(default_factory=list)
    goals_achieved: list[str] = Field(default_factory=list, description="Titles of goals just met")


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


class SttStatusOut(BaseModel):
    provider: str | None
    available: bool


class TtsStatusOut(BaseModel):
    voice: str | None
    available: bool


class SpeechStatusOut(BaseModel):
    stt: SttStatusOut = Field(description="Server speech recognition (spoken answers)")
    tts: TtsStatusOut = Field(description="Server speech audio (words and sentences)")

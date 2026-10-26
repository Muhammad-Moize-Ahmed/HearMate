import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from ...db.models import Difficulty, GoalStatus, SkillCategory


class AchievementOut(BaseModel):
    code: str
    title: str
    description: str
    icon: str
    unlocked_at: datetime | None = None


class GoalProgressOut(BaseModel):
    id: uuid.UUID
    title: str
    category: SkillCategory | None
    current_value: int
    target_value: int
    due_date: date | None
    status: GoalStatus


class Totals(BaseModel):
    sessions: int
    points: int
    minutes: int


class SkillProgressOut(BaseModel):
    category: SkillCategory
    level: int
    difficulty: Difficulty
    sessions: int = Field(description="Completed sessions in the period")
    average_accuracy: float | None
    accuracy_change: float | None = Field(
        description="Average accuracy of the later half of the period minus the earlier half"
        " (needs at least 4 sessions)"
    )
    minutes: int


class LevelChangeOut(BaseModel):
    category: SkillCategory
    old_level: int
    new_level: int
    reason: str
    changed_at: datetime


class PeriodOut(BaseModel):
    start: date
    end: date
    days: int
    timezone: str


class ProgressSummaryOut(BaseModel):
    child_id: uuid.UUID
    period: PeriodOut
    all_time: Totals
    in_period: Totals
    current_streak: int
    longest_streak: int
    achievements_unlocked: int
    skills: list[SkillProgressOut]
    recent_level_changes: list[LevelChangeOut]
    active_goals: list[GoalProgressOut]


class DayOut(BaseModel):
    date: date
    sessions: int
    points: int
    minutes: int
    average_accuracy: float | None


class GameReportOut(BaseModel):
    slug: str
    title: str
    category: SkillCategory
    sessions: int
    average_accuracy: float | None
    best_accuracy: float | None
    average_response_ms: int | None


class NoiseBandOut(BaseModel):
    band: str
    snr_range_db: str
    rounds: int
    accuracy: float


class SoundToPractiseOut(BaseModel):
    sound: str = Field(description="ARPAbet phoneme, e.g. TH")
    misses: int


class SpeechReportOut(BaseModel):
    attempts: int
    average_score: float | None
    sounds_to_practise: list[SoundToPractiseOut]


class ContrastOut(BaseModel):
    contrast: str
    rounds: int
    accuracy: float


class ChildReportOut(BaseModel):
    """Detailed report for parents and linked therapists (UC-4, UC-6)."""

    generated_at: datetime
    summary: ProgressSummaryOut
    games: list[GameReportOut]
    listening_in_noise: list[NoiseBandOut]
    speech: SpeechReportOut
    hardest_contrasts: list[ContrastOut]
    level_changes: list[LevelChangeOut]


class PersonalBestOut(BaseModel):
    game: str
    title: str
    sessions: int
    best_accuracy: float | None
    best_points: int
    highest_level: int
    last_played_at: datetime | None


class FamilyMemberOut(BaseModel):
    child_id: uuid.UUID
    display_name: str
    avatar: str
    this_week: Totals
    current_streak: int
    achievements_unlocked: int

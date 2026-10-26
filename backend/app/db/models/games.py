import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base, TimestampMixin, UUIDPrimaryKeyMixin, str_enum, timestamptz
from .enums import Difficulty, SessionStatus, SkillCategory


class Game(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Catalogue entry. The frontend picks the component by `slug`, never by `title`."""

    __tablename__ = "games"
    __table_args__ = (CheckConstraint("slug ~ '^[a-z0-9-]+$'", name="slug_format"),)

    slug: Mapped[str] = mapped_column(String(64), unique=True)
    title: Mapped[str] = mapped_column(String(100))
    category: Mapped[SkillCategory] = mapped_column(str_enum(SkillCategory, "skill_category"))
    description: Mapped[str] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(64))
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0)
    is_active: Mapped[bool] = mapped_column(default=True)
    requires_microphone: Mapped[bool] = mapped_column(default=False)
    # Per-game settings whose shape differs by game type; validated by that game's schema.
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")


class GameSession(UUIDPrimaryKeyMixin, Base):
    """One play-through. Scores are computed by the server from the rounds, never sent in."""

    __tablename__ = "game_sessions"
    __table_args__ = (
        Index("ix_game_sessions_child_started", "child_id", "started_at"),
        CheckConstraint("points >= 0", name="points_non_negative"),
        CheckConstraint(
            "accuracy IS NULL OR (accuracy >= 0 AND accuracy <= 100)", name="accuracy_range"
        ),
        CheckConstraint(
            "correct_rounds >= 0 AND correct_rounds <= total_rounds", name="round_counts"
        ),
        CheckConstraint(
            "(status = 'completed') = (completed_at IS NOT NULL)", name="completed_at_matches"
        ),
    )

    child_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"))
    # RESTRICT: games with history are deactivated, not deleted.
    game_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("games.id", ondelete="RESTRICT"), index=True
    )
    status: Mapped[SessionStatus] = mapped_column(
        str_enum(SessionStatus, "session_status"), default=SessionStatus.IN_PROGRESS
    )
    difficulty: Mapped[Difficulty] = mapped_column(str_enum(Difficulty, "difficulty"))
    level_at_start: Mapped[int] = mapped_column(SmallInteger)
    level_at_end: Mapped[int | None] = mapped_column(SmallInteger)
    with_noise: Mapped[bool] = mapped_column(default=False)
    noise_snr_db: Mapped[float | None] = mapped_column(Float)
    total_rounds: Mapped[int] = mapped_column(SmallInteger, default=0)
    correct_rounds: Mapped[int] = mapped_column(SmallInteger, default=0)
    accuracy: Mapped[float | None] = mapped_column(Float)
    points: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(timestamptz(), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(timestamptz())
    duration_seconds: Mapped[int | None] = mapped_column(Integer)


class SessionRound(UUIDPrimaryKeyMixin, Base):
    """One item inside a session: what was asked, the expected answer, and the child's answer."""

    __tablename__ = "session_rounds"
    __table_args__ = (
        UniqueConstraint("session_id", "round_index"),
        CheckConstraint("response_time_ms IS NULL OR response_time_ms >= 0", name="rt_positive"),
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("game_sessions.id", ondelete="CASCADE")
    )
    round_index: Mapped[int] = mapped_column(SmallInteger)
    # Shapes differ per game (a word, a word sequence, a sound id…), hence JSONB.
    prompt: Mapped[dict[str, Any]] = mapped_column(JSONB)
    # Private: what the server plays for this round (never sent to the client).
    stimulus: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    expected_answer: Mapped[dict[str, Any]] = mapped_column(JSONB)
    given_answer: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    is_correct: Mapped[bool | None]
    response_time_ms: Mapped[int | None] = mapped_column(Integer)
    noise_snr_db: Mapped[float | None] = mapped_column(Float)
    answered_at: Mapped[datetime | None] = mapped_column(timestamptz())


class SpeechAttempt(UUIDPrimaryKeyMixin, Base):
    """A spoken answer to a speech round, scored by the STT provider."""

    __tablename__ = "speech_attempts"
    __table_args__ = (
        CheckConstraint("accuracy >= 0 AND accuracy <= 100", name="accuracy_range"),
        UniqueConstraint("round_id", "attempt_number"),
    )

    round_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("session_rounds.id", ondelete="CASCADE"))
    attempt_number: Mapped[int] = mapped_column(SmallInteger, default=1)
    expected_text: Mapped[str] = mapped_column(Text)
    recognized_text: Mapped[str | None] = mapped_column(Text)
    accuracy: Mapped[float] = mapped_column(Float)
    word_scores: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, default=list, server_default="[]"
    )
    provider: Mapped[str] = mapped_column(String(50))
    audio_duration_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(timestamptz(), server_default=func.now())

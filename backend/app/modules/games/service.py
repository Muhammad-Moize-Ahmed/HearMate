"""Game sessions owned by the server.

Flow: start (server builds the rounds) -> play each round's stimulus audio -> answer it (server
checks it; speech answers are uploaded as audio and transcribed here) -> complete (server totals
accuracy and points and moves the child's level). Clients never send scores.
"""

import random
import statistics
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from http import HTTPStatus
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ...auth.policies import get_viewable_child
from ...auth.principal import Principal
from ...core.config import Settings
from ...core.errors import AppError, ConflictError, NotFoundError
from ...db.models import (
    Game,
    GameSession,
    LevelHistory,
    SessionRound,
    SessionStatus,
    SkillCategory,
    SkillLevel,
    SpeechAttempt,
)
from ...providers.speech import SpeechServices
from .adaptive import DEFAULT_STRATEGY, DifficultyStrategy, LevelDecision, SessionPerformance
from .content import ContentBank, load_bank
from .definitions import REGISTRY, GameDefinition, RoundContext
from .definitions.base import SpeechAnswer
from .levels import MIN_LEVEL, tier_for_level
from .schemas import (
    AnswerIn,
    AnswerOut,
    RoundOut,
    SessionGameOut,
    SessionOut,
    SessionResultOut,
    SessionSummaryOut,
    SkillLevelOut,
    StartSessionIn,
)
from .scoring import accuracy_percent, session_points

# Longer than this between start and finish counts as this long (e.g. a tab left open).
MAX_DURATION_SECONDS = 2 * 60 * 60


class AnswerValidationError(AppError):
    status_code = HTTPStatus.UNPROCESSABLE_ENTITY
    code = "validation_error"


@dataclass(frozen=True, slots=True)
class SpeechMeta:
    """How a spoken answer was recognised (stored with the attempt)."""

    provider: str
    audio_duration_ms: int | None = None


@dataclass(frozen=True, slots=True)
class Stimulus:
    """What the server should play for a round (private), and any noise to mix in."""

    content: dict[str, Any]
    noise: dict[str, Any] | None


class GameSessionService:
    def __init__(
        self,
        db: Session,
        principal: Principal,
        *,
        settings: Settings,
        strategy: DifficultyStrategy = DEFAULT_STRATEGY,
        bank: ContentBank | None = None,
    ) -> None:
        self.db = db
        self.principal = principal
        self.settings = settings
        self.strategy = strategy
        self.bank = bank or load_bank()

    # ------------------------------------------------------------------ catalogue & levels

    def catalogue(self) -> list[GameDefinition]:
        rows = self.db.scalars(select(Game).where(Game.is_active).order_by(Game.sort_order))
        return [REGISTRY[g.slug] for g in rows if g.slug in REGISTRY]

    def levels(self, child_id: uuid.UUID) -> list[SkillLevelOut]:
        child = get_viewable_child(self.db, self.principal, child_id)
        stored = {
            s.category: s.level
            for s in self.db.scalars(select(SkillLevel).where(SkillLevel.child_id == child.id))
        }
        return [
            SkillLevelOut(
                category=category,
                level=stored.get(category, MIN_LEVEL),
                difficulty=tier_for_level(stored.get(category, MIN_LEVEL)),
            )
            for category in SkillCategory
        ]

    def history(
        self, child_id: uuid.UUID, *, game: str | None, limit: int
    ) -> list[SessionSummaryOut]:
        child = get_viewable_child(self.db, self.principal, child_id)
        query = (
            select(GameSession, Game)
            .join(Game, Game.id == GameSession.game_id)
            .where(GameSession.child_id == child.id)
            .order_by(GameSession.started_at.desc())
            .limit(limit)
        )
        if game is not None:
            query = query.where(Game.slug == game)
        return [
            SessionSummaryOut(
                id=s.id,
                game=_game_out(g),
                status=s.status,
                difficulty=s.difficulty,
                level_at_start=s.level_at_start,
                level_at_end=s.level_at_end,
                accuracy=s.accuracy,
                points=s.points,
                started_at=s.started_at,
                completed_at=s.completed_at,
            )
            for s, g in self.db.execute(query)
        ]

    # ------------------------------------------------------------------ session lifecycle

    def start(self, data: StartSessionIn) -> SessionOut:
        child = get_viewable_child(self.db, self.principal, data.child_id)
        game = self.db.scalar(select(Game).where(Game.slug == data.game, Game.is_active))
        definition = REGISTRY.get(data.game)
        if game is None or definition is None:
            raise NotFoundError("Game not found", code="game_not_found")
        if data.with_noise and not (definition.supports_noise or definition.always_noise):
            raise AppError(
                "This game can't be played with background noise", code="noise_not_supported"
            )

        level = self._skill(child.id, definition.category).level
        # One active session per child: starting a new game ends any unfinished one.
        self.db.execute(
            update(GameSession)
            .where(
                GameSession.child_id == child.id,
                GameSession.status == SessionStatus.IN_PROGRESS,
            )
            .values(status=SessionStatus.ABANDONED)
        )

        session = GameSession(
            id=uuid.uuid4(),
            child_id=child.id,
            game_id=game.id,
            difficulty=tier_for_level(level),
            level_at_start=level,
            with_noise=data.with_noise or definition.always_noise,
            # App clock, not the DB's now(): that is fixed per transaction and would tie.
            started_at=datetime.now(UTC),
        )
        # Seeded from the session id, so a session's rounds can be regenerated when debugging.
        rng = random.Random(session.id.int)  # noqa: S311 - game content, not security
        specs = definition.build_rounds(
            RoundContext(level=level, rng=rng, bank=self.bank, with_noise=session.with_noise)
        )
        session.total_rounds = len(specs)
        session.noise_snr_db = specs[0].noise_snr_db if specs else None
        self.db.add(session)
        self.db.flush()
        self.db.add_all(
            SessionRound(
                session_id=session.id,
                round_index=index,
                # The client gets a URL to the audio, never the word or sound itself.
                prompt=spec.prompt
                | {
                    "stimulus": {
                        "type": spec.stimulus["type"],
                        "audio_url": self._stimulus_url(session.id, index),
                    }
                },
                stimulus=spec.stimulus,
                expected_answer=spec.expected,
                noise_snr_db=spec.noise_snr_db,
            )
            for index, spec in enumerate(specs)
        )
        self.db.commit()
        return self.get(session.id)

    def get(self, session_id: uuid.UUID) -> SessionOut:
        session = self._load(session_id)
        return self._session_out(session)

    def stimulus(self, session_id: uuid.UUID, index: int) -> Stimulus:
        session = self._load(session_id)
        round_ = self._round(session, index)
        if not round_.stimulus:
            raise NotFoundError("This round has no audio", code="stimulus_unavailable")
        return Stimulus(content=round_.stimulus, noise=round_.prompt.get("noise"))

    def answer_speech(
        self,
        session_id: uuid.UUID,
        index: int,
        audio: bytes,
        response_time_ms: int | None,
        speech: SpeechServices,
    ) -> AnswerOut:
        """Transcribe an uploaded recording and answer the round with it.

        Permissions and round state are checked before the (slow) transcription, and again
        when the answer is recorded.
        """
        session = self._load(session_id)
        _require_in_progress(session)
        if not self._definition(session).requires_microphone:
            raise AppError("This game doesn't take spoken answers", code="not_a_speech_game")
        round_ = self._round(session, index)
        if round_.answered_at is not None:
            raise ConflictError("This round has already been answered", code="already_answered")
        self.db.rollback()  # don't hold a transaction open while transcribing

        transcription, clip = speech.transcribe(audio)
        return self.answer(
            session_id,
            index,
            AnswerIn(
                answer={"transcript": transcription.text[:500]},
                response_time_ms=response_time_ms,
            ),
            speech_meta=SpeechMeta(transcription.provider, clip.duration_ms),
        )

    def answer(
        self,
        session_id: uuid.UUID,
        index: int,
        body: AnswerIn,
        *,
        speech_meta: SpeechMeta | None = None,
    ) -> AnswerOut:
        session = self._load(session_id, lock=True)
        _require_in_progress(session)
        definition = self._definition(session)
        round_ = self._round(session, index, lock=True)
        if round_.answered_at is not None:
            raise ConflictError("This round has already been answered", code="already_answered")

        try:
            answer = definition.answer_model.model_validate(body.answer)
        except ValidationError as exc:
            raise AnswerValidationError(
                "The answer doesn't fit this game",
                details=[
                    {"loc": ["body", "answer", *err["loc"]], "msg": err["msg"], "type": err["type"]}
                    for err in exc.errors()
                ],
            ) from exc

        check = definition.check(round_.expected_answer, answer)
        round_.given_answer = answer.model_dump()
        round_.is_correct = check.is_correct
        round_.response_time_ms = body.response_time_ms
        round_.answered_at = datetime.now(UTC)
        if isinstance(answer, SpeechAnswer):
            meta = speech_meta or SpeechMeta(provider="browser")
            self.db.add(
                SpeechAttempt(
                    round_id=round_.id,
                    expected_text=round_.expected_answer["text"],
                    recognized_text=answer.transcript,
                    accuracy=check.score,
                    word_scores=check.feedback.get("words", []),
                    provider=meta.provider,
                    audio_duration_ms=meta.audio_duration_ms,
                )
            )
        self.db.commit()

        remaining = self.db.scalar(
            select(func.count())
            .select_from(SessionRound)
            .where(SessionRound.session_id == session.id, SessionRound.answered_at.is_(None))
        )
        return AnswerOut(
            index=index,
            is_correct=check.is_correct,
            score=check.score,
            correct_answer=round_.expected_answer,
            feedback=check.feedback,
            rounds_remaining=remaining or 0,
        )

    def complete(self, session_id: uuid.UUID) -> SessionOut:
        session = self._load(session_id, lock=True)
        _require_in_progress(session)
        definition = self._definition(session)
        rounds = self._rounds(session)
        unanswered = [r.round_index for r in rounds if r.answered_at is None]
        if unanswered:
            raise ConflictError(
                "Answer every round before finishing",
                code="rounds_unanswered",
                details={"unanswered": unanswered},
            )

        now = datetime.now(UTC)
        correct = sum(1 for r in rounds if r.is_correct)
        session.correct_rounds = correct
        session.accuracy = accuracy_percent(correct, len(rounds))
        session.points = session_points(correct, len(rounds), session.difficulty)
        session.status = SessionStatus.COMPLETED
        session.completed_at = now
        session.duration_seconds = min(
            int((now - session.started_at).total_seconds()), MAX_DURATION_SECONDS
        )

        decision = self._adapt_level(session, definition, rounds)
        session.level_at_end = decision.new_level
        self.db.commit()
        return self._session_out(session, level_reason=decision.reason)

    def abandon(self, session_id: uuid.UUID) -> SessionOut:
        session = self._load(session_id, lock=True)
        _require_in_progress(session)
        session.status = SessionStatus.ABANDONED
        self.db.commit()
        return self._session_out(session)

    # ------------------------------------------------------------------ adaptive difficulty

    def _adapt_level(
        self, session: GameSession, definition: GameDefinition, rounds: list[SessionRound]
    ) -> LevelDecision:
        skill = self._skill(session.child_id, definition.category, lock=True)
        current = _performance(definition, session.level_at_start, rounds)
        earlier = self._earlier_performance(session, definition.category, skill.level)
        decision = self.strategy.decide(skill.level, [current, *earlier])

        if decision.new_level != skill.level:
            self.db.add(
                LevelHistory(
                    child_id=session.child_id,
                    category=definition.category,
                    old_level=skill.level,
                    new_level=decision.new_level,
                    reason=decision.reason,
                    session_id=session.id,
                )
            )
            skill.level = decision.new_level
        return decision

    def _earlier_performance(
        self, session: GameSession, category: SkillCategory, level: int
    ) -> list[SessionPerformance]:
        """Earlier completed sessions in this category at the current level, newest first."""
        window = self.strategy.window
        rows = self.db.execute(
            select(GameSession, Game.slug)
            .join(Game, Game.id == GameSession.game_id)
            .where(
                GameSession.child_id == session.child_id,
                GameSession.id != session.id,
                GameSession.status == SessionStatus.COMPLETED,
                GameSession.level_at_start == level,
                Game.category == category,
            )
            .order_by(GameSession.completed_at.desc())
            .limit(max(window - 1, 0))
        ).all()
        return [
            _performance(REGISTRY[slug], s.level_at_start, self._rounds(s))
            for s, slug in rows
            if slug in REGISTRY
        ]

    # ------------------------------------------------------------------ helpers

    def _load(self, session_id: uuid.UUID, *, lock: bool = False) -> GameSession:
        session = self.db.get(GameSession, session_id, with_for_update=lock)
        if session is None:
            raise NotFoundError("Session not found")
        try:
            get_viewable_child(self.db, self.principal, session.child_id)
        except NotFoundError:
            raise NotFoundError("Session not found") from None
        return session

    def _round(self, session: GameSession, index: int, *, lock: bool = False) -> SessionRound:
        query = select(SessionRound).where(
            SessionRound.session_id == session.id, SessionRound.round_index == index
        )
        round_ = self.db.scalar(query.with_for_update() if lock else query)
        if round_ is None:
            raise NotFoundError("Round not found")
        return round_

    def _stimulus_url(self, session_id: uuid.UUID, index: int) -> str:
        return f"{self.settings.API_PREFIX}/sessions/{session_id}/rounds/{index}/stimulus"

    def _definition(self, session: GameSession) -> GameDefinition:
        game = self.db.get(Game, session.game_id)
        if game is None or game.slug not in REGISTRY:
            raise NotFoundError("Game not found", code="game_not_found")
        return REGISTRY[game.slug]

    def _rounds(self, session: GameSession) -> list[SessionRound]:
        return list(
            self.db.scalars(
                select(SessionRound)
                .where(SessionRound.session_id == session.id)
                .order_by(SessionRound.round_index)
            )
        )

    def _skill(
        self, child_id: uuid.UUID, category: SkillCategory, *, lock: bool = False
    ) -> SkillLevel:
        # Insert-if-missing without racing a concurrent first session.
        self.db.execute(
            pg_insert(SkillLevel)
            .values(id=uuid.uuid4(), child_id=child_id, category=category, level=MIN_LEVEL)
            .on_conflict_do_nothing(index_elements=["child_id", "category"])
        )
        query = select(SkillLevel).where(
            SkillLevel.child_id == child_id, SkillLevel.category == category
        )
        skill = self.db.scalar(query.with_for_update() if lock else query)
        assert skill is not None  # noqa: S101 - inserted above
        return skill

    def _session_out(self, session: GameSession, *, level_reason: str | None = None) -> SessionOut:
        game = self.db.get(Game, session.game_id)
        assert game is not None  # noqa: S101 - foreign key
        reveal_all = session.status is not SessionStatus.IN_PROGRESS
        rounds = [
            RoundOut(
                index=r.round_index,
                prompt=r.prompt,
                answered=r.answered_at is not None,
                is_correct=r.is_correct,
                given_answer=r.given_answer,
                correct_answer=(
                    r.expected_answer if reveal_all or r.answered_at is not None else None
                ),
            )
            for r in self._rounds(session)
        ]
        result = None
        if session.status is SessionStatus.COMPLETED:
            if level_reason is None:
                level_reason = self.db.scalar(
                    select(LevelHistory.reason).where(LevelHistory.session_id == session.id)
                )
            result = SessionResultOut(
                total_rounds=session.total_rounds,
                correct_rounds=session.correct_rounds,
                accuracy=session.accuracy or 0.0,
                points=session.points,
                duration_seconds=session.duration_seconds,
                level_before=session.level_at_start,
                level_after=session.level_at_end or session.level_at_start,
                level_reason=level_reason,
            )
        return SessionOut(
            id=session.id,
            child_id=session.child_id,
            game=_game_out(game),
            status=session.status,
            difficulty=session.difficulty,
            level=session.level_at_start,
            with_noise=session.with_noise,
            started_at=session.started_at,
            completed_at=session.completed_at,
            rounds=rounds,
            result=result,
        )


def _require_in_progress(session: GameSession) -> None:
    if session.status is not SessionStatus.IN_PROGRESS:
        raise ConflictError("This session has already ended", code="session_not_active")


def _performance(
    definition: GameDefinition, level: int, rounds: list[SessionRound]
) -> SessionPerformance:
    correct = sum(1 for r in rounds if r.is_correct)
    times = [r.response_time_ms for r in rounds if r.response_time_ms is not None]
    return SessionPerformance(
        accuracy=accuracy_percent(correct, len(rounds)),
        median_response_ms=int(statistics.median(times)) if times else None,
        reference_response_ms=definition.reference_response_ms(level),
    )


def _game_out(game: Game) -> SessionGameOut:
    return SessionGameOut(slug=game.slug, title=game.title, category=game.category)

"""Progress views: summary, daily trend, detailed report, achievements, personal bests, family.

Everything is computed from stored sessions and rounds, per child, in the child's local days.
Children never see other families; the only comparison is between siblings.
"""

import statistics
import uuid
from collections import Counter, defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...auth.policies import get_viewable_child
from ...auth.principal import Principal, PrincipalKind
from ...core.audit import record_event
from ...core.config import Settings
from ...core.errors import PermissionDeniedError
from ...db.models import Achievement as AchievementRow
from ...db.models import (
    Child,
    DailyActivity,
    Game,
    GameSession,
    Goal,
    GoalStatus,
    LevelHistory,
    SessionRound,
    SessionStatus,
    SkillCategory,
    SkillLevel,
    SpeechAttempt,
)
from ..games.levels import MIN_LEVEL, tier_for_level
from .achievements import CATALOGUE
from .calendar import child_zone, current_streak, local_date, longest_streak, start_of_day
from .schemas import (
    AchievementOut,
    ChildReportOut,
    ContrastOut,
    DayLevelOut,
    DayOut,
    FamilyMemberOut,
    GameDayOut,
    GameReportOut,
    GoalProgressOut,
    LevelChangeOut,
    NoiseBandOut,
    PeriodOut,
    PersonalBestOut,
    ProgressSummaryOut,
    SkillProgressOut,
    SoundToPractiseOut,
    SpeechReportOut,
    Totals,
)

# Signal-to-noise bands for the listening-in-noise breakdown (lower SNR = louder noise).
NOISE_BANDS = (
    ("quiet", "15 dB and above", 15.0, float("inf")),
    ("moderate", "8-14 dB", 8.0, 15.0),
    ("loud", "below 8 dB", float("-inf"), 8.0),
)
MIN_SESSIONS_FOR_CHANGE = 4
TOP_N = 5


class ProgressService:
    def __init__(self, db: Session, principal: Principal, *, settings: Settings) -> None:
        self.db = db
        self.principal = principal
        self.settings = settings

    # ------------------------------------------------------------------ public views

    def summary(
        self, child_id: uuid.UUID, days: int, end: date | None = None
    ) -> ProgressSummaryOut:
        child = get_viewable_child(self.db, self.principal, child_id)
        result = self._summary(child, days, end)
        self._audit_therapist(child, "child_progress_viewed")
        return result

    def trend(self, child_id: uuid.UUID, days: int, end: date | None = None) -> list[DayOut]:
        """One entry per local day in the period (zeros on days without play), oldest first."""
        child = get_viewable_child(self.db, self.principal, child_id)
        zone = child_zone(child, self.settings)
        start, last, _today = self._period(child, days, end)
        activity = {
            a.activity_date: a
            for a in self.db.scalars(
                select(DailyActivity).where(
                    DailyActivity.child_id == child.id,
                    DailyActivity.activity_date.between(start, last),
                )
            )
        }
        sessions_by_day: dict[date, list[tuple[GameSession, Game]]] = defaultdict(list)
        for session, game in self._completed(
            child, start_of_day(start, zone), start_of_day(last + timedelta(days=1), zone)
        ):
            assert session.completed_at is not None  # noqa: S101 - completed sessions
            sessions_by_day[local_date(session.completed_at, zone)].append((session, game))
        levels = self._levels_by_day(child, start, last)

        series = []
        for offset in range(days):
            day = start + timedelta(days=offset)
            a = activity.get(day)
            played = sessions_by_day.get(day, [])
            series.append(
                DayOut(
                    date=day,
                    sessions=a.sessions_completed if a else 0,
                    points=a.points_earned if a else 0,
                    minutes=(a.seconds_practised // 60) if a else 0,
                    average_accuracy=_mean([s.accuracy or 0.0 for s, _ in played]),
                    games=_games_on_day(played),
                    levels=levels[day],
                )
            )
        return series

    def report(self, child_id: uuid.UUID, days: int, end: date | None = None) -> ChildReportOut:
        child = get_viewable_child(self.db, self.principal, child_id)
        if self.principal.is_child:
            raise PermissionDeniedError("Reports are for parents and therapists")
        zone = child_zone(child, self.settings)
        start, last, _today = self._period(child, days, end)
        since = start_of_day(start, zone)
        until = start_of_day(last + timedelta(days=1), zone)
        rows = self._completed(child, since, until)
        session_ids = [s.id for s, _ in rows]

        report = ChildReportOut(
            generated_at=datetime.now(UTC),
            summary=self._summary(child, days, end),
            games=self._games_report(rows),
            listening_in_noise=self._noise_bands(session_ids),
            speech=self._speech_report(session_ids),
            hardest_contrasts=self._contrasts(session_ids),
            level_changes=self._level_changes(child, since=since, until=until),
        )
        self._audit_therapist(child, "child_report_viewed")
        return report

    def achievements(self, child_id: uuid.UUID) -> list[AchievementOut]:
        """The whole catalogue, with unlock dates for those earned."""
        child = get_viewable_child(self.db, self.principal, child_id)
        unlocked = dict(
            self.db.execute(
                select(AchievementRow.code, AchievementRow.unlocked_at).where(
                    AchievementRow.child_id == child.id
                )
            ).all()
        )
        return [
            AchievementOut(
                code=a.code,
                title=a.title,
                description=a.description,
                icon=a.icon,
                unlocked_at=unlocked.get(a.code),
            )
            for a in CATALOGUE
        ]

    def personal_bests(self, child_id: uuid.UUID) -> list[PersonalBestOut]:
        child = get_viewable_child(self.db, self.principal, child_id)
        rows = self.db.execute(
            select(
                Game.slug,
                Game.title,
                func.count(GameSession.id),
                func.max(GameSession.accuracy),
                func.max(GameSession.points),
                func.max(GameSession.level_at_end),
                func.max(GameSession.completed_at),
            )
            .join(GameSession, GameSession.game_id == Game.id)
            .where(
                GameSession.child_id == child.id,
                GameSession.status == SessionStatus.COMPLETED,
            )
            .group_by(Game.slug, Game.title, Game.sort_order)
            .order_by(Game.sort_order)
        )
        return [
            PersonalBestOut(
                game=slug,
                title=title,
                sessions=count,
                best_accuracy=best_accuracy,
                best_points=best_points or 0,
                highest_level=highest_level or MIN_LEVEL,
                last_played_at=last_played,
            )
            for slug, title, count, best_accuracy, best_points, highest_level, last_played in rows
        ]

    def family(self) -> list[FamilyMemberOut]:
        """Siblings side by side (this week). Parents see their children; a child sees siblings."""
        match self.principal.kind:
            case PrincipalKind.PARENT:
                parent_id = self.principal.id
            case PrincipalKind.CHILD:
                me = self.db.get(Child, self.principal.id)
                assert me is not None  # noqa: S101 - authenticated child
                parent_id = me.parent_id
            case _:
                raise PermissionDeniedError("Family progress is only for families")

        members = []
        for child in self.db.scalars(
            select(Child).where(Child.parent_id == parent_id).order_by(Child.display_name)
        ):
            today = local_date(datetime.now(UTC), child_zone(child, self.settings))
            week = self.db.execute(
                select(
                    func.coalesce(func.sum(DailyActivity.sessions_completed), 0),
                    func.coalesce(func.sum(DailyActivity.points_earned), 0),
                    func.coalesce(func.sum(DailyActivity.seconds_practised), 0),
                ).where(
                    DailyActivity.child_id == child.id,
                    DailyActivity.activity_date >= today - timedelta(days=6),
                )
            ).one()
            members.append(
                FamilyMemberOut(
                    child_id=child.id,
                    display_name=child.display_name,
                    avatar=child.avatar,
                    this_week=Totals(sessions=week[0], points=week[1], minutes=week[2] // 60),
                    current_streak=current_streak(self._play_dates(child), today),
                    achievements_unlocked=self._achievement_count(child),
                )
            )
        return members

    # ------------------------------------------------------------------ summary pieces

    def _summary(self, child: Child, days: int, end: date | None) -> ProgressSummaryOut:
        zone = child_zone(child, self.settings)
        start, last, today = self._period(child, days, end)
        rows = self._completed(
            child, start_of_day(start, zone), start_of_day(last + timedelta(days=1), zone)
        )
        play_dates = self._play_dates(child)

        all_time = self.db.execute(
            select(
                func.coalesce(func.sum(DailyActivity.sessions_completed), 0),
                func.coalesce(func.sum(DailyActivity.points_earned), 0),
                func.coalesce(func.sum(DailyActivity.seconds_practised), 0),
            ).where(DailyActivity.child_id == child.id)
        ).one()
        levels = dict(
            self.db.execute(
                select(SkillLevel.category, SkillLevel.level).where(SkillLevel.child_id == child.id)
            ).all()
        )
        goals = self.db.scalars(
            select(Goal)
            .where(Goal.child_id == child.id, Goal.status == GoalStatus.ACTIVE)
            .order_by(Goal.created_at)
        )

        return ProgressSummaryOut(
            child_id=child.id,
            period=PeriodOut(start=start, end=last, days=days, timezone=zone.key),
            all_time=Totals(sessions=all_time[0], points=all_time[1], minutes=all_time[2] // 60),
            in_period=Totals(
                sessions=len(rows),
                points=sum(s.points for s, _ in rows),
                minutes=sum(s.duration_seconds or 0 for s, _ in rows) // 60,
            ),
            current_streak=current_streak(play_dates, today),
            longest_streak=longest_streak(play_dates),
            achievements_unlocked=self._achievement_count(child),
            skills=[
                self._skill_progress(category, levels.get(category, MIN_LEVEL), rows)
                for category in SkillCategory
            ],
            recent_level_changes=self._level_changes(child, limit=TOP_N),
            active_goals=[
                GoalProgressOut(
                    id=g.id,
                    title=g.title,
                    category=g.category,
                    current_value=g.current_value,
                    target_value=g.target_value,
                    due_date=g.due_date,
                    status=g.status,
                )
                for g in goals
            ],
        )

    def _skill_progress(
        self, category: SkillCategory, level: int, rows: list[tuple[GameSession, Game]]
    ) -> SkillProgressOut:
        sessions = [s for s, g in rows if g.category is category]
        scores = [s.accuracy or 0.0 for s in sessions]  # rows are oldest first
        change = None
        if len(scores) >= MIN_SESSIONS_FOR_CHANGE:
            half = len(scores) // 2
            change = round(statistics.fmean(scores[half:]) - statistics.fmean(scores[:half]), 1)
        return SkillProgressOut(
            category=category,
            level=level,
            difficulty=tier_for_level(level),
            sessions=len(sessions),
            average_accuracy=_mean(scores),
            accuracy_change=change,
            minutes=sum(s.duration_seconds or 0 for s in sessions) // 60,
        )

    def _level_changes(
        self,
        child: Child,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int | None = None,
    ) -> list[LevelChangeOut]:
        query = (
            select(LevelHistory)
            .where(LevelHistory.child_id == child.id)
            .order_by(LevelHistory.created_at.desc())
        )
        if since is not None:
            query = query.where(LevelHistory.created_at >= since)
        if until is not None:
            query = query.where(LevelHistory.created_at < until)
        if limit is not None:
            query = query.limit(limit)
        return [
            LevelChangeOut(
                category=h.category,
                old_level=h.old_level,
                new_level=h.new_level,
                reason=h.reason,
                changed_at=h.created_at,
            )
            for h in self.db.scalars(query)
        ]

    # ------------------------------------------------------------------ report pieces

    def _games_report(self, rows: list[tuple[GameSession, Game]]) -> list[GameReportOut]:
        by_game: dict[str, tuple[Game, list[GameSession]]] = {}
        for session, game in rows:
            by_game.setdefault(game.slug, (game, []))[1].append(session)
        response_ms: dict[uuid.UUID, float | None] = dict(
            self.db.execute(
                select(GameSession.game_id, func.avg(SessionRound.response_time_ms))
                .join(SessionRound, SessionRound.session_id == GameSession.id)
                .where(
                    GameSession.id.in_([s.id for s, _ in rows]),
                    SessionRound.response_time_ms.is_not(None),
                )
                .group_by(GameSession.game_id)
            ).all()
        )
        report = []
        for game, sessions in sorted(by_game.values(), key=lambda item: item[0].sort_order):
            scores = [s.accuracy or 0.0 for s in sessions]
            average_ms = response_ms.get(game.id)
            report.append(
                GameReportOut(
                    slug=game.slug,
                    title=game.title,
                    category=game.category,
                    sessions=len(sessions),
                    average_accuracy=_mean(scores),
                    best_accuracy=max(scores) if scores else None,
                    average_response_ms=round(average_ms) if average_ms is not None else None,
                )
            )
        return report

    def _noise_bands(self, session_ids: list[uuid.UUID]) -> list[NoiseBandOut]:
        """Accuracy by how loud the background noise was: the core APD measure."""
        rounds = self.db.execute(
            select(SessionRound.noise_snr_db, SessionRound.is_correct).where(
                SessionRound.session_id.in_(session_ids),
                SessionRound.noise_snr_db.is_not(None),
                SessionRound.answered_at.is_not(None),
            )
        )
        tally: dict[str, list[bool]] = defaultdict(list)
        for snr, correct in rounds:
            assert snr is not None  # noqa: S101 - filtered above
            band = next(name for name, _label, low, high in NOISE_BANDS if low <= snr < high)
            tally[band].append(bool(correct))
        return [
            NoiseBandOut(
                band=name,
                snr_range_db=label,
                rounds=len(tally[name]),
                accuracy=round(100 * sum(tally[name]) / len(tally[name]), 1),
            )
            for name, label, _low, _high in NOISE_BANDS
            if tally[name]
        ]

    def _speech_report(self, session_ids: list[uuid.UUID]) -> SpeechReportOut:
        attempts = self.db.scalars(
            select(SpeechAttempt)
            .join(SessionRound, SessionRound.id == SpeechAttempt.round_id)
            .where(SessionRound.session_id.in_(session_ids))
        ).all()
        missed: Counter[str] = Counter(
            sound
            for attempt in attempts
            for word in attempt.word_scores
            for sound in _missed_sounds(word)
        )
        return SpeechReportOut(
            attempts=len(attempts),
            average_score=_mean([a.accuracy for a in attempts]),
            sounds_to_practise=[
                SoundToPractiseOut(sound=sound, misses=count)
                for sound, count in missed.most_common(TOP_N)
            ],
        )

    def _contrasts(self, session_ids: list[uuid.UUID]) -> list[ContrastOut]:
        """Minimal-pair contrasts the child finds hardest (Similar Sounds rounds)."""
        rounds = self.db.execute(
            select(SessionRound.expected_answer, SessionRound.is_correct).where(
                SessionRound.session_id.in_(session_ids),
                SessionRound.answered_at.is_not(None),
            )
        )
        tally: dict[str, list[bool]] = defaultdict(list)
        for expected, correct in rounds:
            if contrast := expected.get("contrast"):
                tally[contrast].append(bool(correct))
        ranked = sorted(
            tally.items(), key=lambda item: (sum(item[1]) / len(item[1]), -len(item[1]))
        )
        return [
            ContrastOut(
                contrast=contrast,
                rounds=len(results),
                accuracy=round(100 * sum(results) / len(results), 1),
            )
            for contrast, results in ranked[:TOP_N]
        ]

    # ------------------------------------------------------------------ helpers

    def _period(self, child: Child, days: int, end: date | None) -> tuple[date, date, date]:
        """(first day, last day, today) in the child's calendar; periods never end after today."""
        today = local_date(datetime.now(UTC), child_zone(child, self.settings))
        last = min(end, today) if end is not None else today
        return last - timedelta(days=days - 1), last, today

    def _completed(
        self, child: Child, since: datetime, until: datetime | None = None
    ) -> list[tuple[GameSession, Game]]:
        query = (
            select(GameSession, Game)
            .join(Game, Game.id == GameSession.game_id)
            .where(
                GameSession.child_id == child.id,
                GameSession.status == SessionStatus.COMPLETED,
                GameSession.completed_at >= since,
            )
            .order_by(GameSession.completed_at)
        )
        if until is not None:
            query = query.where(GameSession.completed_at < until)
        return list(self.db.execute(query))

    def _levels_by_day(
        self, child: Child, start: date, last: date
    ) -> dict[date, list[DayLevelOut]]:
        """The level in each skill at the end of each day, by undoing later level changes."""
        zone = child_zone(child, self.settings)
        level: dict[SkillCategory, int] = dict.fromkeys(SkillCategory, MIN_LEVEL)
        level.update(
            self.db.execute(
                select(SkillLevel.category, SkillLevel.level).where(SkillLevel.child_id == child.id)
            ).all()
        )
        changes = self.db.scalars(
            select(LevelHistory)
            .where(
                LevelHistory.child_id == child.id,
                LevelHistory.created_at >= start_of_day(start, zone),
            )
            .order_by(LevelHistory.created_at.desc())
        ).all()

        by_day = {}
        pending = iter(changes)
        change = next(pending, None)
        day = last
        # Changes after the period still need undoing, so this starts from today's levels.
        while day >= start:
            while change is not None and local_date(change.created_at, zone) > day:
                level[change.category] = change.old_level
                change = next(pending, None)
            by_day[day] = [DayLevelOut(category=c, level=level[c]) for c in SkillCategory]
            day -= timedelta(days=1)
        return by_day

    def _play_dates(self, child: Child) -> list[date]:
        return list(
            self.db.scalars(
                select(DailyActivity.activity_date).where(
                    DailyActivity.child_id == child.id, DailyActivity.sessions_completed > 0
                )
            )
        )

    def _achievement_count(self, child: Child) -> int:
        return (
            self.db.scalar(
                select(func.count())
                .select_from(AchievementRow)
                .where(AchievementRow.child_id == child.id)
            )
            or 0
        )

    def _audit_therapist(self, child: Child, action: str) -> None:
        if self.principal.kind is PrincipalKind.THERAPIST:
            record_event(
                self.db,
                action,
                resource_type="child",
                resource_id=child.id,
                actor_user_id=self.principal.id,
                child_id=child.id,
            )
            self.db.commit()


def _games_on_day(played: list[tuple[GameSession, Game]]) -> list[GameDayOut]:
    by_game: dict[str, tuple[Game, list[float]]] = {}
    for session, game in played:
        by_game.setdefault(game.slug, (game, []))[1].append(session.accuracy or 0.0)
    return [
        GameDayOut(
            game=game.slug,
            category=game.category,
            sessions=len(scores),
            average_accuracy=round(statistics.fmean(scores), 1),
        )
        for game, scores in sorted(by_game.values(), key=lambda item: item[0].sort_order)
    ]


def _mean(values: list[float] | None) -> float | None:
    return round(statistics.fmean(values), 1) if values else None


def _missed_sounds(word: Any) -> list[str]:
    sounds = word.get("missed_sounds", []) if isinstance(word, dict) else []
    return [s for s in sounds if isinstance(s, str)]

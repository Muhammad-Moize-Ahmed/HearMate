"""Server-side bookkeeping when a game session completes (same transaction as the completion):
daily activity, streak, achievements and goal progress."""

from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ...core.config import Settings
from ...db.models import (
    Achievement as AchievementRow,
)
from ...db.models import (
    Child,
    DailyActivity,
    Game,
    GameSession,
    Goal,
    GoalStatus,
    SessionStatus,
    SkillLevel,
)
from .achievements import Achievement, ProgressSnapshot, newly_earned
from .calendar import child_zone, current_streak, local_date, start_of_day


@dataclass(frozen=True, slots=True)
class CompletionRewards:
    streak_days: int
    new_achievements: list[Achievement] = field(default_factory=list)
    goals_achieved: list[Goal] = field(default_factory=list)


def record_completed_session(
    db: Session, session: GameSession, *, game_slug: str, settings: Settings
) -> CompletionRewards:
    assert session.completed_at is not None  # noqa: S101 - called after completion
    db.flush()  # the aggregates below must include this session
    child = db.get(Child, session.child_id)
    assert child is not None  # noqa: S101 - foreign key
    zone = child_zone(child, settings)
    today = local_date(session.completed_at, zone)

    _add_daily_activity(db, session, today)
    play_dates = db.scalars(
        select(DailyActivity.activity_date).where(
            DailyActivity.child_id == child.id, DailyActivity.sessions_completed > 0
        )
    ).all()
    streak = current_streak(play_dates, today)

    snapshot = _snapshot(db, session, game_slug, streak)
    already = set(
        db.scalars(select(AchievementRow.code).where(AchievementRow.child_id == child.id))
    )
    earned = []
    for achievement in newly_earned(snapshot, already):
        inserted = db.scalar(
            pg_insert(AchievementRow)
            .values(child_id=child.id, code=achievement.code, unlocked_at=session.completed_at)
            .on_conflict_do_nothing(index_elements=["child_id", "code"])
            .returning(AchievementRow.code)
        )
        if inserted is not None:  # not unlocked by a concurrent request
            earned.append(achievement)

    return CompletionRewards(
        streak_days=streak,
        new_achievements=earned,
        goals_achieved=refresh_goals(db, child, settings),
    )


def refresh_goals(db: Session, child: Child, settings: Settings) -> list[Goal]:
    """Recompute progress of active goals: completed sessions (in the goal's skill, if set)
    since the goal was created, up to the end of its due date. Returns goals newly achieved."""
    zone = child_zone(child, settings)
    achieved = []
    for goal in db.scalars(
        select(Goal).where(Goal.child_id == child.id, Goal.status == GoalStatus.ACTIVE)
    ):
        query = (
            select(func.count())
            .select_from(GameSession)
            .join(Game, Game.id == GameSession.game_id)
            .where(
                GameSession.child_id == child.id,
                GameSession.status == SessionStatus.COMPLETED,
                GameSession.completed_at >= goal.created_at,
            )
        )
        if goal.category is not None:
            query = query.where(Game.category == goal.category)
        if goal.due_date is not None:
            query = query.where(
                GameSession.completed_at < start_of_day(goal.due_date + timedelta(days=1), zone)
            )
        goal.current_value = db.scalar(query) or 0
        if goal.current_value >= goal.target_value:
            goal.status = GoalStatus.ACHIEVED
            achieved.append(goal)
    return achieved


def _add_daily_activity(db: Session, session: GameSession, day: date) -> None:
    seconds = session.duration_seconds or 0
    insert = pg_insert(DailyActivity).values(
        child_id=session.child_id,
        activity_date=day,
        sessions_completed=1,
        points_earned=session.points,
        seconds_practised=seconds,
    )
    db.execute(
        insert.on_conflict_do_update(
            index_elements=["child_id", "activity_date"],
            set_={
                "sessions_completed": DailyActivity.sessions_completed + 1,
                "points_earned": DailyActivity.points_earned + session.points,
                "seconds_practised": DailyActivity.seconds_practised + seconds,
            },
        )
    )


def _snapshot(db: Session, session: GameSession, game_slug: str, streak: int) -> ProgressSnapshot:
    completed = (
        GameSession.child_id == session.child_id,
        GameSession.status == SessionStatus.COMPLETED,
    )
    count, points = db.execute(
        select(func.count(), func.coalesce(func.sum(GameSession.points), 0)).where(*completed)
    ).one()
    games = db.scalars(
        select(Game.slug)
        .join(GameSession, GameSession.game_id == Game.id)
        .where(*completed)
        .distinct()
    ).all()
    max_level = db.scalar(
        select(func.max(SkillLevel.level)).where(SkillLevel.child_id == session.child_id)
    )
    return ProgressSnapshot(
        sessions_completed=count,
        total_points=points,
        current_streak=streak,
        max_level=max_level or 1,
        games_played=frozenset(games),
        game=game_slug,
        accuracy=session.accuracy or 0.0,
        level=session.level_at_start,
        leveled_up=(session.level_at_end or 0) > session.level_at_start,
    )

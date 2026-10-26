from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.core.config import Settings
from app.modules.games.definitions import REGISTRY
from app.modules.progress.achievements import CATALOGUE, ProgressSnapshot, newly_earned
from app.modules.progress.calendar import (
    current_streak,
    local_date,
    longest_streak,
    start_of_day,
)

KARACHI = ZoneInfo("Asia/Karachi")  # UTC+5
TODAY = date(2026, 10, 26)


def days_ago(*offsets: int) -> list[date]:
    return [TODAY - timedelta(days=n) for n in offsets]


# ---------------------------------------------------------------- local days


def test_local_dates_follow_the_childs_time_zone() -> None:
    late_evening = datetime(2026, 10, 25, 18, 30, tzinfo=UTC)  # 23:30 in Karachi
    after_midnight = datetime(2026, 10, 25, 19, 30, tzinfo=UTC)  # 00:30 next day in Karachi

    assert local_date(late_evening, KARACHI) == date(2026, 10, 25)
    assert local_date(after_midnight, KARACHI) == date(2026, 10, 26)


def test_start_of_day_is_local_midnight_in_utc() -> None:
    assert start_of_day(date(2026, 10, 26), KARACHI) == datetime(2026, 10, 25, 19, 0, tzinfo=UTC)


def test_unknown_default_time_zones_are_rejected() -> None:
    with pytest.raises(ValueError):
        Settings(_env_file=None, DEFAULT_TIMEZONE="Mars/Olympus_Mons")


# ---------------------------------------------------------------- streaks


@pytest.mark.parametrize(
    ("played", "expected"),
    [
        ([], 0),
        (days_ago(0), 1),
        (days_ago(0, 1, 2), 3),
        (days_ago(1, 2), 2),  # not played yet today: yesterday's streak is still alive
        (days_ago(2, 3), 0),  # missed yesterday
        (days_ago(0, 2, 3), 1),
    ],
)
def test_current_streak(played: list[date], expected: int) -> None:
    assert current_streak(played, TODAY) == expected


def test_longest_streak() -> None:
    assert longest_streak(days_ago(0, 1, 5, 6, 7, 8, 20)) == 4
    assert longest_streak([]) == 0


# ---------------------------------------------------------------- achievements

BASE = ProgressSnapshot(
    sessions_completed=1,
    total_points=0,
    current_streak=1,
    max_level=1,
    games_played=frozenset({"sound-detective"}),
    game="sound-detective",
    accuracy=50.0,
    level=1,
    leveled_up=False,
)


def codes(snapshot: ProgressSnapshot, already: set[str] | None = None) -> set[str]:
    return {a.code for a in newly_earned(snapshot, already or set())}


def test_catalogue_codes_are_unique() -> None:
    assert len({a.code for a in CATALOGUE}) == len(CATALOGUE)


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({}, "first_game"),
        ({"sessions_completed": 10}, "ten_games"),
        ({"sessions_completed": 50}, "fifty_games"),
        ({"accuracy": 100.0}, "perfect_game"),
        ({"leveled_up": True}, "level_up"),
        ({"max_level": 7}, "hard_level"),
        ({"current_streak": 3}, "streak_3"),
        ({"current_streak": 7}, "streak_7"),
        ({"current_streak": 30}, "streak_30"),
        ({"games_played": frozenset(REGISTRY)}, "explorer"),
        ({"total_points": 1000}, "points_1000"),
        ({"game": "listening-in-noise", "level": 7, "accuracy": 80.0}, "noise_champion"),
        ({"game": "speech-practice", "level": 4, "accuracy": 100.0}, "clear_speaker"),
    ],
)
def test_each_achievement_has_a_rule(changes: dict[str, object], code: str) -> None:
    assert code in codes(replace(BASE, **changes))  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"sessions_completed": 9}, "ten_games"),
        ({"accuracy": 99.9}, "perfect_game"),
        ({"current_streak": 2}, "streak_3"),
        ({"game": "listening-in-noise", "level": 6, "accuracy": 100.0}, "noise_champion"),
        ({"game": "speech-practice", "level": 3, "accuracy": 100.0}, "clear_speaker"),
    ],
)
def test_achievements_need_the_full_requirement(changes: dict[str, object], code: str) -> None:
    assert code not in codes(replace(BASE, **changes))  # type: ignore[arg-type]


def test_earned_achievements_are_not_awarded_again() -> None:
    assert "first_game" not in codes(BASE, already={"first_game"})

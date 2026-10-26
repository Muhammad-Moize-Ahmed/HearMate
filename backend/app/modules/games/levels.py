"""Levels 1-9 per child and skill category, grouped into three difficulty tiers."""

from ...db.models import Difficulty

MIN_LEVEL = 1
MAX_LEVEL = 9


def tier_for_level(level: int) -> Difficulty:
    if level <= 3:
        return Difficulty.EASY
    if level <= 6:
        return Difficulty.MEDIUM
    return Difficulty.HARD


def by_level[T](level: int, values: tuple[T, ...]) -> T:
    """Pick the value for `level` from a 9-entry table (one entry per level)."""
    assert len(values) == MAX_LEVEL  # noqa: S101 - programming error in a game table
    return values[min(max(level, MIN_LEVEL), MAX_LEVEL) - 1]

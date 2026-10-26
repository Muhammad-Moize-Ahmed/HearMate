"""Badges, defined in code and unlocked on the server when a session completes.

Rules only look at a snapshot of the child's own progress: no comparisons with other children.
"""

from collections.abc import Callable
from dataclasses import dataclass

from ..games.definitions import REGISTRY


@dataclass(frozen=True, slots=True)
class ProgressSnapshot:
    sessions_completed: int
    total_points: int
    current_streak: int
    max_level: int
    games_played: frozenset[str]
    # The session that just finished:
    game: str
    accuracy: float
    level: int
    leveled_up: bool


@dataclass(frozen=True, slots=True)
class Achievement:
    code: str
    title: str
    description: str
    icon: str
    earned: Callable[[ProgressSnapshot], bool]


CATALOGUE: tuple[Achievement, ...] = (
    Achievement("first_game", "First steps", "Finished your first game.", "sparkles",
                lambda s: s.sessions_completed >= 1),
    Achievement("ten_games", "Keep going", "Finished 10 games.", "medal",
                lambda s: s.sessions_completed >= 10),
    Achievement("fifty_games", "Super listener", "Finished 50 games.", "trophy",
                lambda s: s.sessions_completed >= 50),
    Achievement("perfect_game", "Perfect!", "Got every round right in a game.", "star",
                lambda s: s.accuracy >= 100),
    Achievement("level_up", "Level up!", "Moved up a level.", "arrow-up",
                lambda s: s.leveled_up),
    Achievement("hard_level", "Challenge accepted", "Reached a hard level (7+).", "mountain",
                lambda s: s.max_level >= 7),
    Achievement("streak_3", "Three in a row", "Played 3 days in a row.", "flame",
                lambda s: s.current_streak >= 3),
    Achievement("streak_7", "Week streak", "Played 7 days in a row.", "flame",
                lambda s: s.current_streak >= 7),
    Achievement("streak_30", "Month streak", "Played 30 days in a row.", "flame",
                lambda s: s.current_streak >= 30),
    Achievement("explorer", "Explorer", "Played every game at least once.", "compass",
                lambda s: set(REGISTRY) <= s.games_played),
    Achievement("points_1000", "1,000 points", "Earned 1,000 points.", "gem",
                lambda s: s.total_points >= 1000),
    Achievement("noise_champion", "Noise champion",
                "Scored 80% or more in Listening in Noise at a hard level.", "headphones",
                lambda s: s.game == "listening-in-noise" and s.level >= 7 and s.accuracy >= 80),
    Achievement("clear_speaker", "Clear speaker",
                "A perfect Speech Practice game at level 4 or above.", "mic",
                lambda s: s.game == "speech-practice" and s.level >= 4 and s.accuracy >= 100),
)  # fmt: skip

BY_CODE = {a.code: a for a in CATALOGUE}


def newly_earned(snapshot: ProgressSnapshot, already: set[str]) -> list[Achievement]:
    return [a for a in CATALOGUE if a.code not in already and a.earned(snapshot)]

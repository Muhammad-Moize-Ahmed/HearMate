"""Adaptive difficulty: decides a child's next level after each completed session.

Replaces the old app's ML model, which was trained on synthetic data. The rule is simple and
explainable to parents and in the project report:

* Look at the child's sessions **at their current level** in this skill category (up to the last 3).
* Level up when the latest session and the window average are both >= 80% accuracy, unless the
  child answered much slower than expected; then they stay to build fluency first.
* Level down when the latest session and the window average are both below 60%.
* Otherwise stay. At most one level change per session, always within 1..9.
"""

import statistics
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from .levels import MAX_LEVEL, MIN_LEVEL


@dataclass(frozen=True, slots=True)
class SessionPerformance:
    accuracy: float  # 0-100
    median_response_ms: int | None
    reference_response_ms: int  # the game's expected response time at that level


@dataclass(frozen=True, slots=True)
class LevelDecision:
    new_level: int
    reason: str


class DifficultyStrategy(Protocol):
    @property
    def window(self) -> int:
        """How many sessions at the current level the strategy looks at."""
        ...

    def decide(self, current_level: int, history: Sequence[SessionPerformance]) -> LevelDecision:
        """`history`: sessions at `current_level`, newest first, including the one just played."""
        ...


@dataclass(frozen=True, slots=True)
class RollingThresholdStrategy:
    up_at: float = 80.0
    down_below: float = 60.0
    window: int = 3
    slow_factor: float = 1.5

    def decide(self, current_level: int, history: Sequence[SessionPerformance]) -> LevelDecision:
        if not history:
            return LevelDecision(current_level, "No sessions yet.")
        latest = history[0]
        recent = history[: self.window]
        average = statistics.fmean(s.accuracy for s in recent)
        summary = f"{latest.accuracy:.0f}% this session, {average:.0f}% over the last {len(recent)}"

        if latest.accuracy >= self.up_at and average >= self.up_at:
            if self._too_slow(latest):
                return LevelDecision(
                    current_level, f"Accurate but slow ({summary}): practising speed at this level."
                )
            if current_level >= MAX_LEVEL:
                return LevelDecision(current_level, f"Top level reached ({summary}).")
            return LevelDecision(current_level + 1, f"Level up ({summary}).")

        if latest.accuracy < self.down_below and average < self.down_below:
            if current_level <= MIN_LEVEL:
                return LevelDecision(current_level, f"Keep practising ({summary}).")
            return LevelDecision(
                current_level - 1, f"Easier level to build confidence ({summary})."
            )

        return LevelDecision(current_level, f"Staying at this level ({summary}).")

    def _too_slow(self, session: SessionPerformance) -> bool:
        if session.median_response_ms is None:
            return False
        return session.median_response_ms > session.reference_response_ms * self.slow_factor


DEFAULT_STRATEGY: DifficultyStrategy = RollingThresholdStrategy()

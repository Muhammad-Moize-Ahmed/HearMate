"""Points and speech scoring. Everything here runs on the server; clients only send answers."""

from ...db.models import Difficulty

POINTS_PER_CORRECT = 10
TIER_MULTIPLIER = {Difficulty.EASY: 1, Difficulty.MEDIUM: 2, Difficulty.HARD: 3}
# A spoken attempt counts as correct at or above this similarity (0-100).
SPEECH_PASS_SCORE = 75.0


def session_points(correct: int, total: int, tier: Difficulty) -> int:
    multiplier = TIER_MULTIPLIER[tier]
    perfect_bonus = POINTS_PER_CORRECT if total > 0 and correct == total else 0
    return (correct * POINTS_PER_CORRECT + perfect_bonus) * multiplier


def accuracy_percent(correct: int, total: int) -> float:
    return round(100.0 * correct / total, 1) if total else 0.0

"""Points and speech scoring. Everything here runs on the server; clients only send answers."""

import difflib
import re

from ...db.models import Difficulty

POINTS_PER_CORRECT = 10
TIER_MULTIPLIER = {Difficulty.EASY: 1, Difficulty.MEDIUM: 2, Difficulty.HARD: 3}
# A spoken attempt counts as correct at or above this similarity (0-100).
SPEECH_PASS_SCORE = 75.0

_NON_WORD = re.compile(r"[^a-z0-9' ]+")


def session_points(correct: int, total: int, tier: Difficulty) -> int:
    multiplier = TIER_MULTIPLIER[tier]
    perfect_bonus = POINTS_PER_CORRECT if total > 0 and correct == total else 0
    return (correct * POINTS_PER_CORRECT + perfect_bonus) * multiplier


def accuracy_percent(correct: int, total: int) -> float:
    return round(100.0 * correct / total, 1) if total else 0.0


def normalize_speech(text: str) -> list[str]:
    return _NON_WORD.sub(" ", text.lower()).split()


def speech_similarity(expected: str, transcript: str) -> float:
    """0-100. Single words compare letters (forgiving small slips); sentences compare words."""
    want, got = normalize_speech(expected), normalize_speech(transcript)
    if not want or not got:
        return 0.0
    if len(want) == 1:
        # Best match among the words heard, so "um, cat" still scores well for "cat".
        ratio = max(difflib.SequenceMatcher(None, want[0], word).ratio() for word in got)
    else:
        ratio = difflib.SequenceMatcher(None, want, got).ratio()
    return round(100.0 * ratio, 1)

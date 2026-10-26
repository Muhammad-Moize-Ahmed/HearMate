from typing import Any

from ....core.schemas import InputModel
from ....db.models import Difficulty, SkillCategory
from ..levels import by_level
from .base import GameDefinition, RoundCheck, RoundContext, RoundSpec, SequenceAnswer, word_options

LENGTH = (2, 2, 3, 3, 4, 4, 5, 5, 6)
REFERENCE_MS = (5000, 5000, 6500, 6500, 8000, 8000, 9500, 9500, 11000)
EXTRA_OPTIONS = 2


class WordSequence(GameDefinition):
    """Auditory sequential memory: hear a list of words, then tap them in the same order."""

    slug = "word-sequence"
    title = "Word Sequence"
    description = "Listen to a few words, then tap them in the order you heard them."
    category = SkillCategory.MEMORY
    icon = "list-ordered"
    sort_order = 30
    answer_model = SequenceAnswer
    rounds_per_session = 6

    def build_rounds(self, ctx: RoundContext) -> list[RoundSpec]:
        tiers = (Difficulty.EASY,) if ctx.level <= 6 else (Difficulty.EASY, Difficulty.MEDIUM)
        pool = [w.text for w in ctx.bank.words_for(*tiers)]
        length = by_level(ctx.level, LENGTH)
        rounds = []
        for _ in range(self.rounds_per_session):
            picked = ctx.rng.sample(pool, length + EXTRA_OPTIONS)
            sequence = picked[:length]
            options = list(picked)
            ctx.rng.shuffle(options)
            rounds.append(
                RoundSpec(
                    prompt={
                        "instruction": "Tap the words in the order you heard them.",
                        "stimulus": {"type": "speech_sequence", "texts": sequence},
                        "options": word_options(options),
                        "noise": None,
                        "display_text": None,
                    },
                    expected={"sequence": sequence},
                )
            )
        return rounds

    def check(self, expected: dict[str, Any], answer: InputModel) -> RoundCheck:
        assert isinstance(answer, SequenceAnswer)  # noqa: S101 - validated by the service
        want: list[str] = expected["sequence"]
        in_place = sum(1 for a, b in zip(want, answer.sequence, strict=False) if a == b)
        return RoundCheck(
            is_correct=answer.sequence == want,
            score=round(100.0 * in_place / len(want), 1),
            feedback={"in_place": in_place, "length": len(want)},
        )

    def reference_response_ms(self, level: int) -> int:
        return by_level(level, REFERENCE_MS)

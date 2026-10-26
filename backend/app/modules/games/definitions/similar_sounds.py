from typing import Any

from ....core.schemas import InputModel
from ....db.models import SkillCategory
from ..levels import by_level, tier_for_level
from .base import (
    ChoiceAnswer,
    GameDefinition,
    RoundCheck,
    RoundContext,
    RoundSpec,
    check_choice,
    optional_noise,
    sample_cycle,
    word_options,
)

MAX_OPTIONS = (2, 2, 2, 3, 3, 3, 4, 4, 4)


class SimilarSounds(GameDefinition):
    """Minimal pairs: easy sets differ a lot, medium only in voicing, hard in vowels."""

    slug = "similar-sounds"
    title = "Similar Sounds"
    description = "Hear a word and pick it from words that sound almost the same."
    category = SkillCategory.LISTENING
    icon = "waves"
    sort_order = 20
    answer_model = ChoiceAnswer
    supports_noise = True

    def build_rounds(self, ctx: RoundContext) -> list[RoundSpec]:
        sets = ctx.bank.pair_sets_for(tier_for_level(ctx.level))
        max_options = by_level(ctx.level, MAX_OPTIONS)
        rounds = []
        for pair_set in sample_cycle(ctx.rng, sets, self.rounds_per_session):
            target = ctx.rng.choice(pair_set.words)
            others = [w for w in pair_set.words if w != target]
            ctx.rng.shuffle(others)
            options = [target, *others[: max_options - 1]]
            ctx.rng.shuffle(options)
            noise, snr = optional_noise(ctx, self.supports_noise)
            rounds.append(
                RoundSpec(
                    prompt={
                        "instruction": "Which word did you hear?",
                        "options": word_options(options),
                        "noise": noise,
                        "display_text": None,
                    },
                    stimulus={"type": "speech", "text": target},
                    expected={"choice": target, "contrast": pair_set.contrast},
                    noise_snr_db=snr,
                )
            )
        return rounds

    def check(self, expected: dict[str, Any], answer: InputModel) -> RoundCheck:
        result = check_choice(expected, answer)
        return RoundCheck(result.is_correct, result.score, {"contrast": expected["contrast"]})

    def reference_response_ms(self, level: int) -> int:
        return 5000

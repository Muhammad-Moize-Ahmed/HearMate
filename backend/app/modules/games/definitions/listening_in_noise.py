from typing import Any

from ....core.schemas import InputModel
from ....db.models import Difficulty, SkillCategory
from ..levels import by_level
from ..noise import NoiseKind
from .base import (
    ChoiceAnswer,
    GameDefinition,
    RoundCheck,
    RoundContext,
    RoundSpec,
    check_choice,
    noise_spec,
    sample_cycle,
    word_options,
)

# Signal-to-noise ratio in dB: lower means louder noise relative to the word.
SNR_DB = (20.0, 18.0, 15.0, 12.0, 10.0, 8.0, 6.0, 4.0, 2.0)
OPTIONS = (3, 3, 4, 4, 4, 4, 4, 4, 4)


class ListeningInNoise(GameDefinition):
    """The core APD skill: picking out speech against background noise."""

    slug = "listening-in-noise"
    title = "Listening in Noise"
    description = "Find the word you hear through background noise."
    category = SkillCategory.LISTENING
    icon = "volume"
    sort_order = 40
    answer_model = ChoiceAnswer
    always_noise = True

    def build_rounds(self, ctx: RoundContext) -> list[RoundSpec]:
        tiers = (Difficulty.EASY,) if ctx.level <= 3 else (Difficulty.EASY, Difficulty.MEDIUM)
        words = [w.text for w in ctx.bank.words_for(*tiers)]
        snr = by_level(ctx.level, SNR_DB)
        kind = NoiseKind.WHITE if ctx.level <= 3 else NoiseKind.PINK
        option_count = by_level(ctx.level, OPTIONS)
        rounds = []
        for target in sample_cycle(ctx.rng, words, self.rounds_per_session):
            distractors = ctx.rng.sample([w for w in words if w != target], option_count - 1)
            options = [target, *distractors]
            ctx.rng.shuffle(options)
            rounds.append(
                RoundSpec(
                    prompt={
                        "instruction": "Which word did you hear?",
                        "stimulus": {"type": "speech", "text": target},
                        "options": word_options(options),
                        "noise": noise_spec(kind, snr, ctx.api_prefix),
                        "display_text": None,
                    },
                    expected={"choice": target},
                    noise_snr_db=snr,
                )
            )
        return rounds

    def check(self, expected: dict[str, Any], answer: InputModel) -> RoundCheck:
        return check_choice(expected, answer)

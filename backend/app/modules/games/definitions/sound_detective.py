from typing import Any

from ....core.schemas import InputModel
from ....db.models import SkillCategory
from ..levels import by_level
from .base import (
    ChoiceAnswer,
    GameDefinition,
    RoundCheck,
    RoundContext,
    RoundSpec,
    check_choice,
    optional_noise,
    sample_cycle,
)

OPTIONS = (2, 3, 3, 4, 4, 4, 5, 5, 6)
# From level 5 the wrong answers come from the same family (e.g. all animals), which is harder.
SAME_CATEGORY = (False, False, False, False, True, True, True, True, True)


class SoundDetective(GameDefinition):
    slug = "sound-detective"
    title = "Sound Detective"
    description = "Listen to an everyday sound and find what made it."
    category = SkillCategory.LISTENING
    icon = "ear"
    sort_order = 10
    answer_model = ChoiceAnswer
    supports_noise = True
    option_kind = "sounds"

    def build_rounds(self, ctx: RoundContext) -> list[RoundSpec]:
        sounds = ctx.bank.sounds
        option_count = by_level(ctx.level, OPTIONS)
        same_category = by_level(ctx.level, SAME_CATEGORY)
        rounds = []
        for target in sample_cycle(ctx.rng, sounds, self.rounds_per_session):
            others = [s for s in sounds if s.id != target.id]
            same = [s for s in others if s.category == target.category]
            rest = [s for s in others if s.category != target.category]
            ctx.rng.shuffle(same)
            ctx.rng.shuffle(rest)
            pool = same + rest if same_category else rest + same
            options = [target, *pool[: option_count - 1]]
            ctx.rng.shuffle(options)
            noise, snr = optional_noise(ctx, self.supports_noise)
            rounds.append(
                RoundSpec(
                    prompt={
                        "instruction": "Which sound did you hear?",
                        "options": [{"id": s.id, "label": s.label} for s in options],
                        "noise": noise,
                        "display_text": None,
                    },
                    stimulus={"type": "sound", "sound_id": target.id},
                    expected={"choice": target.id},
                    noise_snr_db=snr,
                )
            )
        return rounds

    def check(self, expected: dict[str, Any], answer: InputModel) -> RoundCheck:
        return check_choice(expected, answer)

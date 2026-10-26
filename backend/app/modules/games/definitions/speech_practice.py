from typing import Any

from ....core.schemas import InputModel
from ....db.models import Difficulty, SkillCategory
from ..scoring import SPEECH_PASS_SCORE, speech_similarity
from .base import GameDefinition, RoundCheck, RoundContext, RoundSpec, SpeechAnswer, sample_cycle


class SpeechPractice(GameDefinition):
    """Repeat a word or sentence. Levels 1-3: short words, 4-6: longer words, 7-9: sentences.

    The answer is a transcript: from the browser's speech recognition for now, and from the
    server's speech-to-text in Phase 5. Both are scored by the same function.
    """

    slug = "speech-practice"
    title = "Speech Practice"
    description = "Listen, then say the word or sentence out loud."
    category = SkillCategory.SPEECH
    icon = "mic"
    sort_order = 50
    answer_model = SpeechAnswer
    rounds_per_session = 6
    requires_microphone = True

    def build_rounds(self, ctx: RoundContext) -> list[RoundSpec]:
        if ctx.level <= 3:
            items = [w.text for w in ctx.bank.words_for(Difficulty.EASY)]
        elif ctx.level <= 6:
            items = [w.text for w in ctx.bank.words_for(Difficulty.MEDIUM)]
        else:
            items = [s.text for s in ctx.bank.sentences]
        return [
            RoundSpec(
                prompt={
                    "instruction": "Listen, then say it out loud.",
                    "stimulus": {"type": "speech", "text": text},
                    "options": [],
                    "noise": None,
                    "display_text": text,
                },
                expected={"text": text},
            )
            for text in sample_cycle(ctx.rng, items, self.rounds_per_session)
        ]

    def check(self, expected: dict[str, Any], answer: InputModel) -> RoundCheck:
        assert isinstance(answer, SpeechAnswer)  # noqa: S101 - validated by the service
        score = speech_similarity(expected["text"], answer.transcript)
        return RoundCheck(
            is_correct=score >= SPEECH_PASS_SCORE,
            score=score,
            feedback={"score": score, "heard": answer.transcript},
        )

    def reference_response_ms(self, level: int) -> int:
        return 8000

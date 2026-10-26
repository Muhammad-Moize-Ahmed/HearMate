from typing import Any

from ....core.schemas import InputModel
from ....db.models import Difficulty, SkillCategory
from ..pronunciation import score_pronunciation
from ..scoring import SPEECH_PASS_SCORE
from .base import GameDefinition, RoundCheck, RoundContext, RoundSpec, SpeechAnswer, sample_cycle


class SpeechPractice(GameDefinition):
    """Repeat a word or sentence. Levels 1-3: short words, 4-6: longer words, 7-9: sentences.

    Answers are transcripts, normally from the server's speech-to-text (audio upload); a
    browser transcript is accepted as a fallback. Both are scored word by word and sound by sound.
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
                    "options": [],
                    "noise": None,
                    "display_text": text,
                },
                stimulus={"type": "speech", "text": text},
                expected={"text": text},
            )
            for text in sample_cycle(ctx.rng, items, self.rounds_per_session)
        ]

    def check(self, expected: dict[str, Any], answer: InputModel) -> RoundCheck:
        assert isinstance(answer, SpeechAnswer)  # noqa: S101 - validated by the service
        result = score_pronunciation(expected["text"], answer.transcript)
        return RoundCheck(
            is_correct=result.score >= SPEECH_PASS_SCORE,
            score=result.score,
            feedback={
                "score": result.score,
                "heard": answer.transcript,
                "words": [
                    {
                        "expected": w.expected,
                        "heard": w.heard,
                        "score": w.score,
                        "missed_sounds": w.missed_sounds,
                    }
                    for w in result.words
                ],
                "practise_sounds": result.practise_sounds,
            },
        )

    def reference_response_ms(self, level: int) -> int:
        return 8000

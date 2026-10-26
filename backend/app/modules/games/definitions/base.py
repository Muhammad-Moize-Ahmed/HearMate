"""The contract every game implements, plus shared helpers.

Round prompts all have the same outer shape so the player UI can be generic:

    {"instruction": str,
     "stimulus": {"type": "sound", "sound_id": ...}
               | {"type": "speech", "text": ...}
               | {"type": "speech_sequence", "texts": [...]},
     "options": [{"id": ..., "label": ...}],        # empty for speech games
     "noise": {"kind", "snr_db", "url"} | None,
     "display_text": str | None}                    # text shown on screen (speech practice)

Until Phase 5 serves stimulus audio from the server, "speech" stimuli carry the text for the
browser to speak. Scoring still happens only on the server.
"""

import random
from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Annotated, Any, ClassVar

from pydantic import Field, StringConstraints

from ....core.schemas import InputModel
from ....db.models import SkillCategory
from ..content import ContentBank
from ..levels import tier_for_level
from ..noise import TIER_SNR_DB, NoiseKind, noise_url

Token = Annotated[str, StringConstraints(min_length=1, max_length=64)]


class ChoiceAnswer(InputModel):
    choice: Token


class SequenceAnswer(InputModel):
    sequence: list[Token] = Field(max_length=10)


class SpeechAnswer(InputModel):
    transcript: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


@dataclass(frozen=True, slots=True)
class RoundContext:
    level: int
    rng: random.Random
    bank: ContentBank
    with_noise: bool
    api_prefix: str = "/api"


@dataclass(frozen=True, slots=True)
class RoundSpec:
    prompt: dict[str, Any]
    expected: dict[str, Any]
    noise_snr_db: float | None = None


@dataclass(frozen=True, slots=True)
class RoundCheck:
    is_correct: bool
    score: float  # 0-100 for this round
    feedback: dict[str, Any] = field(default_factory=dict)


class GameDefinition(ABC):
    slug: ClassVar[str]
    title: ClassVar[str]
    description: ClassVar[str]
    category: ClassVar[SkillCategory]
    icon: ClassVar[str]
    sort_order: ClassVar[int]
    answer_model: ClassVar[type[InputModel]]
    rounds_per_session: ClassVar[int] = 8
    requires_microphone: ClassVar[bool] = False
    supports_noise: ClassVar[bool] = False  # may be played "with noise" on request
    always_noise: ClassVar[bool] = False  # noise is the point of the game

    @abstractmethod
    def build_rounds(self, ctx: RoundContext) -> list[RoundSpec]: ...

    @abstractmethod
    def check(self, expected: dict[str, Any], answer: InputModel) -> RoundCheck: ...

    def reference_response_ms(self, level: int) -> int:
        """How long a typical child takes per round at this level (for the 'too slow' rule)."""
        return 6000


def sample_cycle[T](rng: random.Random, items: Sequence[T], count: int) -> list[T]:
    """`count` items without repeats until the pool runs out, then reshuffle and continue."""
    out: list[T] = []
    while len(out) < count:
        batch = list(items)
        rng.shuffle(batch)
        out.extend(batch[: count - len(out)])
    return out


def optional_noise(
    ctx: RoundContext, supports_noise: bool
) -> tuple[dict[str, Any] | None, float | None]:
    """Noise for games that offer it as an option, at the tier's SNR."""
    if not (supports_noise and ctx.with_noise):
        return None, None
    snr = TIER_SNR_DB[tier_for_level(ctx.level)]
    return noise_spec(NoiseKind.PINK, snr, ctx.api_prefix), snr


def noise_spec(kind: NoiseKind, snr_db: float, api_prefix: str) -> dict[str, Any]:
    return {"kind": kind.value, "snr_db": snr_db, "url": noise_url(kind, api_prefix)}


def word_options(words: Sequence[str]) -> list[dict[str, str]]:
    return [{"id": w, "label": w} for w in words]


def check_choice(expected: dict[str, Any], answer: InputModel) -> RoundCheck:
    assert isinstance(answer, ChoiceAnswer)  # noqa: S101 - validated by the service
    correct = answer.choice == expected["choice"]
    return RoundCheck(is_correct=correct, score=100.0 if correct else 0.0)

"""The curated, versioned content bank (content/bank.json), validated when first loaded.

Rounds store a full copy of the item they used, so editing the bank never changes past sessions.
"""

from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal, Self

from pydantic import BaseModel, Field, StringConstraints, model_validator

from ...db.models import Difficulty

BANK_PATH = Path(__file__).parent / "content" / "bank.json"

SoundCategory = Literal["animals", "vehicles", "household", "nature", "instruments"]
# A picture shown on an answer option: one emoji (pre-2020 only; see tests/test_pictures.py).
Emoji = Annotated[str, StringConstraints(min_length=1, max_length=8)]
# What a game's options are, which decides where their pictures come from.
OptionKind = Literal["words", "sounds"]


class Sound(BaseModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    label: str
    category: SoundCategory
    emoji: Emoji | None = None


class Word(BaseModel):
    text: str = Field(pattern=r"^[a-z]+$")
    tier: Difficulty


class MinimalPairSet(BaseModel):
    words: list[str] = Field(min_length=2, max_length=4)
    contrast: str
    tier: Difficulty


class Sentence(BaseModel):
    text: str = Field(min_length=3, max_length=120)


class ContentBank(BaseModel):
    version: int = Field(ge=1)
    sounds: list[Sound]
    words: list[Word]
    minimal_pair_sets: list[MinimalPairSet]
    sentences: list[Sentence]
    # Word -> picture, for words and minimal-pair words alike. A word without one has no picture.
    pictures: dict[str, Emoji] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        for name, keys in (
            ("sound ids", [s.id for s in self.sounds]),
            ("words", [w.text for w in self.words]),
        ):
            if len(keys) != len(set(keys)):
                raise ValueError(f"duplicate {name} in content bank")
        for pair_set in self.minimal_pair_sets:
            if len(set(pair_set.words)) != len(pair_set.words):
                raise ValueError(f"repeated word in minimal pair set {pair_set.words}")
        for tier in Difficulty:
            if not any(w.tier is tier for w in self.words) and tier is not Difficulty.HARD:
                raise ValueError(f"no {tier} words in content bank")
            if not any(p.tier is tier for p in self.minimal_pair_sets):
                raise ValueError(f"no {tier} minimal pair sets in content bank")
        known = {w.text for w in self.words} | {w for p in self.minimal_pair_sets for w in p.words}
        if unknown := sorted(set(self.pictures) - known):
            raise ValueError(f"pictures for words not in the content bank: {unknown}")
        return self

    def pictures_for(self, kind: OptionKind) -> Mapping[str, str]:
        """Option id -> picture: sound ids for sound options, the word itself for word options."""
        if kind == "sounds":
            return {s.id: s.emoji for s in self.sounds if s.emoji}
        return self.pictures

    def words_for(self, *tiers: Difficulty) -> list[Word]:
        return [w for w in self.words if w.tier in tiers]

    def pair_sets_for(self, tier: Difficulty) -> list[MinimalPairSet]:
        return [p for p in self.minimal_pair_sets if p.tier is tier]


@lru_cache
def load_bank() -> ContentBank:
    return ContentBank.model_validate_json(BANK_PATH.read_text(encoding="utf-8"))

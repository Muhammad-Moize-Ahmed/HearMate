"""The curated, versioned content bank (content/bank.json), validated when first loaded.

Rounds store a full copy of the item they used, so editing the bank never changes past sessions.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import BaseModel, Field, model_validator

from ...db.models import Difficulty

BANK_PATH = Path(__file__).parent / "content" / "bank.json"

SoundCategory = Literal["animals", "vehicles", "household", "nature", "instruments"]


class Sound(BaseModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    label: str
    category: SoundCategory


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
        return self

    def words_for(self, *tiers: Difficulty) -> list[Word]:
        return [w for w in self.words if w.tier in tiers]

    def pair_sets_for(self, tier: Difficulty) -> list[MinimalPairSet]:
        return [p for p in self.minimal_pair_sets if p.tier is tier]


@lru_cache
def load_bank() -> ContentBank:
    return ContentBank.model_validate_json(BANK_PATH.read_text(encoding="utf-8"))

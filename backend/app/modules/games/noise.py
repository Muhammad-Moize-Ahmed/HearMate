"""Background noise for listening-in-noise rounds, mixed into the stimulus on the server."""

from enum import StrEnum
from functools import lru_cache

import numpy as np

from ...db.models import Difficulty
from ...providers.speech.audio import SAMPLE_RATE, Samples, normalized

# Signal-to-noise ratio (dB) per tier when a game is played "with noise" (old app's values).
TIER_SNR_DB = {Difficulty.EASY: 20.0, Difficulty.MEDIUM: 12.0, Difficulty.HARD: 8.0}


class NoiseKind(StrEnum):
    WHITE = "white"
    PINK = "pink"


@lru_cache
def noise_samples(kind: NoiseKind, seconds: float = 4.0, seed: int = 7) -> Samples:
    """A deterministic noise loop at -20 dBFS, 16 kHz mono."""
    rng = np.random.default_rng(seed)
    white = rng.standard_normal(int(seconds * SAMPLE_RATE))
    samples = _pink(white) if kind is NoiseKind.PINK else white
    return normalized(samples.astype(np.float32))


def _pink(white: np.ndarray) -> np.ndarray:
    """Paul Kellet's pink-noise filter (about -3 dB per octave)."""
    b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0
    out = np.empty_like(white)
    for i, w in enumerate(white):
        b0 = 0.99886 * b0 + w * 0.0555179
        b1 = 0.99332 * b1 + w * 0.0750759
        b2 = 0.96900 * b2 + w * 0.1538520
        b3 = 0.86650 * b3 + w * 0.3104856
        b4 = 0.55000 * b4 + w * 0.5329522
        b5 = -0.7616 * b5 - w * 0.0168980
        out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
        b6 = w * 0.115926
    return out

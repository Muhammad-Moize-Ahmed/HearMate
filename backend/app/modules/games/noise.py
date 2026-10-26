"""Background noise for listening-in-noise rounds, generated with the standard library.

Rounds carry `{"kind", "snr_db", "url"}`. The player normalises the speech or sound to the same
RMS level as this noise (-20 dBFS) and plays the noise at gain 10 ** (-snr_db / 20), which gives
the requested signal-to-noise ratio. (Server-side mixing arrives with server TTS in Phase 5.)
"""

import array
import io
import math
import random
import wave
from enum import StrEnum
from functools import lru_cache

from ...db.models import Difficulty

SAMPLE_RATE = 16_000
TARGET_RMS = 0.1  # -20 dBFS

# Signal-to-noise ratio (dB) per tier when a game is played "with noise" (old app's values).
TIER_SNR_DB = {Difficulty.EASY: 20.0, Difficulty.MEDIUM: 12.0, Difficulty.HARD: 8.0}


class NoiseKind(StrEnum):
    WHITE = "white"
    PINK = "pink"


def noise_url(kind: NoiseKind, api_prefix: str = "/api") -> str:
    return f"{api_prefix}/audio/noise/{kind.value}.wav"


@lru_cache
def noise_wav(kind: NoiseKind, seconds: float = 4.0, seed: int = 7) -> bytes:
    """A seamless-enough mono 16-bit WAV loop, deterministic for a given seed."""
    rng = random.Random(seed)  # noqa: S311 - audio noise, not security
    samples = [rng.gauss(0.0, 1.0) for _ in range(int(seconds * SAMPLE_RATE))]
    if kind is NoiseKind.PINK:
        samples = _pink(samples)

    rms = math.sqrt(sum(s * s for s in samples) / len(samples))
    scale = TARGET_RMS / rms if rms else 0.0
    pcm = array.array("h", (int(max(-1.0, min(1.0, s * scale)) * 32767) for s in samples))

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm.tobytes())
    return buffer.getvalue()


def _pink(white: list[float]) -> list[float]:
    """Paul Kellet's pink-noise filter (about -3 dB per octave)."""
    b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0
    out = []
    for w in white:
        b0 = 0.99886 * b0 + w * 0.0555179
        b1 = 0.99332 * b1 + w * 0.0750759
        b2 = 0.96900 * b2 + w * 0.1538520
        b3 = 0.86650 * b3 + w * 0.3104856
        b4 = 0.55000 * b4 + w * 0.5329522
        b5 = -0.7616 * b5 - w * 0.0168980
        out.append(b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362)
        b6 = w * 0.115926
    return out

"""Renders a round's stimulus to WAV on the server: speech via TTS, sound effects from files,
with background noise mixed in at the round's signal-to-noise ratio."""

from http import HTTPStatus
from pathlib import Path
from typing import Any

from ...core.errors import AppError
from ...providers.speech import AudioClip, SpeechServices
from ...providers.speech.audio import concat, mix_with_noise, to_wav
from .noise import NoiseKind, noise_samples
from .sounds import sound_library

SEQUENCE_GAP_MS = 700


class SoundUnavailableError(AppError):
    status_code = HTTPStatus.SERVICE_UNAVAILABLE
    code = "sound_unavailable"


def render_stimulus(
    content: dict[str, Any],
    noise: dict[str, Any] | None,
    speech: SpeechServices,
    sounds_dir: Path | None,
) -> bytes:
    match content["type"]:
        case "speech":
            clip = speech.speak(content["text"])
        case "speech_sequence":
            clip = concat([speech.speak(t) for t in content["texts"]], gap_ms=SEQUENCE_GAP_MS)
        case "sound":
            clip = _sound(content["sound_id"], sounds_dir)
        case other:
            raise ValueError(f"unknown stimulus type {other!r}")

    if noise is not None:
        clip = mix_with_noise(clip, noise_samples(NoiseKind(noise["kind"])), noise["snr_db"])
    return to_wav(clip)


def _sound(sound_id: str, sounds_dir: Path | None) -> AudioClip:
    clip = sound_library(sounds_dir).clip(sound_id) if sounds_dir is not None else None
    if clip is not None:
        return clip
    # Also for a file that can't be decoded (logged when it was tried): the round says the sound
    # isn't ready instead of failing. Never for a long file: those are trimmed.
    raise SoundUnavailableError(
        "This sound isn't available yet (see SOUNDS_DIR; `python -m app.cli check-sounds`)"
    )

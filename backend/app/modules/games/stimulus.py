"""Renders a round's stimulus to WAV on the server: speech via TTS, sound effects from files,
with background noise mixed in at the round's signal-to-noise ratio."""

from http import HTTPStatus
from pathlib import Path
from typing import Any

from ...core.errors import AppError
from ...providers.speech import AudioClip, SpeechServices
from ...providers.speech.audio import concat, decode, mix_with_noise, to_wav
from .noise import NoiseKind, noise_samples

SEQUENCE_GAP_MS = 700
SOUND_EXTENSIONS = (".wav", ".mp3", ".ogg")
MAX_SOUND_SECONDS = 20.0


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
    if sounds_dir is not None:
        for extension in SOUND_EXTENSIONS:
            path = sounds_dir.expanduser() / f"{sound_id}{extension}"
            if path.is_file():
                return decode(path.read_bytes(), max_seconds=MAX_SOUND_SECONDS)
    raise SoundUnavailableError("This sound isn't installed yet (see SOUNDS_DIR)")

"""Audio decoding (via ffmpeg), WAV encoding and noise mixing. Everything is 16 kHz mono float32."""

import io
import shutil
import subprocess
import wave
from collections.abc import Sequence
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path

import numpy as np
import numpy.typing as npt

from ...core.errors import AppError

SAMPLE_RATE = 16_000
TARGET_RMS = 0.1  # -20 dBFS: speech and noise are levelled here before mixing
# Containers browsers record in (webm/ogg/mp4) plus common files. Matched against ffmpeg demuxers.
ALLOWED_DEMUXERS = "matroska,webm,ogg,wav,mov,mp4,m4a,mp3,aac"
FFMPEG_TIMEOUT_SECONDS = 20

Samples = npt.NDArray[np.float32]


class InvalidAudioError(AppError):
    status_code = HTTPStatus.UNPROCESSABLE_ENTITY
    code = "invalid_audio"


class SpeechUnavailableError(AppError):
    status_code = HTTPStatus.SERVICE_UNAVAILABLE
    code = "speech_unavailable"


class AudioFileError(Exception):
    """A local file (e.g. in SOUNDS_DIR) that ffmpeg can't turn into audio. Deliberately not an
    AppError: it is reported to the operator, never sent to a client like an upload error."""


@dataclass(frozen=True, slots=True)
class AudioClip:
    samples: Samples

    @property
    def duration_ms(self) -> int:
        return round(1000 * len(self.samples) / SAMPLE_RATE)


def decode(data: bytes, *, max_seconds: float) -> AudioClip:
    """Any allowed audio container -> 16 kHz mono. Rejects empty, unreadable or too-long audio."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise SpeechUnavailableError("Audio processing is not available (ffmpeg not installed)")
    command = [
        ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        # Only read from stdin: a crafted file (e.g. a playlist) can't make ffmpeg fetch URLs.
        "-protocol_whitelist",
        "pipe",
        "-format_whitelist",
        ALLOWED_DEMUXERS,
        "-i",
        "pipe:0",
        # Decode a little past the limit so "too long" can be detected without decoding it all.
        "-t",
        f"{max_seconds + 0.5:.2f}",
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-f",
        "s16le",
        "pipe:1",
    ]
    try:
        result = subprocess.run(  # noqa: S603 - fixed argument list, no shell
            command, input=data, capture_output=True, timeout=FFMPEG_TIMEOUT_SECONDS, check=False
        )
    except subprocess.TimeoutExpired as exc:
        raise InvalidAudioError("The audio took too long to process") from exc
    if result.returncode != 0:
        raise InvalidAudioError("The audio couldn't be read. Try recording again.")

    samples = np.frombuffer(result.stdout, dtype="<i2").astype(np.float32) / 32768.0
    clip = AudioClip(samples)
    if clip.duration_ms == 0:
        raise InvalidAudioError("The recording is empty", code="empty_audio")
    if clip.duration_ms > max_seconds * 1000:
        raise InvalidAudioError(
            f"Recordings can be at most {max_seconds:g} seconds", code="audio_too_long"
        )
    return clip


def decode_file(path: Path, *, max_seconds: float, silence_db: float = -50.0) -> AudioClip:
    """Any file ffmpeg can decode -> 16 kHz mono 16-bit, without its leading silence (anything
    quieter than `silence_db`, keeping 100 ms before the sound starts), cut to `max_seconds`.

    For trusted local files (SOUNDS_DIR); uploads go through `decode`, which rejects long audio
    instead. `-t` is an output option, so ffmpeg stops reading once it has `max_seconds` of
    output: a 6-minute file costs no more than a short one. Raises AudioFileError.
    """
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise SpeechUnavailableError("Audio processing is not available (ffmpeg not installed)")
    command = [
        ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        # Local files only: a playlist can't make ffmpeg fetch URLs.
        "-protocol_whitelist",
        "file",
        "-i",
        f"file:{path}",
        "-vn",
        "-af",
        "silenceremove=start_periods=1:start_silence=0.1:detection=peak"
        f":start_threshold={silence_db:g}dB",
        "-t",
        f"{max_seconds:g}",
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-f",
        "s16le",
        "pipe:1",
    ]
    try:
        result = subprocess.run(  # noqa: S603 - fixed argument list, no shell
            command, capture_output=True, timeout=FFMPEG_TIMEOUT_SECONDS, check=False
        )
    except subprocess.TimeoutExpired as exc:
        raise AudioFileError(f"ffmpeg took over {FFMPEG_TIMEOUT_SECONDS} s") from exc
    if result.returncode != 0:
        errors = result.stderr.decode(errors="replace").strip().splitlines()
        raise AudioFileError(errors[-1] if errors else f"ffmpeg exited {result.returncode}")

    samples = np.frombuffer(result.stdout, dtype="<i2").astype(np.float32) / 32768.0
    if len(samples) == 0:
        raise AudioFileError("no audio (empty, or silent throughout)")
    return AudioClip(samples)


def fade_out(clip: AudioClip, ms: int) -> AudioClip:
    """Ramp the last `ms` down to silence, so a clip cut mid-sound doesn't end in a click."""
    n = min(len(clip.samples), SAMPLE_RATE * ms // 1000)
    samples = clip.samples.copy()
    samples[len(samples) - n :] *= np.linspace(1.0, 0.0, n, dtype=np.float32)
    return AudioClip(samples)


def read_wav(data: bytes) -> AudioClip:
    """Read a 16 kHz mono 16-bit WAV produced by `to_wav` (no ffmpeg needed)."""
    with wave.open(io.BytesIO(data)) as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, SAMPLE_RATE):
            raise ValueError("expected 16 kHz mono 16-bit WAV")
        frames = wav.readframes(wav.getnframes())
    return AudioClip(np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0)


def to_wav(clip: AudioClip) -> bytes:
    pcm = (np.clip(clip.samples, -1.0, 1.0) * 32767).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm.tobytes())
    return buffer.getvalue()


def rms(samples: Samples) -> float:
    return float(np.sqrt(np.mean(np.square(samples)))) if len(samples) else 0.0


def normalized(samples: Samples, target_rms: float = TARGET_RMS) -> Samples:
    level = rms(samples)
    return (samples * (target_rms / level)).astype(np.float32) if level > 0 else samples


def silence(ms: int) -> AudioClip:
    return AudioClip(np.zeros(SAMPLE_RATE * ms // 1000, dtype=np.float32))


def concat(clips: Sequence[AudioClip], *, gap_ms: int) -> AudioClip:
    gap = silence(gap_ms).samples
    parts: list[Samples] = []
    for i, clip in enumerate(clips):
        if i:
            parts.append(gap)
        parts.append(clip.samples)
    return AudioClip(np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32))


def mix_with_noise(
    signal: AudioClip, noise: Samples, snr_db: float, *, padding_ms: int = 400
) -> AudioClip:
    """Signal at -20 dBFS with noise underneath at the requested signal-to-noise ratio.

    The noise starts a little before and ends a little after the signal, as in real life.
    """
    pad = np.zeros(SAMPLE_RATE * padding_ms // 1000, dtype=np.float32)
    voice = np.concatenate([pad, normalized(signal.samples), pad])
    reps = int(np.ceil(len(voice) / len(noise)))
    bed = normalized(np.tile(noise, reps)[: len(voice)], TARGET_RMS * 10 ** (-snr_db / 20))
    mixed = voice + bed
    peak = float(np.max(np.abs(mixed))) if len(mixed) else 0.0
    if peak > 0.99:  # keep the ratio, avoid clipping
        mixed = mixed * (0.99 / peak)
    return AudioClip(mixed.astype(np.float32))

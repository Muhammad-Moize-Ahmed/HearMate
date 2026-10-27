"""Audio decoding (real ffmpeg), WAV round trips and noise mixing."""

import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from app.modules.games.noise import NoiseKind, noise_samples
from app.providers.speech.audio import (
    SAMPLE_RATE,
    AudioClip,
    InvalidAudioError,
    concat,
    decode,
    mix_with_noise,
    read_wav,
    rms,
    to_wav,
)
from tests.fakes import tone_wav

pytestmark = pytest.mark.usefixtures("ffmpeg")  # skips locally, fails in CI


def encode(tmp_path: Path, extension: str, codec: str, seconds: float = 1.0) -> bytes:
    out = tmp_path / f"clip.{extension}"
    ffmpeg = shutil.which("ffmpeg")
    assert ffmpeg is not None
    subprocess.run(  # noqa: S603 - test helper with fixed arguments
        [
            ffmpeg, "-loglevel", "error", "-f", "lavfi",
            "-i", f"sine=frequency=440:duration={seconds}", "-c:a", codec, str(out), "-y",
        ],
        check=True,
    )  # fmt: skip
    return out.read_bytes()


@pytest.mark.parametrize(
    ("extension", "codec"),
    [
        ("webm", "libopus"),
        ("ogg", "libopus"),
        ("m4a", "aac"),
        ("wav", "pcm_s16le"),
        ("mp3", "libmp3lame"),
    ],
)
def test_browser_and_file_formats_decode_to_16k_mono(
    tmp_path: Path, extension: str, codec: str
) -> None:
    clip = decode(encode(tmp_path, extension, codec), max_seconds=15)

    assert 950 <= clip.duration_ms <= 1100
    assert clip.samples.dtype == np.float32


def test_playlists_and_garbage_are_rejected() -> None:
    playlist = b"#EXTM3U\n#EXTINF:1,\nhttp://example.invalid/clip.wav\n"

    for data in (playlist, b"not audio at all", b""):
        with pytest.raises(InvalidAudioError):
            decode(data, max_seconds=15)


def test_recordings_over_the_limit_are_rejected(tmp_path: Path) -> None:
    with pytest.raises(InvalidAudioError) as excinfo:
        decode(encode(tmp_path, "wav", "pcm_s16le", seconds=3), max_seconds=2)

    assert excinfo.value.code == "audio_too_long"


def test_wav_round_trip() -> None:
    clip = read_wav(tone_wav(seconds=0.5))

    assert clip.duration_ms == 500
    assert read_wav(to_wav(clip)).samples == pytest.approx(clip.samples, abs=1e-4)


def test_concat_inserts_gaps() -> None:
    one = AudioClip(np.ones(SAMPLE_RATE // 2, dtype=np.float32))

    assert concat([one, one], gap_ms=700).duration_ms == 500 + 700 + 500


@pytest.mark.parametrize("snr_db", [20.0, 8.0, 2.0])
def test_noise_is_mixed_at_the_requested_snr(snr_db: float) -> None:
    signal = read_wav(tone_wav(seconds=1.0))
    noise = noise_samples(NoiseKind.WHITE)

    mixed = mix_with_noise(signal, noise, snr_db, padding_ms=400).samples

    pad = SAMPLE_RATE * 400 // 1000
    noise_only = mixed[:pad]  # the lead-in is noise alone
    signal_and_noise = mixed[pad:-pad]
    noise_rms = rms(noise_only)
    signal_rms = float(np.sqrt(max(rms(signal_and_noise) ** 2 - noise_rms**2, 0.0)))
    measured = 20 * np.log10(signal_rms / noise_rms)
    assert measured == pytest.approx(snr_db, abs=1.0)
    assert float(np.max(np.abs(mixed))) <= 1.0

"""ffmpeg for the audio tests: skipped locally when it's missing, but a failure in CI.
Also generates test sound files, so no real recordings are needed.

CI sets HEARMATE_REQUIRE_FFMPEG=1, so a broken install can't silently drop the audio tests.
"""

import os
import shutil
import subprocess
from collections.abc import Callable, Mapping
from pathlib import Path

import pytest

REQUIRE_ENV = "HEARMATE_REQUIRE_FFMPEG"


def find_ffmpeg(
    which: Callable[[str], str | None] = shutil.which,
    env: Mapping[str, str] = os.environ,
) -> str:
    """ffmpeg's path; otherwise fail the test if REQUIRE_ENV is "1", or skip it."""
    path = which("ffmpeg")
    if path is not None:
        return path
    if env.get(REQUIRE_ENV) == "1":
        pytest.fail(
            f"ffmpeg not found on PATH, but {REQUIRE_ENV}=1 says these tests must run. "
            "Install ffmpeg (CI: the 'Install ffmpeg' step).",
            pytrace=False,
        )
    pytest.skip(f"needs ffmpeg (set {REQUIRE_ENV}=1 to fail instead of skipping)")


def make_sound(
    path: Path,
    codec: str,
    *,
    seconds: float = 1.0,
    rate: int = 44_100,
    channels: int = 1,
    leading_silence: float = 0.0,
) -> Path:
    """A 440 Hz tone (after `leading_silence` seconds of digital silence) in any codec."""
    ffmpeg = shutil.which("ffmpeg")
    assert ffmpeg is not None
    delay_ms = round(leading_silence * 1000)
    subprocess.run(  # noqa: S603 - test helper with fixed arguments
        [
            ffmpeg, "-loglevel", "error", "-f", "lavfi",
            "-i", f"sine=frequency=440:duration={seconds}:sample_rate={rate}",
            "-af", f"adelay={delay_ms}:all=1",
            "-ac", str(channels), "-c:a", codec, str(path), "-y",
        ],
        check=True,
    )  # fmt: skip
    return path

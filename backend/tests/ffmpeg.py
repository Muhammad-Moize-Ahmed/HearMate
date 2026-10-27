"""ffmpeg for the audio tests: skipped locally when it's missing, but a failure in CI.

CI sets HEARMATE_REQUIRE_FFMPEG=1, so a broken install can't silently drop the audio tests.
"""

import os
import shutil
from collections.abc import Callable, Mapping

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

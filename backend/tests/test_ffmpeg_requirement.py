import pytest

from tests.ffmpeg import REQUIRE_ENV, find_ffmpeg


def missing(_: str) -> None:
    return None


def test_returns_the_path_when_ffmpeg_is_installed() -> None:
    assert find_ffmpeg(lambda _: "/usr/bin/ffmpeg", {}) == "/usr/bin/ffmpeg"


@pytest.mark.parametrize("env", [{}, {REQUIRE_ENV: "0"}, {REQUIRE_ENV: ""}])
def test_skips_when_missing_and_not_required(env: dict[str, str]) -> None:
    with pytest.raises(pytest.skip.Exception, match="needs ffmpeg"):
        find_ffmpeg(missing, env)


def test_fails_with_a_clear_message_when_missing_but_required() -> None:
    message = f"ffmpeg not found on PATH, but {REQUIRE_ENV}=1"
    with pytest.raises(pytest.fail.Exception, match=message):
        find_ffmpeg(missing, {REQUIRE_ENV: "1"})

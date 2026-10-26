import pytest

from app.auth.rate_limit import RateLimiter
from app.core.errors import RateLimitedError


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_allows_up_to_the_limit_then_rejects_with_retry_after() -> None:
    clock = FakeClock()
    limiter = RateLimiter(clock)

    for _ in range(3):
        limiter.hit("login:ip:1", limit=3, window_seconds=60)
    clock.now += 10
    with pytest.raises(RateLimitedError) as excinfo:
        limiter.hit("login:ip:1", limit=3, window_seconds=60)

    assert excinfo.value.status_code == 429
    assert excinfo.value.headers == {"Retry-After": "50"}


def test_the_window_slides() -> None:
    clock = FakeClock()
    limiter = RateLimiter(clock)
    limiter.hit("k", limit=1, window_seconds=60)

    clock.now += 61

    limiter.hit("k", limit=1, window_seconds=60)


def test_keys_are_independent() -> None:
    limiter = RateLimiter(FakeClock())
    limiter.hit("login:ip:1", limit=1, window_seconds=60)

    limiter.hit("login:ip:2", limit=1, window_seconds=60)


def test_rejected_requests_do_not_extend_the_block() -> None:
    clock = FakeClock()
    limiter = RateLimiter(clock)
    limiter.hit("k", limit=1, window_seconds=60)
    for _ in range(5):
        with pytest.raises(RateLimitedError):
            limiter.hit("k", limit=1, window_seconds=60)

    clock.now += 61

    limiter.hit("k", limit=1, window_seconds=60)

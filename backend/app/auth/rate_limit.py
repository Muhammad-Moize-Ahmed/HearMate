"""In-memory sliding-window rate limiter.

Good for a single API process. Behind several workers or instances, replace it with a shared
store (e.g. Redis) behind the same `hit` interface.
"""

import math
import threading
import time
from collections import deque
from collections.abc import Callable

from ..core.errors import RateLimitedError

_SWEEP_EVERY = 1000


class RateLimiter:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._calls = 0
        self._longest_window = 0.0

    def hit(self, key: str, *, limit: int, window_seconds: int) -> None:
        """Record one request for `key`; raise RateLimitedError if it exceeds `limit`."""
        now = self._clock()
        with self._lock:
            self._longest_window = max(self._longest_window, window_seconds)
            hits = self._hits.setdefault(key, deque())
            while hits and hits[0] <= now - window_seconds:
                hits.popleft()
            if len(hits) >= limit:
                retry_after = max(1, math.ceil(hits[0] + window_seconds - now))
                raise RateLimitedError(
                    "Too many requests, please try again later", retry_after_seconds=retry_after
                )
            hits.append(now)

            self._calls += 1
            if self._calls % _SWEEP_EVERY == 0:
                self._sweep(now)

    def _sweep(self, now: float) -> None:
        stale = [k for k, h in self._hits.items() if not h or h[-1] <= now - self._longest_window]
        for key in stale:
            del self._hits[key]

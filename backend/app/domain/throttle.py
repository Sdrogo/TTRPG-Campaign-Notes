"""Per-user rate limits (spec 72 Decisions 9-11): a sliding window counted in
this process. Exact while each environment runs one uvicorn process
(`architecture.md` -> Image search); it resets on deploy. If the backend ever
runs several workers or instances, the counters must move to Postgres."""

import math
import time
from collections import deque
from collections.abc import Callable, Hashable

from app.domain.errors import DomainError


class RateLimitedError(DomainError):
    """A user is over a limit. `retry_after` is the whole seconds until the
    window frees a slot (the `Retry-After` header)."""

    def __init__(self, key: str, retry_after: int) -> None:
        super().__init__(key)
        self.retry_after = retry_after


class Throttle:
    """At most `limit` calls per `window` seconds for each key. A refused call
    isn't counted."""

    def __init__(
        self,
        limit: int,
        window: float,
        clock: Callable[[], float] = time.monotonic,
        error_key: str = "errors.rateLimit.tooMany",
    ) -> None:
        self.limit = limit
        self.window = window
        self._clock = clock
        self._error_key = error_key
        self._calls: dict[Hashable, deque[float]] = {}

    def check(self, key: Hashable) -> None:
        """Counts a call for `key`, or raises `RateLimitedError` when its
        window is full."""
        now = self._clock()
        calls = self._calls.setdefault(key, deque())
        while calls and calls[0] <= now - self.window:
            calls.popleft()
        if len(calls) >= self.limit:
            # No call to wait for when the limit is 0: a whole window.
            oldest = calls[0] if calls else now
            retry_after = max(1, math.ceil(oldest + self.window - now))
            raise self._refusal(retry_after)
        calls.append(now)
        # Forget keys idle for a whole window, so the map doesn't grow.
        for other in [k for k, v in self._calls.items() if not v or v[-1] <= now - self.window]:
            del self._calls[other]

    def _refusal(self, retry_after: int) -> DomainError:
        """The error a full window raises; a subclass may keep its own."""
        return RateLimitedError(self._error_key, retry_after)

    def reset(self) -> None:
        """Forgets every count (tests)."""
        self._calls.clear()

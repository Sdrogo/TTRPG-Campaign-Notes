"""The per-user sliding window shared by every rate limit (spec 72 Decision 9)."""

import pytest

from app.domain.throttle import RateLimitedError, Throttle


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_refuses_past_the_limit_and_says_how_long_to_wait() -> None:
    clock = _Clock()
    throttle = Throttle(limit=2, window=60, clock=clock)

    throttle.check("ada")
    clock.now += 10
    throttle.check("ada")
    clock.now += 5
    with pytest.raises(RateLimitedError, match="errors.rateLimit.tooMany") as refused:
        throttle.check("ada")
    # The first call (at 1000) leaves the window at 1060; it is now 1015.
    assert refused.value.retry_after == 45


def test_a_refused_call_is_not_counted_and_the_window_slides() -> None:
    clock = _Clock()
    throttle = Throttle(limit=1, window=60, clock=clock)

    throttle.check("ada")
    for _ in range(3):
        with pytest.raises(RateLimitedError):
            throttle.check("ada")
    clock.now += 60
    throttle.check("ada")


def test_each_key_has_its_own_window_and_idle_keys_are_forgotten() -> None:
    clock = _Clock()
    throttle = Throttle(limit=1, window=60, clock=clock)

    throttle.check("ada")
    throttle.check("bob")
    clock.now += 61
    throttle.check("bob")
    assert list(throttle._calls) == ["bob"]


def test_no_allowance_waits_a_whole_window_and_reset_forgets() -> None:
    zero = Throttle(limit=0, window=30, clock=_Clock())
    with pytest.raises(RateLimitedError) as refused:
        zero.check("ada")
    assert refused.value.retry_after == 30

    one = Throttle(limit=1, window=60, clock=_Clock(), error_key="errors.custom")
    one.check("ada")
    with pytest.raises(RateLimitedError, match="errors.custom"):
        one.check("ada")
    one.reset()
    one.check("ada")

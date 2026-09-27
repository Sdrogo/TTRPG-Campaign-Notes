"""Pure unit tests for the after-commit queue (app/db/session.py). No real
database needed: these three functions only ever touch `session.info`."""

from typing import Any

import pytest

from app.db.session import discard_after_commit, on_commit, run_after_commit


class _FakeSession:
    """A stand-in with just what `session.info` is used for here."""

    def __init__(self) -> None:
        self.info: dict[str, Any] = {}


async def test_run_after_commit_runs_each_queued_callback_in_order() -> None:
    session = _FakeSession()
    calls: list[str] = []

    async def first(_session: _FakeSession) -> None:
        calls.append("first")

    async def second(_session: _FakeSession) -> None:
        calls.append("second")

    on_commit(session, first)  # type: ignore[arg-type]
    on_commit(session, second)  # type: ignore[arg-type]

    await run_after_commit(session)  # type: ignore[arg-type]

    assert calls == ["first", "second"]
    assert session.info == {}


async def test_on_commit_does_not_queue_the_same_callback_twice() -> None:
    session = _FakeSession()
    calls: list[str] = []

    async def callback(_session: _FakeSession) -> None:
        calls.append("ran")

    on_commit(session, callback)  # type: ignore[arg-type]
    on_commit(session, callback)  # type: ignore[arg-type]

    await run_after_commit(session)  # type: ignore[arg-type]

    assert calls == ["ran"]


async def test_discard_after_commit_drops_queued_work() -> None:
    session = _FakeSession()
    calls: list[str] = []

    async def callback(_session: _FakeSession) -> None:
        calls.append("ran")

    on_commit(session, callback)  # type: ignore[arg-type]
    discard_after_commit(session)  # type: ignore[arg-type]

    await run_after_commit(session)  # type: ignore[arg-type]

    assert calls == []


async def test_a_failed_callback_is_logged_not_raised_and_the_rest_still_run(
    caplog: pytest.LogCaptureFixture,
) -> None:
    session = _FakeSession()
    calls: list[str] = []

    async def failing(_session: _FakeSession) -> None:
        raise RuntimeError("Storage down")

    async def after(_session: _FakeSession) -> None:
        calls.append("after")

    on_commit(session, failing)  # type: ignore[arg-type]
    on_commit(session, after)  # type: ignore[arg-type]

    await run_after_commit(session)  # type: ignore[arg-type]

    assert calls == ["after"]
    assert "After-commit work failed" in caplog.text

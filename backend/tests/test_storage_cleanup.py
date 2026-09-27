"""app/db/storage_cleanup.py's own functions (record_pending_upload,
schedule_removal, sweep, ...) are already exercised through the image API
tests. This file covers only run_sweeper's own orchestration - the retry
loop started from app/main.py's lifespan - which nothing else reaches."""

import asyncio

import pytest

from app.db import session as session_module
from app.db import storage_cleanup


class _StopLoop(Exception):
    """Raised from a faked `asyncio.sleep` to end the otherwise-infinite loop."""


class _FakeSession:
    async def __aenter__(self) -> "_FakeSession":
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        return None


@pytest.fixture(autouse=True)
def fake_session_factory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(session_module, "async_session_factory", lambda: _FakeSession())


async def test_run_sweeper_sweeps_then_waits(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = []

    async def fake_sweep(session: object) -> None:
        calls.append(session)

    async def stop_sleep(seconds: float) -> None:
        raise _StopLoop

    monkeypatch.setattr(storage_cleanup, "sweep", fake_sweep)
    monkeypatch.setattr(asyncio, "sleep", stop_sleep)

    with pytest.raises(_StopLoop):
        await storage_cleanup.run_sweeper()

    assert len(calls) == 1


async def test_run_sweeper_logs_and_keeps_going_after_a_failed_sweep(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    async def failing_sweep(session: object) -> None:
        raise RuntimeError("db hiccup")

    async def stop_sleep(seconds: float) -> None:
        raise _StopLoop

    monkeypatch.setattr(storage_cleanup, "sweep", failing_sweep)
    monkeypatch.setattr(asyncio, "sleep", stop_sleep)

    # Reaching the (faked) sleep at all proves the failed sweep didn't crash the loop.
    with pytest.raises(_StopLoop):
        await storage_cleanup.run_sweeper()

    assert "Storage cleanup sweep failed" in caplog.text

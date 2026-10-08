"""`run_export_sweeper`'s own orchestration (spec 23b_1c): at startup it fails
every Room PDF job still active, then sweeps on an interval. The queries are
exercised by `test_export_pdf_api.py`; this covers the loop, with no database."""

import asyncio
from datetime import datetime

import pytest

from app.db import export_jobs_repo, import_jobs_repo
from app.db import session as session_module


class _StopLoop(Exception):
    """Raised from a faked `asyncio.sleep` to end the otherwise-infinite loop."""


class _FakeSession:
    commits = 0

    async def __aenter__(self) -> "_FakeSession":
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        return None

    async def commit(self) -> None:
        self.commits += 1


async def _stop_sleep(seconds: float) -> None:
    raise _StopLoop


async def test_startup_fails_what_a_restart_cut_off_then_sweeps_and_waits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _FakeSession()
    failed: list[str] = []
    swept: list[object] = []

    async def fake_fail_active(_: object, error: str, now: datetime) -> int:
        failed.append(error)
        return 1

    async def fake_sweep(given: object) -> None:
        swept.append(given)

    monkeypatch.setattr(session_module, "async_session_factory", lambda: session)
    monkeypatch.setattr(export_jobs_repo, "fail_active", fake_fail_active)
    monkeypatch.setattr(import_jobs_repo, "fail_active", fake_fail_active)
    monkeypatch.setattr(export_jobs_repo, "sweep", fake_sweep)
    monkeypatch.setattr(asyncio, "sleep", _stop_sleep)

    with pytest.raises(_StopLoop):
        await export_jobs_repo.run_export_sweeper()

    # Room PDFs and Document imports (spec 27) cut off by the restart.
    assert failed == ["interrupted", "interrupted"]
    assert session.commits == 1
    assert swept == [session]


async def test_a_failure_at_startup_or_in_a_sweep_is_logged_and_the_loop_goes_on(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def broken_factory() -> _FakeSession:
        raise RuntimeError("db hiccup")

    monkeypatch.setattr(session_module, "async_session_factory", broken_factory)
    monkeypatch.setattr(asyncio, "sleep", _stop_sleep)

    # Reaching the (faked) sleep proves neither failure ended the loop.
    with pytest.raises(_StopLoop):
        await export_jobs_repo.run_export_sweeper()

    assert "interrupted by a restart" in caplog.text
    assert "Room PDF sweep failed" in caplog.text

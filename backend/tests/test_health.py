import asyncio

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_answers_head() -> None:
    response = client.head("/health")
    assert response.status_code == 200


def test_lifespan_starts_and_cancels_the_sweepers(monkeypatch: pytest.MonkeyPatch) -> None:
    """The real sweepers touch the database on their very first iteration
    (app/db/storage_cleanup.py, app/db/export_jobs_repo.py); faked here so this only exercises the
    lifespan's own start/cancel wiring, not the sweep itself."""

    async def fake_sweeper() -> None:
        await asyncio.sleep(3600)

    monkeypatch.setattr(main_module, "run_sweeper", fake_sweeper)
    monkeypatch.setattr(main_module, "run_export_sweeper", fake_sweeper)

    with TestClient(main_module.app) as lifespan_client:
        response = lifespan_client.get("/health")
        assert response.status_code == 200

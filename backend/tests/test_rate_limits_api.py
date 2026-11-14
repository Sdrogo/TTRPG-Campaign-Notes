"""Spec 72: the per-user rate limits on writes and heavy routes, and the API
docs being off unless asked for."""

import io
import uuid
from collections.abc import AsyncIterator, Callable

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import rate_limits
from app.api.rate_limits import Group
from app.auth import dependencies
from app.config import Settings
from app.domain.documents import MAX_IMAGES_PER_DOCUMENT
from app.main import app, docs_urls


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _headers(make_token: Callable[..., str], locale: str = "en") -> dict[str, str]:
    return {
        "Authorization": f"Bearer {make_token(str(uuid.uuid4()))}",
        "Accept-Language": locale,
    }


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (60, 40), color=(120, 40, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


async def test_api_docs_are_off_by_default(client: AsyncClient) -> None:
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert (await client.get(path)).status_code == 404


def test_api_docs_paths_follow_the_setting() -> None:
    assert docs_urls(Settings(api_docs_enabled=True)) == {
        "docs_url": "/docs",
        "redoc_url": "/redoc",
        "openapi_url": "/openapi.json",
    }
    assert set(docs_urls(Settings(api_docs_enabled=False)).values()) == {None}


async def test_every_write_counts_per_user_and_reads_never_do(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dependencies.WRITE_THROTTLE, "limit", 2)
    ada = _headers(make_token, "it")

    for name in ("Barovia", "Ravenloft"):
        assert (await client.post("/rooms", json={"name": name}, headers=ada)).status_code == 201
    refused = await client.post("/rooms", json={"name": "Vallaki"}, headers=ada)

    assert refused.status_code == 429
    assert refused.json()["detail"] == "Troppe richieste: attendi qualche istante e riprova"
    assert 1 <= int(refused.headers["Retry-After"]) <= 60
    for _ in range(5):
        assert (await client.get("/rooms", headers=ada)).status_code == 200
    other = await client.post("/rooms", json={"name": "Krezk"}, headers=_headers(make_token))
    assert other.status_code == 201


async def test_a_group_limit_refuses_its_routes_only(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(rate_limits.THROTTLES[Group.DUPLICATE], "limit", 1)
    ada = _headers(make_token)
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=ada)).json()

    first = await client.post(f"/rooms/{room['id']}/duplicate", headers=ada)
    second = await client.post(f"/rooms/{room['id']}/duplicate", headers=ada)

    assert first.status_code == 201
    assert second.status_code == 429
    assert second.json()["detail"] == "Too many requests: wait a moment and try again"
    assert "Retry-After" in second.headers
    # Other writes of the same user still go through.
    assert (await client.post("/rooms", json={"name": "Krezk"}, headers=ada)).status_code == 201


async def test_a_full_set_of_document_images_uploads_in_sequence_under_the_limits(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    """The bulk image upload (one request per file, `useUploadDocumentImages`)
    with the real limits: a Document's every image in a row."""
    ada = _headers(make_token)
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=ada)).json()
    document = (
        await client.post(f"/rooms/{room['id']}/documents", json={"name": "Strahd"}, headers=ada)
    ).json()

    for _ in range(MAX_IMAGES_PER_DOCUMENT):
        response = await client.post(
            f"/rooms/{room['id']}/documents/{document['id']}/images",
            files={"file": ("portrait.png", _png(), "image/png")},
            headers=ada,
        )
        assert response.status_code == 201


def test_a_vault_import_and_its_retries_fit_the_import_limits() -> None:
    """A vault is one preview and one import request (spec 65), whatever its
    size: the limits leave room for several attempts in one window."""
    attempts = 5
    assert rate_limits.THROTTLES[Group.IMPORT_PREVIEW].limit >= 2 * attempts
    assert rate_limits.THROTTLES[Group.IMPORT].limit >= attempts
    # A bulk image upload of a whole Document stays under the per-minute cap.
    assert rate_limits.THROTTLES[Group.UPLOAD].limit >= MAX_IMAGES_PER_DOCUMENT

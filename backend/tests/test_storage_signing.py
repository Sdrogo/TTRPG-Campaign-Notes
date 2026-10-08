import io
import uuid
from collections.abc import AsyncIterator, Callable, Collection

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import storage
from app.main import app


@pytest.fixture
def signer(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    """Fake Storage signing on an empty link cache; records each request's
    paths. Links carry a counter, so a re-signed path gets a new URL."""
    requests: list[list[str]] = []

    async def fake_create(paths: Collection[str], expires_in: int) -> dict[str, str]:
        requests.append(list(paths))
        return {path: f"https://signed.test/{path}?n={len(requests)}" for path in paths}

    monkeypatch.setattr(storage, "_signed_cache", {})
    monkeypatch.setattr(storage, "create_signed_urls", fake_create)
    return requests


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    now = [1000.0]
    monkeypatch.setattr(storage, "_now", lambda: now[0])
    return now


async def test_paths_are_signed_in_one_request(signer: list[list[str]]) -> None:
    urls = await storage.signed_urls(["a.webp", "b.webp", "a.webp"])

    assert set(urls) == {"a.webp", "b.webp"}
    assert signer == [["a.webp", "b.webp"]]


async def test_a_link_is_reused_while_it_has_time_left(
    signer: list[list[str]], clock: list[float]
) -> None:
    first = await storage.signed_urls(["a.webp"])
    clock[0] += storage.SIGNED_URL_TTL_SECONDS - storage.SIGNED_URL_MIN_REMAINING_SECONDS
    again = await storage.signed_urls(["a.webp", "b.webp"])

    # Same URL for the same image, so the browser cache keeps working...
    assert again["a.webp"] == first["a.webp"]
    # ... and only the new path was signed.
    assert signer == [["a.webp"], ["b.webp"]]


async def test_a_link_close_to_expiry_is_renewed(
    signer: list[list[str]], clock: list[float]
) -> None:
    first = await storage.signed_urls(["a.webp"])
    clock[0] += storage.SIGNED_URL_TTL_SECONDS - storage.SIGNED_URL_MIN_REMAINING_SECONDS + 1

    renewed = await storage.signed_urls(["a.webp"])

    assert renewed["a.webp"] != first["a.webp"]
    assert len(signer) == 2


async def test_a_fully_expired_link_is_dropped_from_the_cache(
    signer: list[list[str]], clock: list[float]
) -> None:
    await storage.signed_urls(["a.webp"])
    assert "a.webp" in storage._signed_cache

    clock[0] += storage.SIGNED_URL_TTL_SECONDS + 1
    await storage.signed_urls(["b.webp"])

    assert "a.webp" not in storage._signed_cache


async def test_storage_outage_leaves_paths_out_instead_of_failing(
    signer: list[list[str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    cached = await storage.signed_urls(["a.webp"])

    async def storage_down(paths: Collection[str], expires_in: int) -> dict[str, str]:
        raise storage.StorageError("Storage unavailable")

    monkeypatch.setattr(storage, "create_signed_urls", storage_down)
    urls = await storage.signed_urls(["a.webp", "b.webp"])

    assert urls == cached  # the cached link still works; b is just missing


async def test_removed_objects_are_no_longer_handed_out(signer: list[list[str]]) -> None:
    first = await storage.signed_urls(["a.webp"])
    storage.forget_signed_urls(["a.webp"])

    again = await storage.signed_urls(["a.webp"])

    assert again["a.webp"] != first["a.webp"]


# --- Through the API -----------------------------------------------------


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (64, 64)).save(buffer, format="PNG")
    return buffer.getvalue()


async def _document_with_image(client: AsyncClient, headers: dict[str, str]) -> tuple[str, str]:
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=headers)).json()
    document = (
        await client.post(
            f"/rooms/{room['id']}/documents", json={"name": "Strahd"}, headers=headers
        )
    ).json()
    url = f"/rooms/{room['id']}/documents/{document['id']}"
    response = await client.post(
        f"{url}/images", files={"file": ("a.png", _png(), "image/png")}, headers=headers
    )
    assert response.status_code == 201
    return room["id"], url


async def test_image_urls_are_signed_links_not_public_ones(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    headers = {"Authorization": f"Bearer {make_token(str(uuid.uuid4()), email='m@x.com')}"}
    room_id, document_url = await _document_with_image(client, headers)

    (image,) = (await client.get(document_url, headers=headers)).json()["images"]
    (listed,) = (await client.get(f"/rooms/{room_id}/documents", headers=headers)).json()

    (path,) = fake_storage
    assert image["url"] == f"https://signed.test/{path}?token=t"
    assert "/object/public/" not in image["url"]
    assert listed["images"][0]["url"] == image["url"]


async def test_documents_still_load_when_signing_fails(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = {"Authorization": f"Bearer {make_token(str(uuid.uuid4()), email='m@x.com')}"}
    _, document_url = await _document_with_image(client, headers)

    async def storage_down(paths: Collection[str], expires_in: int) -> dict[str, str]:
        raise storage.StorageError("Storage unavailable")

    monkeypatch.setattr(storage, "_signed_cache", {})
    monkeypatch.setattr(storage, "create_signed_urls", storage_down)
    response = await client.get(document_url, headers=headers)

    assert response.status_code == 200
    assert response.json()["images"] == []


# --- own_object_path (spec 27 import) ------------------------------------------------


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (
            "https://own.supabase.test/storage/v1/object/sign/document-images/r/d/a.webp?token=x",
            "r/d/a.webp",
        ),
        (
            "https://own.supabase.test/storage/v1/object/sign/document-images/r/d/a%20b.webp",
            "r/d/a b.webp",
        ),
        ("https://own.supabase.test/storage/v1/object/sign/other-bucket/r/d/a.webp", None),
        ("https://elsewhere.test/storage/v1/object/sign/document-images/r/d/a.webp", None),
        ("https://own.supabase.test/storage/v1/object/sign/document-images/", None),
        ("https://own.supabase.test/storage/v1/object/sign/document-images/r/../x.webp", None),
    ],
)
def test_own_object_path_reads_only_this_apps_signed_links(
    monkeypatch: pytest.MonkeyPatch, url: str, expected: str | None
) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "supabase_url", "https://own.supabase.test")
    monkeypatch.setattr(settings, "storage_bucket", "document-images")

    assert storage.own_object_path(url) == expected


def test_own_object_path_is_none_without_a_configured_supabase(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "supabase_url", "")

    assert storage.own_object_path("https://x.test/storage/v1/object/sign/b/p") is None

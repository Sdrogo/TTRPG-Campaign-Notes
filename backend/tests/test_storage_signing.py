import io
import uuid
from collections.abc import AsyncIterator, Callable, Collection
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlsplit

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import storage
from app.main import app


@pytest.fixture
def s3(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "s3_public_url", "https://files.test")
    monkeypatch.setattr(settings, "s3_access_key_id", "GKtestkey")
    monkeypatch.setattr(settings, "s3_secret_access_key", "secret")
    monkeypatch.setattr(settings, "storage_bucket", "document-images")


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    # Two hours into a window.
    now = [19_675 * 86_400.0 + 7200]
    monkeypatch.setattr(storage, "_wall_clock", lambda: now[0])
    return now


async def test_paths_are_signed_in_one_call_without_duplicates(s3: None) -> None:
    urls = await storage.signed_urls(["a.webp", "b.webp", "a.webp"])

    assert set(urls) == {"a.webp", "b.webp"}


async def test_a_link_is_the_same_for_the_whole_window(s3: None, clock: list[float]) -> None:
    first = await storage.signed_urls(["a.webp"])
    clock[0] += storage.SIGNED_URL_WINDOW_SECONDS - 7201  # the window's last second

    # Same URL for the same image, so the browser cache keeps working
    # (also after a restart: nothing is kept in memory).
    assert (await storage.signed_urls(["a.webp"])) == first


async def test_a_link_changes_with_the_next_window(s3: None, clock: list[float]) -> None:
    first = await storage.signed_urls(["a.webp"])
    clock[0] += storage.SIGNED_URL_WINDOW_SECONDS

    assert (await storage.signed_urls(["a.webp"]))["a.webp"] != first["a.webp"]


async def test_a_link_is_valid_for_at_least_a_window_and_at_most_two(
    s3: None, clock: list[float]
) -> None:
    now = int(clock[0])
    (url,) = (await storage.signed_urls(["a.webp"])).values()

    params = parse_qs(urlsplit(url).query)
    signed_at = datetime.strptime(params["X-Amz-Date"][0], "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
    expires = int(params["X-Amz-Expires"][0])
    assert signed_at.timestamp() % storage.SIGNED_URL_WINDOW_SECONDS == 0
    remaining = signed_at.timestamp() + expires - now
    assert storage.SIGNED_URL_WINDOW_SECONDS <= remaining <= storage.SIGNED_URL_VALID_SECONDS


async def test_storage_outage_leaves_paths_out_instead_of_failing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def storage_down(paths: Collection[str], expires_in: int) -> dict[str, str]:
        raise storage.StorageError("Storage unavailable")

    monkeypatch.setattr(storage, "create_signed_urls", storage_down)

    assert await storage.signed_urls(["a.webp", "b.webp"]) == {}


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

    monkeypatch.setattr(storage, "LEGACY_SUPABASE_URLS", ("https://own.supabase.test",))
    monkeypatch.setattr(settings, "s3_public_url", "")
    monkeypatch.setattr(settings, "storage_bucket", "document-images")

    assert storage.own_object_path(url) == expected

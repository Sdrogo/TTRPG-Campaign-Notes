import io
import uuid
from collections.abc import AsyncIterator, Callable

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import remote_images
from app.db.remote_images import RemoteImageError
from app.domain.documents import MAX_IMAGES_PER_DOCUMENT
from app.domain.images import MAX_DIMENSION
from app.main import app


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _png(size: tuple[int, int] = (100, 80)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color=(120, 40, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _room_with_master_and_document(
    client: AsyncClient, make_token: Callable[..., str]
) -> tuple[str, str, str, str]:
    """Returns (room_id, document_id, master_token, player_token)."""
    master_token = make_token(str(uuid.uuid4()))
    room = (
        await client.post("/rooms", json={"name": "Barovia"}, headers=_auth_headers(master_token))
    ).json()
    document = (
        await client.post(
            f"/rooms/{room['id']}/documents",
            json={"name": "Strahd"},
            headers=_auth_headers(master_token),
        )
    ).json()
    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations",
            json={"role": "player"},
            headers=_auth_headers(master_token),
        )
    ).json()
    player_token = make_token(str(uuid.uuid4()))
    await client.post(f"/invitations/{invite['code']}/accept", headers=_auth_headers(player_token))
    return room["id"], document["id"], master_token, player_token


async def _upload(
    client: AsyncClient, room_id: str, document_id: str, token: str, data: bytes
) -> tuple[int, dict[str, object]]:
    response = await client.post(
        f"/rooms/{room_id}/documents/{document_id}/images",
        files={"file": ("portrait.png", data, "image/png")},
        headers=_auth_headers(token),
    )
    return response.status_code, response.json() if response.content else {}


async def test_owner_can_upload_multiple_images(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room_id, document_id, master_token, _ = await _room_with_master_and_document(client, make_token)

    status_code, _ = await _upload(client, room_id, document_id, master_token, _png())
    assert status_code == 201
    status_code, body = await _upload(client, room_id, document_id, master_token, _png())
    assert status_code == 201

    images = body["images"]
    assert isinstance(images, list)
    assert len(images) == 2
    assert len(fake_storage) == 2
    for path in fake_storage:
        assert path.startswith(f"{room_id}/{document_id}/")
        assert path.endswith(".webp")
        assert any(path in image["url"] for image in images)

    # The images show up on a plain GET too, in upload order.
    fetched = (
        await client.get(
            f"/rooms/{room_id}/documents/{document_id}", headers=_auth_headers(master_token)
        )
    ).json()
    assert [i["id"] for i in fetched["images"]] == [i["id"] for i in images]


async def test_uploaded_image_is_scaled_down(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room_id, document_id, master_token, _ = await _room_with_master_and_document(client, make_token)

    status_code, _ = await _upload(client, room_id, document_id, master_token, _png((3000, 1500)))
    assert status_code == 201

    (stored,) = fake_storage.values()
    with Image.open(io.BytesIO(stored)) as image:
        assert image.format == "WEBP"
        assert max(image.size) == MAX_DIMENSION


async def test_non_owner_cannot_upload(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room_id, document_id, _, player_token = await _room_with_master_and_document(client, make_token)

    status_code, _ = await _upload(client, room_id, document_id, player_token, _png())
    assert status_code == 403
    assert fake_storage == {}


async def test_non_image_file_is_rejected(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room_id, document_id, master_token, _ = await _room_with_master_and_document(client, make_token)

    status_code, _ = await _upload(
        client, room_id, document_id, master_token, b"%PDF-1.7 not an image"
    )
    assert status_code == 422
    assert fake_storage == {}


async def test_image_limit_returns_conflict(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room_id, document_id, master_token, _ = await _room_with_master_and_document(client, make_token)
    small = _png((8, 8))
    for _ in range(MAX_IMAGES_PER_DOCUMENT):
        status_code, _ = await _upload(client, room_id, document_id, master_token, small)
        assert status_code == 201

    status_code, _ = await _upload(client, room_id, document_id, master_token, small)
    assert status_code == 409
    assert len(fake_storage) == MAX_IMAGES_PER_DOCUMENT


async def test_owner_can_import_an_image_from_url(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requested: list[str] = []

    async def fake_fetch(url: str) -> bytes:
        requested.append(url)
        return _png()

    monkeypatch.setattr(remote_images, "fetch_image_bytes", fake_fetch)
    room_id, document_id, master_token, _ = await _room_with_master_and_document(client, make_token)

    response = await client.post(
        f"/rooms/{room_id}/documents/{document_id}/images/from-url",
        json={"url": "https://example.com/strahd.png"},
        headers=_auth_headers(master_token),
    )
    assert response.status_code == 201
    assert requested == ["https://example.com/strahd.png"]
    assert len(response.json()["images"]) == 1
    # Stored in our bucket, not hotlinked.
    (path,) = fake_storage
    assert path in response.json()["images"][0]["url"]


async def test_unreachable_url_is_rejected(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def failing_fetch(url: str) -> bytes:
        raise RemoteImageError("Image URL returned HTTP 404")

    monkeypatch.setattr(remote_images, "fetch_image_bytes", failing_fetch)
    room_id, document_id, master_token, _ = await _room_with_master_and_document(client, make_token)

    response = await client.post(
        f"/rooms/{room_id}/documents/{document_id}/images/from-url",
        json={"url": "https://example.com/missing.png"},
        headers=_auth_headers(master_token),
    )
    assert response.status_code == 422
    assert fake_storage == {}


async def test_owner_can_delete_an_image(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room_id, document_id, master_token, player_token = await _room_with_master_and_document(
        client, make_token
    )
    _, body = await _upload(client, room_id, document_id, master_token, _png())
    images = body["images"]
    assert isinstance(images, list)
    image_id = images[0]["id"]

    forbidden = await client.delete(
        f"/rooms/{room_id}/documents/{document_id}/images/{image_id}",
        headers=_auth_headers(player_token),
    )
    assert forbidden.status_code == 403

    response = await client.delete(
        f"/rooms/{room_id}/documents/{document_id}/images/{image_id}",
        headers=_auth_headers(master_token),
    )
    assert response.status_code == 204
    assert fake_storage == {}

    fetched = (
        await client.get(
            f"/rooms/{room_id}/documents/{document_id}", headers=_auth_headers(master_token)
        )
    ).json()
    assert fetched["images"] == []


async def test_metadata_update_keeps_images(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room_id, document_id, master_token, _ = await _room_with_master_and_document(client, make_token)
    await _upload(client, room_id, document_id, master_token, _png())

    response = await client.patch(
        f"/rooms/{room_id}/documents/{document_id}",
        json={"description": "Updated"},
        headers=_auth_headers(master_token),
    )
    assert response.status_code == 200
    assert len(response.json()["images"]) == 1

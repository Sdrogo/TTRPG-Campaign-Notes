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


# --- Favorite image (spec 07) ---------------------------------------------


def _images(body: dict[str, object]) -> list[dict[str, object]]:
    """`body["images"]` is typed `object`; the asserts below need a list."""
    images = body["images"]
    assert isinstance(images, list)
    return images


async def _set_favorite(
    client: AsyncClient, room_id: str, document_id: str, image_id: str, token: str
) -> tuple[int, dict[str, object]]:
    response = await client.put(
        f"/rooms/{room_id}/documents/{document_id}/images/{image_id}/favorite",
        headers=_auth_headers(token),
    )
    return response.status_code, response.json() if response.content else {}


async def test_first_uploaded_image_is_the_favorite(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room_id, document_id, master_token, _ = await _room_with_master_and_document(client, make_token)

    _, first = await _upload(client, room_id, document_id, master_token, _png())
    assert [i["is_favorite"] for i in _images(first)] == [True]

    _, second = await _upload(client, room_id, document_id, master_token, _png())
    assert [i["is_favorite"] for i in _images(second)] == [True, False]


async def test_owner_can_move_the_favorite_and_it_leads_the_gallery(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room_id, document_id, master_token, _ = await _room_with_master_and_document(client, make_token)
    await _upload(client, room_id, document_id, master_token, _png())
    _, body = await _upload(client, room_id, document_id, master_token, _png())
    first_id, second_id = (str(i["id"]) for i in _images(body))

    status_code, updated = await _set_favorite(
        client, room_id, document_id, second_id, master_token
    )
    assert status_code == 200
    # Exactly one favorite, and it now leads the list the card reads.
    assert [i["id"] for i in _images(updated)] == [second_id, first_id]
    assert [i["is_favorite"] for i in _images(updated)] == [True, False]

    # Not just in the response of the write - a fresh read agrees.
    fetched = (
        await client.get(
            f"/rooms/{room_id}/documents/{document_id}", headers=_auth_headers(master_token)
        )
    ).json()
    assert [i["id"] for i in _images(fetched)] == [second_id, first_id]


async def test_a_player_who_is_not_an_owner_cannot_set_the_favorite(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room_id, document_id, master_token, player_token = await _room_with_master_and_document(
        client, make_token
    )
    _, body = await _upload(client, room_id, document_id, master_token, _png())
    image_id = str(_images(body)[0]["id"])

    status_code, _ = await _set_favorite(client, room_id, document_id, image_id, player_token)
    assert status_code == 403


async def test_setting_an_unknown_image_as_favorite_is_not_found(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room_id, document_id, master_token, _ = await _room_with_master_and_document(client, make_token)
    await _upload(client, room_id, document_id, master_token, _png())

    status_code, _ = await _set_favorite(
        client, room_id, document_id, str(uuid.uuid4()), master_token
    )
    assert status_code == 404


async def test_deleting_the_favorite_promotes_the_oldest_survivor(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room_id, document_id, master_token, _ = await _room_with_master_and_document(client, make_token)
    await _upload(client, room_id, document_id, master_token, _png())
    await _upload(client, room_id, document_id, master_token, _png())
    _, body = await _upload(client, room_id, document_id, master_token, _png())
    first_id, second_id, third_id = (str(i["id"]) for i in _images(body))

    # The first upload is the favorite; deleting it must hand the flag on
    # rather than leave the Document without one.
    response = await client.delete(
        f"/rooms/{room_id}/documents/{document_id}/images/{first_id}",
        headers=_auth_headers(master_token),
    )
    assert response.status_code == 204

    fetched = (
        await client.get(
            f"/rooms/{room_id}/documents/{document_id}", headers=_auth_headers(master_token)
        )
    ).json()
    assert [i["id"] for i in _images(fetched)] == [second_id, third_id]
    assert [i["is_favorite"] for i in _images(fetched)] == [True, False]


async def test_deleting_the_last_image_leaves_the_document_without_a_favorite(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room_id, document_id, master_token, _ = await _room_with_master_and_document(client, make_token)
    _, body = await _upload(client, room_id, document_id, master_token, _png())
    image_id = str(_images(body)[0]["id"])

    response = await client.delete(
        f"/rooms/{room_id}/documents/{document_id}/images/{image_id}",
        headers=_auth_headers(master_token),
    )
    assert response.status_code == 204

    fetched = (
        await client.get(
            f"/rooms/{room_id}/documents/{document_id}", headers=_auth_headers(master_token)
        )
    ).json()
    assert fetched["images"] == []

    # A later upload starts the rule over.
    _, after = await _upload(client, room_id, document_id, master_token, _png())
    assert [i["is_favorite"] for i in _images(after)] == [True]


async def test_deleting_a_non_favorite_image_leaves_the_favorite_alone(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    """Every removal now asks the Document to restore "exactly one favorite",
    not only the ones believed to have lost theirs - so this pins that the
    ask is a no-op while the favorite is still there."""
    room_id, document_id, master_token, _ = await _room_with_master_and_document(client, make_token)
    await _upload(client, room_id, document_id, master_token, _png())
    await _upload(client, room_id, document_id, master_token, _png())
    _, body = await _upload(client, room_id, document_id, master_token, _png())
    first_id, second_id, third_id = (str(i["id"]) for i in _images(body))

    response = await client.delete(
        f"/rooms/{room_id}/documents/{document_id}/images/{second_id}",
        headers=_auth_headers(master_token),
    )
    assert response.status_code == 204

    fetched = (
        await client.get(
            f"/rooms/{room_id}/documents/{document_id}", headers=_auth_headers(master_token)
        )
    ).json()
    assert [i["id"] for i in _images(fetched)] == [first_id, third_id]
    assert [i["is_favorite"] for i in _images(fetched)] == [True, False]


async def test_deleting_a_comments_images_keeps_the_documents_favorite_intact(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    """Deleting a Comment removes its attachments through the same path, for
    a Document whose own favorite is untouched."""
    room_id, document_id, master_token, _ = await _room_with_master_and_document(client, make_token)
    _, body = await _upload(client, room_id, document_id, master_token, _png())
    favorite_id = str(_images(body)[0]["id"])

    comment = (
        await client.post(
            f"/rooms/{room_id}/documents/{document_id}/comments",
            json={"body": "Here's how I picture it."},
            headers=_auth_headers(master_token),
        )
    ).json()
    await client.post(
        f"/rooms/{room_id}/documents/{document_id}/comments/{comment['id']}/images",
        files={"file": ("sketch.png", _png(), "image/png")},
        headers=_auth_headers(master_token),
    )

    deleted = await client.delete(
        f"/rooms/{room_id}/documents/{document_id}/comments/{comment['id']}",
        headers=_auth_headers(master_token),
    )
    assert deleted.status_code == 204

    fetched = (
        await client.get(
            f"/rooms/{room_id}/documents/{document_id}", headers=_auth_headers(master_token)
        )
    ).json()
    assert [i["id"] for i in _images(fetched)] == [favorite_id]
    assert [i["is_favorite"] for i in _images(fetched)] == [True]

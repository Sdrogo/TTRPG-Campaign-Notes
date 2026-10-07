"""The Room's image (spec 26): who may set it, how it is stored and replaced,
and that Storage stays in step with the Room row."""

import io
import uuid
from collections.abc import AsyncIterator, Callable, Collection
from datetime import UTC, datetime
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import remote_images, rooms_repo, storage_cleanup
from app.db.models import StorageCleanupRow
from app.domain.images import MAX_DIMENSION
from app.main import app


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _png(size: tuple[int, int] = (800, 600)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color=(120, 40, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


def _headers(make_token: Callable[..., str], user_id: str | None = None) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(user_id or str(uuid.uuid4()))}"}


async def _room(client: AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    response = await client.post("/rooms", json={"name": "Barovia"}, headers=headers)
    assert response.status_code == 201
    return dict(response.json())


async def _join(
    client: AsyncClient, room_id: str, admin: dict[str, str], member: dict[str, str], role: str
) -> None:
    invite = (
        await client.post(f"/rooms/{room_id}/invitations", json={"role": role}, headers=admin)
    ).json()
    response = await client.post(f"/invitations/{invite['code']}/accept", headers=member)
    assert response.status_code == 200


async def _upload(
    client: AsyncClient, room_id: str, headers: dict[str, str], data: bytes
) -> tuple[int, dict[str, Any]]:
    response = await client.post(
        f"/rooms/{room_id}/image", files={"file": ("cover.png", data, "image/png")}, headers=headers
    )
    return response.status_code, response.json()


async def _cleanup_rows(session: AsyncSession, paths: Collection[str]) -> list[str]:
    result = await session.execute(
        select(StorageCleanupRow.storage_path).where(StorageCleanupRow.storage_path.in_(paths))
    )
    return list(result.scalars())


def _after_grace() -> datetime:
    return datetime.now(UTC) + 2 * storage_cleanup.SWEEP_GRACE


async def test_a_new_room_has_no_image(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, _headers(make_token))
    assert room["image_url"] is None


async def test_an_administrator_uploads_an_image_every_member_sees(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    admin, player = _headers(make_token), _headers(make_token)
    room = await _room(client, admin)
    await _join(client, room["id"], admin, player, "player")

    status_code, body = await _upload(client, room["id"], admin, _png((2400, 1200)))

    assert status_code == 200
    (path, stored) = next(iter(fake_storage.items()))
    assert path.startswith(f"rooms/{room['id']}/")
    expected = f"https://signed.test/{path}?token=t"
    assert body["image_url"] == expected
    # Not cropped: a cover keeps its shape, scaled to the usual limit.
    with Image.open(io.BytesIO(stored)) as image:
        assert image.format == "WEBP"
        assert image.size == (MAX_DIMENSION, MAX_DIMENSION // 2)
    assert await _cleanup_rows(db_session, [path]) == []
    # Every member reads it with the Room, in each route that returns one.
    assert (await client.get(f"/rooms/{room['id']}", headers=player)).json()["image_url"] == (
        expected
    )
    (mine,) = (await client.get("/rooms", headers=player)).json()
    assert mine["room"]["image_url"] == expected


async def test_replacing_the_image_removes_the_old_one(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    admin = _headers(make_token)
    room = await _room(client, admin)
    await _upload(client, room["id"], admin, _png())
    (old_path,) = fake_storage

    _, body = await _upload(client, room["id"], admin, _png((300, 300)))

    (new_path,) = fake_storage
    assert new_path != old_path
    assert body["image_url"] == f"https://signed.test/{new_path}?token=t"


async def test_an_administrator_removes_the_image(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    admin = _headers(make_token)
    room = await _room(client, admin)
    await _upload(client, room["id"], admin, _png())

    response = await client.delete(f"/rooms/{room['id']}/image", headers=admin)

    assert response.status_code == 200
    assert response.json()["image_url"] is None
    assert fake_storage == {}
    # Removing when there is none is a no-op, not an error.
    again = await client.delete(f"/rooms/{room['id']}/image", headers=admin)
    assert again.status_code == 200


async def test_the_image_can_be_imported_from_a_url(
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
    admin = _headers(make_token)
    room = await _room(client, admin)

    response = await client.post(
        f"/rooms/{room['id']}/image/from-url",
        json={"url": "https://example.com/cover.png"},
        headers=admin,
    )

    assert response.status_code == 200
    assert requested == ["https://example.com/cover.png"]
    assert len(fake_storage) == 1


async def test_only_an_administrator_changes_the_image(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Spec 26 Decision 2: a Master who isn't an Administrator is refused too.
    async def no_fetch(url: str) -> bytes:  # pragma: no cover - must not be reached
        raise AssertionError("fetched for a refused request")

    monkeypatch.setattr(remote_images, "fetch_image_bytes", no_fetch)
    admin, master, outsider = (_headers(make_token) for _ in range(3))
    room = await _room(client, admin)
    await _join(client, room["id"], admin, master, "master")
    url = f"/rooms/{room['id']}/image"

    for headers, detail in (
        (master, "Only a Room Administrator can change the Room image"),
        (outsider, "Not a member of this room"),
    ):
        status_code, body = await _upload(client, room["id"], headers, _png())
        assert (status_code, body["detail"]) == (403, detail)
        imported = await client.post(
            f"{url}/from-url", json={"url": "https://example.com/a.png"}, headers=headers
        )
        assert imported.status_code == 403
        assert (await client.delete(url, headers=headers)).status_code == 403
    assert fake_storage == {}


async def test_a_non_image_is_rejected(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    admin = _headers(make_token)
    room = await _room(client, admin)

    status_code, _ = await _upload(client, room["id"], admin, b"not an image")

    assert status_code == 422
    assert fake_storage == {}


async def test_the_sweep_never_removes_a_room_image_in_use(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    admin = _headers(make_token)
    room = await _room(client, admin)
    await _upload(client, room["id"], admin, _png())
    (path,) = fake_storage

    # E.g. a stale cleanup row left behind for the same path.
    await storage_cleanup.record_pending_upload(path)
    await storage_cleanup.sweep(db_session, now=_after_grace())

    assert path in fake_storage
    assert await _cleanup_rows(db_session, [path]) == []


async def test_an_upload_whose_transaction_fails_is_swept_later(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin = _headers(make_token)
    room = await _room(client, admin)

    async def failing_set(session: AsyncSession, room_id: object, path: object) -> None:
        raise RuntimeError("database went away")

    monkeypatch.setattr(rooms_repo, "set_room_image", failing_set)
    with pytest.raises(RuntimeError):
        await _upload(client, room["id"], admin, _png())

    (orphan,) = fake_storage
    assert await _cleanup_rows(db_session, [orphan]) == [orphan]
    await storage_cleanup.sweep(db_session, now=_after_grace())
    assert fake_storage == {}


async def test_deleting_the_room_removes_its_image(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    admin = _headers(make_token)
    room = await _room(client, admin)
    await _upload(client, room["id"], admin, _png())

    response = await client.delete(f"/rooms/{room['id']}", headers=admin)

    assert response.status_code == 204
    assert fake_storage == {}

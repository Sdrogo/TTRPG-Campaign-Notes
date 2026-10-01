import io
import uuid
from collections.abc import AsyncIterator, Callable

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    AuditLogRow,
    DocumentImageRow,
    DocumentRow,
    InvitationRow,
    MembershipRow,
    RoomRow,
    TagRow,
)
from app.main import app


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (60, 40), color=(120, 40, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _join(
    client: AsyncClient, make_token: Callable[..., str], room_id: str, admin: dict[str, str]
) -> tuple[dict[str, str], str]:
    """A new Player in the Room: their headers and user id."""
    invite = (
        await client.post(f"/rooms/{room_id}/invitations", json={"role": "player"}, headers=admin)
    ).json()
    user_id = str(uuid.uuid4())
    headers = _auth_headers(make_token(user_id))
    await client.post(f"/invitations/{invite['code']}/accept", headers=headers)
    return headers, user_id


async def _count(db_session: AsyncSession, model: type, room_id: uuid.UUID) -> int:
    column = model.id if model is RoomRow else model.room_id  # type: ignore[attr-defined]
    result = await db_session.execute(
        select(func.count()).select_from(model).where(column == room_id)
    )
    return int(result.scalar_one())


async def test_administrator_deletes_the_room_and_everything_under_it(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    """Spec 13: members, invitations, Tags, Documents, audit rows and every
    image - Comment attachments included - go, Storage objects with them."""
    master = _auth_headers(make_token(str(uuid.uuid4())))
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master)).json()
    room_id = room["id"]
    player, player_id = await _join(client, make_token, room_id, master)
    # An audited change, so the Room has an audit row to lose.
    await client.patch(
        f"/rooms/{room_id}/members/{player_id}", json={"is_admin": True}, headers=master
    )

    first = (
        await client.post(f"/rooms/{room_id}/documents", json={"name": "One"}, headers=master)
    ).json()
    second = (
        await client.post(f"/rooms/{room_id}/documents", json={"name": "Two"}, headers=player)
    ).json()
    for document in (first, second):
        await client.post(
            f"/rooms/{room_id}/documents/{document['id']}/images",
            files={"file": ("a.png", _png(), "image/png")},
            headers=master,
        )
    comment = (
        await client.post(
            f"/rooms/{room_id}/documents/{first['id']}/comments",
            json={"body": "Hello"},
            headers=master,
        )
    ).json()
    await client.post(
        f"/rooms/{room_id}/documents/{first['id']}/comments/{comment['id']}/images",
        files={"file": ("b.png", _png(), "image/png")},
        headers=master,
    )
    assert len(fake_storage) == 3

    response = await client.delete(f"/rooms/{room_id}", headers=player)
    assert response.status_code == 204

    assert fake_storage == {}
    rid = uuid.UUID(room_id)
    for model in (RoomRow, MembershipRow, InvitationRow, TagRow, DocumentRow, AuditLogRow):
        assert await _count(db_session, model, rid) == 0, model.__name__
    leftover = await db_session.execute(
        select(func.count())
        .select_from(DocumentImageRow)
        .where(DocumentImageRow.document_id.in_([uuid.UUID(first["id"]), uuid.UUID(second["id"])]))
    )
    assert leftover.scalar_one() == 0

    gone = await client.get(f"/rooms/{room_id}", headers=master)
    assert gone.status_code == 403


async def test_an_empty_room_can_be_deleted(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """No Documents, no images: nothing to queue for Storage."""
    master = _auth_headers(make_token(str(uuid.uuid4())))
    room = (await client.post("/rooms", json={"name": "Empty"}, headers=master)).json()

    response = await client.delete(f"/rooms/{room['id']}", headers=master)

    assert response.status_code == 204
    assert await _count(db_session, RoomRow, uuid.UUID(room["id"])) == 0


async def test_a_master_who_is_not_an_administrator_cannot_delete_the_room(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """The Master alone isn't enough (spec 13)."""
    admin = _auth_headers(make_token(str(uuid.uuid4())))
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=admin)).json()
    other, other_id = await _join(client, make_token, room["id"], admin)
    await client.patch(
        f"/rooms/{room['id']}/members/{other_id}", json={"role": "master"}, headers=admin
    )

    response = await client.delete(f"/rooms/{room['id']}", headers=other)

    assert response.status_code == 403
    assert await _count(db_session, RoomRow, uuid.UUID(room["id"])) == 1


async def test_a_player_cannot_delete_the_room(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """A plain member is refused and nothing is deleted."""
    master = _auth_headers(make_token(str(uuid.uuid4())))
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master)).json()
    player, _ = await _join(client, make_token, room["id"], master)

    response = await client.delete(f"/rooms/{room['id']}", headers=player)

    assert response.status_code == 403
    assert await _count(db_session, RoomRow, uuid.UUID(room["id"])) == 1


async def test_a_non_member_cannot_delete_the_room(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Same answer as the other Room routes."""
    master = _auth_headers(make_token(str(uuid.uuid4())))
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master)).json()
    stranger = _auth_headers(make_token(str(uuid.uuid4())))

    response = await client.delete(f"/rooms/{room['id']}", headers=stranger)

    assert response.status_code == 403
    assert await _count(db_session, RoomRow, uuid.UUID(room["id"])) == 1


async def test_deleting_a_room_leaves_other_rooms_alone(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    """Only this Room's rows and images go."""
    master = _auth_headers(make_token(str(uuid.uuid4())))
    doomed = (await client.post("/rooms", json={"name": "Doomed"}, headers=master)).json()
    kept = (await client.post("/rooms", json={"name": "Kept"}, headers=master)).json()
    for room in (doomed, kept):
        document = (
            await client.post(
                f"/rooms/{room['id']}/documents", json={"name": "Doc"}, headers=master
            )
        ).json()
        await client.post(
            f"/rooms/{room['id']}/documents/{document['id']}/images",
            files={"file": ("a.png", _png(), "image/png")},
            headers=master,
        )
    assert len(fake_storage) == 2

    await client.delete(f"/rooms/{doomed['id']}", headers=master)

    assert len(fake_storage) == 1
    assert await _count(db_session, DocumentRow, uuid.UUID(kept["id"])) == 1
    assert await _count(db_session, TagRow, uuid.UUID(kept["id"])) > 0

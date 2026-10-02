"""Unread replies (spec 19b): `POST .../read`, the detail's `last_read_at` and
the list's `unread_count`."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DocumentReadRow
from app.main import app


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@dataclass
class _Member:
    id: str
    headers: dict[str, str]


@dataclass
class _Room:
    id: str
    master: _Member
    player: _Member
    other_player: _Member

    @property
    def documents_url(self) -> str:
        return f"/rooms/{self.id}/documents"

    def read_url(self, document_id: str) -> str:
        return f"{self.documents_url}/{document_id}/read"

    def comments_url(self, document_id: str) -> str:
        return f"{self.documents_url}/{document_id}/comments"


def _new_member(make_token: Callable[..., str]) -> _Member:
    user_id = str(uuid.uuid4())
    return _Member(id=user_id, headers={"Authorization": f"Bearer {make_token(user_id)}"})


async def _join(client: AsyncClient, room_id: str, master: _Member, member: _Member) -> None:
    invite = (
        await client.post(
            f"/rooms/{room_id}/invitations", json={"role": "player"}, headers=master.headers
        )
    ).json()
    response = await client.post(f"/invitations/{invite['code']}/accept", headers=member.headers)
    assert response.status_code in (200, 201), response.text


async def _room(client: AsyncClient, make_token: Callable[..., str]) -> _Room:
    master = _new_member(make_token)
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master.headers)).json()
    player = _new_member(make_token)
    other_player = _new_member(make_token)
    await _join(client, room["id"], master, player)
    await _join(client, room["id"], master, other_player)
    return _Room(id=room["id"], master=master, player=player, other_player=other_player)


async def _document(client: AsyncClient, room: _Room, visibility: str = "room") -> str:
    response = await client.post(
        room.documents_url,
        json={"name": "Castle Ravenloft", "visibility": visibility},
        headers=room.master.headers,
    )
    assert response.status_code == 201
    return str(response.json()["id"])


async def _comment(
    client: AsyncClient, room: _Room, document_id: str, author: _Member, **fields: object
) -> str:
    response = await client.post(
        room.comments_url(document_id),
        json={"body": "A cold wind blows.", **fields},
        headers=author.headers,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _read(client: AsyncClient, room: _Room, document_id: str, member: _Member) -> None:
    response = await client.post(room.read_url(document_id), headers=member.headers)
    assert response.status_code == 200, response.text


async def _unread(
    client: AsyncClient, room: _Room, document_id: str, member: _Member
) -> int | None:
    listed = (await client.get(room.documents_url, headers=member.headers)).json()
    count: int | None = next(d for d in listed if d["id"] == document_id)["unread_count"]
    return count


async def test_a_new_reply_shows_on_the_card_until_the_document_is_opened(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    # The ticket's Definition of Done: one member replies, the other sees
    # "1", opens the Document and the count is gone.
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    top = await _comment(client, room, document_id, room.player)
    await _read(client, room, document_id, room.other_player)

    reply = await _comment(client, room, document_id, room.player, parent_id=top)
    assert await _unread(client, room, document_id, room.other_player) == 1

    detail = (
        await client.get(f"{room.documents_url}/{document_id}", headers=room.other_player.headers)
    ).json()
    created = next(
        c
        for c in (
            await client.get(room.comments_url(document_id), headers=room.other_player.headers)
        ).json()
        if c["id"] == reply
    )["created_at"]
    # The page marks as "New" what was created after `last_read_at`.
    assert detail["last_read_at"] < created

    await _read(client, room, document_id, room.other_player)
    assert await _unread(client, room, document_id, room.other_player) == 0


async def test_a_document_never_opened_has_no_count(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    await _comment(client, room, document_id, room.master)

    assert await _unread(client, room, document_id, room.player) is None
    detail = (
        await client.get(f"{room.documents_url}/{document_id}", headers=room.player.headers)
    ).json()
    assert detail["last_read_at"] is None


async def test_own_posts_are_never_counted(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    await _read(client, room, document_id, room.player)

    await _comment(client, room, document_id, room.player)

    assert await _unread(client, room, document_id, room.player) == 0


async def test_a_master_only_reply_is_never_counted_for_a_player(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    top = await _comment(client, room, document_id, room.master)
    await _read(client, room, document_id, room.player)
    await _read(client, room, document_id, room.master)

    # A Player's reply for the Master's eyes only (VR-02), and a Private one.
    await _comment(client, room, document_id, room.other_player, parent_id=top, visibility="master")
    await _comment(client, room, document_id, room.other_player, visibility="private")

    # VR-07: nothing the Player can't read shows in their count, while the
    # Master counts everything (VR-01).
    assert await _unread(client, room, document_id, room.player) == 0
    assert await _unread(client, room, document_id, room.master) == 2


async def test_a_reply_under_a_hidden_comment_is_not_counted(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    top = await _comment(client, room, document_id, room.master)
    await _read(client, room, document_id, room.player)
    await _comment(client, room, document_id, room.other_player, parent_id=top)
    assert await _unread(client, room, document_id, room.player) == 1

    # The Master narrows the top Comment: its branch, and so the count, is
    # hidden from the Player (spec 19 effective visibility).
    response = await client.patch(
        f"{room.comments_url(document_id)}/{top}",
        json={"visibility": "master"},
        headers=room.master.headers,
    )
    assert response.status_code == 200, response.text

    assert await _unread(client, room, document_id, room.player) == 0


async def test_reading_again_returns_the_previous_visit(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)

    first = (await client.post(room.read_url(document_id), headers=room.player.headers)).json()
    second = (await client.post(room.read_url(document_id), headers=room.player.headers)).json()

    assert first["previous_read_at"] is None
    assert second["previous_read_at"] == first["last_read_at"]
    assert second["last_read_at"] > first["last_read_at"]


async def test_reading_a_hidden_document_is_not_found(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, visibility="master")

    response = await client.post(room.read_url(document_id), headers=room.player.headers)

    assert response.status_code == 404


async def test_reading_requires_membership(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    outsider = _new_member(make_token)

    response = await client.post(room.read_url(document_id), headers=outsider.headers)

    assert response.status_code == 403


async def test_leaving_the_room_drops_the_members_reads(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    await _read(client, room, document_id, room.player)
    await _read(client, room, document_id, room.other_player)

    response = await client.delete(
        f"/rooms/{room.id}/members/{room.player.id}", headers=room.player.headers
    )
    assert response.status_code == 204

    readers = (
        await db_session.execute(
            select(DocumentReadRow.user_id).where(
                DocumentReadRow.document_id == uuid.UUID(document_id)
            )
        )
    ).scalars()
    assert set(readers) == {uuid.UUID(room.other_player.id)}

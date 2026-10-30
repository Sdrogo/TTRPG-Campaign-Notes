"""The Room stream (spec 52_1): map and Document events reach only the
members who may know the object exists, before or after the write."""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.realtime.audience import comment_audience, push
from app.realtime.broker import Event, broker


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

    @property
    def url(self) -> str:
        return f"/rooms/{self.id}"


def _member(make_token: Callable[..., str]) -> _Member:
    user_id = str(uuid.uuid4())
    return _Member(id=user_id, headers={"Authorization": f"Bearer {make_token(user_id)}"})


async def _room(client: AsyncClient, make_token: Callable[..., str]) -> _Room:
    master = _member(make_token)
    room = (await client.post("/rooms", json={"name": "Ravnica"}, headers=master.headers)).json()
    player = _member(make_token)
    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations", json={"role": "player"}, headers=master.headers
        )
    ).json()
    await client.post(f"/invitations/{invite['code']}/accept", headers=player.headers)
    return _Room(id=room["id"], master=master, player=player)


async def _listen(client: AsyncClient, room: _Room, member: _Member) -> "asyncio.Task[Response]":
    """Opens `member`'s Room stream; returns once it is subscribed. The test
    transport hands the body over only when the stream ends, so each test
    closes the streams before reading them."""
    room_id = uuid.UUID(room.id)
    before = broker.count(room_id)
    task = asyncio.create_task(client.get(f"{room.url}/events", headers=member.headers))
    async with asyncio.timeout(5):
        while broker.count(room_id) == before:
            await asyncio.sleep(0.01)
    return task


async def _heard(room: _Room, *tasks: "asyncio.Task[Response]") -> list[list[dict[str, Any]]]:
    broker.disconnect(uuid.UUID(room.id))
    heard = []
    for task in tasks:
        async with asyncio.timeout(5):
            response = await task
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        heard.append(
            [
                json.loads(line.removeprefix("data: "))
                for line in response.text.splitlines()
                if line.startswith("data: ")
            ]
        )
    return heard


async def _map(client: AsyncClient, room: _Room, **fields: Any) -> dict[str, Any]:
    response = await client.post(
        f"{room.url}/maps", json={"name": "Guildpact", **fields}, headers=room.master.headers
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def _document(client: AsyncClient, room: _Room, visibility: str = "room") -> str:
    response = await client.post(
        f"{room.url}/documents",
        json={"name": "Niv-Mizzet", "visibility": visibility},
        headers=room.master.headers,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def _map_event(map_id: str, revision: int, kind: str = "changed") -> dict[str, Any]:
    return {"topic": "map", "revision": revision, "kind": kind, "id": map_id}


def _document_event(document_id: str, kind: str = "changed") -> dict[str, Any]:
    return {"topic": "document", "revision": None, "kind": kind, "id": document_id}


async def test_map_writes_reach_who_sees_the_map(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    shared = await _map(client, room, visibility="room")
    hidden = await _map(client, room, visibility="master")
    master = await _listen(client, room, room.master)
    player = await _listen(client, room, room.player)

    renamed = await client.patch(
        f"{room.url}/maps/{shared['id']}", json={"name": "Izzet"}, headers=room.master.headers
    )
    board = await client.patch(
        f"{room.url}/maps/{shared['id']}/board", json={}, headers=room.master.headers
    )
    secret = await client.patch(
        f"{room.url}/maps/{hidden['id']}/board", json={}, headers=room.master.headers
    )

    shared_events = [
        _map_event(shared["id"], renamed.json()["revision"]),
        _map_event(shared["id"], board.json()["revision"]),
    ]
    heard_master, heard_player = await _heard(room, master, player)
    assert heard_player == shared_events
    assert heard_master == [*shared_events, _map_event(hidden["id"], secret.json()["revision"])]


async def test_a_member_who_loses_a_map_hears_it_go(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    shared = await _map(client, room, visibility="room")
    player = await _listen(client, room, room.player)

    hidden = await client.patch(
        f"{room.url}/maps/{shared['id']}",
        json={"visibility": "master"},
        headers=room.master.headers,
    )
    # Hidden from them now: later writes are none of their business.
    await client.patch(
        f"{room.url}/maps/{shared['id']}/board", json={}, headers=room.master.headers
    )
    deleted = await client.delete(f"{room.url}/maps/{shared['id']}", headers=room.master.headers)
    assert deleted.status_code == 204

    (heard,) = await _heard(room, player)
    assert heard == [_map_event(shared["id"], hidden.json()["revision"])]


async def test_a_deleted_map_is_announced(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    shared = await _map(client, room, visibility="room")
    player = await _listen(client, room, room.player)

    await client.delete(f"{room.url}/maps/{shared['id']}", headers=room.master.headers)

    (heard,) = await _heard(room, player)
    assert heard == [_map_event(shared["id"], shared["revision"], "deleted")]


async def test_geographic_map_writes_are_announced(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    geo = await _map(client, room, kind="geographic", visibility="room")
    player = await _listen(client, room, room.player)

    saved = await client.patch(
        f"{room.url}/maps/{geo['id']}/geo", json={}, headers=room.master.headers
    )
    assert saved.status_code == 200, saved.text
    removed = await client.delete(
        f"{room.url}/maps/{geo['id']}/background", headers=room.master.headers
    )
    assert removed.status_code == 200, removed.text

    (heard,) = await _heard(room, player)
    assert heard == [
        _map_event(geo["id"], saved.json()["revision"]),
        _map_event(geo["id"], removed.json()["revision"]),
    ]


async def test_document_writes_reach_who_sees_the_document(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    shared = await _document(client, room)
    secret = await _document(client, room, visibility="master")
    master = await _listen(client, room, room.master)
    player = await _listen(client, room, room.player)

    for document_id in (shared, secret):
        response = await client.patch(
            f"{room.url}/documents/{document_id}",
            json={"subtitle": "Firemind"},
            headers=room.master.headers,
        )
        assert response.status_code == 200, response.text

    heard_master, heard_player = await _heard(room, master, player)
    assert heard_player == [_document_event(shared)]
    assert heard_master == [_document_event(shared), _document_event(secret)]


async def test_revealing_hiding_and_deleting_a_document_are_announced(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, visibility="master")
    player = await _listen(client, room, room.player)

    revealed = await client.post(
        f"{room.url}/documents/{document_id}/reveal",
        json={"to_room": True},
        headers=room.master.headers,
    )
    assert revealed.status_code == 200, revealed.text
    hidden = await client.patch(
        f"{room.url}/documents/{document_id}",
        json={"visibility": "master"},
        headers=room.master.headers,
    )
    assert hidden.status_code == 200, hidden.text
    # Hidden from the Player: they don't hear of it being deleted.
    await client.delete(f"{room.url}/documents/{document_id}", headers=room.master.headers)

    (heard,) = await _heard(room, player)
    assert heard == [_document_event(document_id), _document_event(document_id)]


async def test_a_deleted_document_is_announced_to_who_saw_it(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    player = await _listen(client, room, room.player)

    await client.delete(f"{room.url}/documents/{document_id}", headers=room.master.headers)

    (heard,) = await _heard(room, player)
    assert heard == [_document_event(document_id, "deleted")]


async def test_an_owner_removed_from_a_private_document_hears_it_go(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, visibility="private")
    added = await client.post(
        f"{room.url}/documents/{document_id}/owners/{room.player.id}", headers=room.master.headers
    )
    assert added.status_code == 201, added.text
    player = await _listen(client, room, room.player)

    removed = await client.delete(
        f"{room.url}/documents/{document_id}/owners/{room.player.id}",
        headers=room.master.headers,
    )
    assert removed.status_code == 204

    (heard,) = await _heard(room, player)
    assert heard == [_document_event(document_id)]


def _comments_event(document_id: str) -> dict[str, Any]:
    return {"topic": "comments", "revision": None, "kind": "changed", "id": document_id}


async def _comment(
    client: AsyncClient, room: _Room, document_id: str, author: _Member, visibility: str
) -> str:
    response = await client.post(
        f"{room.url}/documents/{document_id}/comments",
        json={"body": "Ballots, not blades", "visibility": visibility},
        headers=author.headers,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def test_comment_writes_reach_who_sees_the_comment(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Spec 52_3: the event names the Document, never the Comment."""
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    master = await _listen(client, room, room.master)
    player = await _listen(client, room, room.player)

    shared = await _comment(client, room, document_id, room.master, "room")
    await _comment(client, room, document_id, room.master, "master")
    reacted = await client.put(
        f"{room.url}/documents/{document_id}/comments/{shared}/reactions/%F0%9F%94%A5",
        headers=room.player.headers,
    )
    assert reacted.status_code == 200, reacted.text

    heard_master, heard_player = await _heard(room, master, player)
    assert heard_player == [_comments_event(document_id)] * 2
    assert heard_master == [_comments_event(document_id)] * 3


async def test_a_member_who_loses_a_comment_hears_it_go(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment_id = await _comment(client, room, document_id, room.master, "room")
    player = await _listen(client, room, room.player)

    hidden = await client.patch(
        f"{room.url}/documents/{document_id}/comments/{comment_id}",
        json={"visibility": "master"},
        headers=room.master.headers,
    )
    assert hidden.status_code == 200, hidden.text
    deleted = await client.delete(
        f"{room.url}/documents/{document_id}/comments/{comment_id}", headers=room.master.headers
    )
    assert deleted.status_code == 204, deleted.text

    (heard,) = await _heard(room, player)
    assert heard == [_comments_event(document_id)]


async def test_comments_on_a_hidden_document_stay_unheard(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, visibility="master")
    player = await _listen(client, room, room.player)

    await _comment(client, room, document_id, room.master, "room")

    (heard,) = await _heard(room, player)
    assert heard == []


async def test_nobody_sees_a_comment_that_is_not_there(db_session: AsyncSession) -> None:
    assert await comment_audience(db_session, uuid.uuid4(), uuid.uuid4()) == set()


async def test_only_members_open_the_room_stream(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    stranger = _member(make_token)
    assert (await client.get(f"{room.url}/events", headers=stranger.headers)).status_code == 403
    assert (await client.get(f"{room.url}/events")).status_code == 401


async def test_nothing_is_sent_to_nobody(db_session: AsyncSession) -> None:
    room_id = uuid.uuid4()
    stream = broker.subscribe(room_id, uuid.uuid4())
    try:
        push(db_session, room_id, Event(None, "changed"), set())
        assert db_session.info.get("after_commit", []) == []
    finally:
        broker.unsubscribe(stream)

"""View as a member (FR-V3, spec 22b): the Master previews the Room read-only
with one member's visibility through the `X-View-As` header."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models import Membership, RoomRole
from app.domain.view_as import (
    OnlyMasterViewsAsError,
    ViewAsNotAMemberError,
    ViewAsReadOnlyError,
    ensure_can_view_as,
    ensure_read_only,
)
from app.main import app


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@dataclass
class _Member:
    id: str
    headers: dict[str, str]

    def viewing_as(self, other: "_Member | str") -> dict[str, str]:
        target = other if isinstance(other, str) else other.id
        return {**self.headers, "X-View-As": target}


async def _member(client: AsyncClient, make_token: Callable[..., str]) -> _Member:
    user_id = str(uuid.uuid4())
    return _Member(id=user_id, headers={"Authorization": f"Bearer {make_token(user_id)}"})


async def _join(client: AsyncClient, room_id: str, master: _Member, member: _Member) -> None:
    invite = (
        await client.post(
            f"/rooms/{room_id}/invitations", json={"role": "player"}, headers=master.headers
        )
    ).json()
    await client.post(f"/invitations/{invite['code']}/accept", headers=member.headers)


async def _post(client: AsyncClient, url: str, by: _Member, **body: Any) -> dict[str, Any]:
    response = await client.post(url, json=body, headers=by.headers)
    assert response.status_code in (200, 201), response.text
    result: dict[str, Any] = response.json()
    return result


@dataclass
class _Room:
    id: str
    master: _Member
    alice: _Member
    bob: _Member

    @property
    def documents(self) -> str:
        return f"/rooms/{self.id}/documents"


async def _room(client: AsyncClient, make_token: Callable[..., str]) -> _Room:
    master = await _member(client, make_token)
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master.headers)).json()
    alice = await _member(client, make_token)
    bob = await _member(client, make_token)
    for member in (alice, bob):
        await _join(client, room["id"], master, member)
    return _Room(room["id"], master, alice, bob)


async def test_the_master_sees_the_room_as_a_player(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    """Definition of Done: Master-only content is gone, revealed content is
    there, on every list, detail, Thread and backlink."""
    room = await _room(client, make_token)
    shared = await _post(client, room.documents, room.master, name="Village", visibility="room")
    secret = await _post(client, room.documents, room.master, name="Strahd", visibility="master")
    revealed = await _post(client, room.documents, room.master, name="Ireena", visibility="master")
    await _post(client, f"{room.documents}/{revealed['id']}/reveal", room.master, to_room=True)
    shared_url = f"{room.documents}/{shared['id']}"
    await _post(client, f"{shared_url}/notes", room.master, title="Hidden", visibility="master")
    await _post(client, f"{shared_url}/notes", room.master, title="Open", visibility="room")
    await _post(client, f"{shared_url}/comments", room.master, body="Psst", visibility="master")
    await _post(client, f"{shared_url}/comments", room.bob, body="Hi", visibility="room")
    # The secret Document mentions the shared one: its backlink is hidden too.
    await client.patch(
        f"{room.documents}/{secret['id']}",
        json={"description": f"Lives near #[Village](doc:{shared['id']})"},
        headers=room.master.headers,
    )
    as_alice = room.master.viewing_as(room.alice)

    listed = (await client.get(room.documents, headers=as_alice)).json()
    assert {d["name"] for d in listed} == {"Village", "Ireena"}
    own = (await client.get(room.documents, headers=room.master.headers)).json()
    assert {d["name"] for d in own} == {"Village", "Strahd", "Ireena"}

    hidden = await client.get(f"{room.documents}/{secret['id']}", headers=as_alice)
    assert hidden.status_code == 404
    detail = (await client.get(shared_url, headers=as_alice)).json()
    assert [n["title"] for n in detail["notes"]] == ["Open"]
    thread = (await client.get(f"{shared_url}/comments", headers=as_alice)).json()
    assert [c["body"] for c in thread] == ["Hi"]
    backlinks = await client.get(f"{shared_url}/backlinks", headers=as_alice)
    assert backlinks.status_code == 200
    assert backlinks.json() == []
    master_backlinks = await client.get(f"{shared_url}/backlinks", headers=room.master.headers)
    assert len(master_backlinks.json()) == 1


async def test_viewing_as_writes_nothing(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    """Decision 3: every write is refused while the header is set, inside
    a Room or not."""
    room = await _room(client, make_token)
    as_alice = room.master.viewing_as(room.alice)

    created = await client.post(room.documents, json={"name": "X"}, headers=as_alice)
    assert created.status_code == 403
    assert created.json()["detail"] == "Nothing can be changed while viewing as another member"
    outside = await client.post("/friends/requests", json={"code": "nope"}, headers=as_alice)
    assert outside.status_code == 403
    listed = (await client.get(room.documents, headers=room.master.headers)).json()
    assert listed == []


async def test_who_may_view_as_whom(client: AsyncClient, make_token: Callable[..., str]) -> None:
    """Decision 2: only the Master, only in their own Room, only for its
    current members."""
    room = await _room(client, make_token)
    outsider = await _member(client, make_token)

    async def status(headers: dict[str, str]) -> int:
        return (await client.get(room.documents, headers=headers)).status_code

    assert await status(room.alice.viewing_as(room.bob)) == 403
    assert await status(room.master.viewing_as(outsider)) == 403
    assert await status(room.master.viewing_as("not-a-uuid")) == 403
    assert await status(outsider.viewing_as(room.alice)) == 403
    assert await status(room.master.viewing_as(room.master)) == 200

    # Leaving the Room ends it.
    await client.delete(f"/rooms/{room.id}/members/{room.bob.id}", headers=room.master.headers)
    assert await status(room.master.viewing_as(room.bob)) == 403


async def test_routes_outside_a_room_ignore_the_header(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    room = await _room(client, make_token)

    rooms = await client.get("/rooms", headers=room.master.viewing_as(room.alice))
    assert rooms.status_code == 200
    assert [r["role"] for r in rooms.json()] == ["master"]
    malformed = await client.get(
        "/rooms/not-a-room/documents", headers=room.master.viewing_as(room.alice)
    )
    assert malformed.status_code == 422


def _membership(role: RoomRole, room_id: uuid.UUID) -> Membership:
    return Membership(uuid.uuid4(), room_id, uuid.uuid4(), role, is_admin=False)


def test_the_view_as_rules() -> None:
    room_id = uuid.uuid4()
    master = _membership(RoomRole.MASTER, room_id)
    player = _membership(RoomRole.PLAYER, room_id)

    assert ensure_can_view_as(master, player) is player
    with pytest.raises(OnlyMasterViewsAsError):
        ensure_can_view_as(player, master)
    with pytest.raises(ViewAsNotAMemberError):
        ensure_can_view_as(master, None)
    with pytest.raises(ViewAsNotAMemberError):
        ensure_can_view_as(master, _membership(RoomRole.PLAYER, uuid.uuid4()))

    ensure_read_only("get")
    ensure_read_only("HEAD")
    with pytest.raises(ViewAsReadOnlyError):
        ensure_read_only("PATCH")

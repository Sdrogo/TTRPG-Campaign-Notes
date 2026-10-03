import uuid
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import InvitationRow
from app.main import app


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


class _User:
    def __init__(self, make_token: Callable[..., str], name: str) -> None:
        self.id = str(uuid.uuid4())
        self.headers = {
            "Authorization": f"Bearer {make_token(self.id, email=f'{name}@example.com')}"
        }


async def _room(client: AsyncClient, admin: _User) -> str:
    response = await client.post("/rooms", json={"name": "Barovia"}, headers=admin.headers)
    room_id: str = response.json()["id"]
    return room_id


async def _befriend(client: AsyncClient, a: _User, b: _User) -> None:
    """Friends through b's Friend code, so they share no Room."""
    code = (await client.get("/account/friend-code", headers=b.headers)).json()["code"]
    sent = await client.post("/friends/requests", json={"code": code}, headers=a.headers)
    friendship_id = sent.json()["friendship_id"]
    accepted = await client.post(f"/friends/requests/{friendship_id}/accept", headers=b.headers)
    assert accepted.status_code == 200


async def _invite(
    client: AsyncClient, room_id: str, sender: _User, invitee: _User, role: str = "player"
) -> Any:
    return await client.post(
        f"/rooms/{room_id}/invitations/direct",
        json={"user_id": invitee.id, "role": role},
        headers=sender.headers,
    )


async def _mine(client: AsyncClient, user: _User) -> list[dict[str, Any]]:
    response = await client.get("/invitations/mine", headers=user.headers)
    assert response.status_code == 200
    body: list[dict[str, Any]] = response.json()
    return body


async def _member_ids(client: AsyncClient, room_id: str, viewer: _User) -> set[str]:
    members = (await client.get(f"/rooms/{room_id}/members", headers=viewer.headers)).json()
    return {member["user_id"] for member in members}


async def test_friend_joins_only_after_accepting(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    # Spec 18 Definition of Done: two Friends, one adds the other to a new
    # Room, and the other joins after accepting (D-26, FR-F5).
    alice, bob = _User(make_token, "alice"), _User(make_token, "bob")
    await _befriend(client, alice, bob)
    room_id = await _room(client, alice)

    response = await _invite(client, room_id, alice, bob, role="master")
    assert response.status_code == 201
    sent = response.json()
    assert sent["invitee_user_id"] == bob.id
    assert sent["role"] == "master"
    # A pending invitation never makes someone a member.
    assert bob.id not in await _member_ids(client, room_id, alice)

    mine = await _mine(client, bob)
    assert len(mine) == 1
    assert mine[0]["code"] == sent["code"]
    assert mine[0]["room"]["id"] == room_id
    assert mine[0]["room"]["name"] == "Barovia"
    assert mine[0]["invited_by"]["user_id"] == alice.id
    # They share no Room yet, so the sender's email stays hidden (NFR-03).
    assert mine[0]["invited_by"]["email"] is None

    accepted = await client.post(f"/invitations/{sent['code']}/accept", headers=bob.headers)
    assert accepted.status_code == 200
    members = (await client.get(f"/rooms/{room_id}/members", headers=alice.headers)).json()
    roles = {member["user_id"]: member["role"] for member in members}
    assert roles[bob.id] == "master"
    # Joined, so it's no longer something to answer.
    assert await _mine(client, bob) == []


async def test_only_the_invitee_can_accept(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob, mallory = (_User(make_token, n) for n in ("alice", "bob", "mallory"))
    await _befriend(client, alice, bob)
    room_id = await _room(client, alice)
    code = (await _invite(client, room_id, alice, bob)).json()["code"]

    stolen = await client.post(f"/invitations/{code}/accept", headers=mallory.headers)
    assert stolen.status_code == 404
    assert mallory.id not in await _member_ids(client, room_id, alice)
    assert await _mine(client, mallory) == []


async def test_only_a_friend_can_be_invited(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, stranger = _User(make_token, "alice"), _User(make_token, "stranger")
    room_id = await _room(client, alice)

    response = await _invite(client, room_id, alice, stranger)
    assert response.status_code == 403
    assert await _mine(client, stranger) == []


async def test_a_pending_friend_request_is_not_enough(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob = _User(make_token, "alice"), _User(make_token, "bob")
    code = (await client.get("/account/friend-code", headers=bob.headers)).json()["code"]
    await client.post("/friends/requests", json={"code": code}, headers=alice.headers)
    room_id = await _room(client, alice)

    assert (await _invite(client, room_id, alice, bob)).status_code == 403


async def test_only_an_administrator_invites(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob, carol = (_User(make_token, n) for n in ("alice", "bob", "carol"))
    room_id = await _room(client, alice)
    link = (
        await client.post(
            f"/rooms/{room_id}/invitations", json={"role": "player"}, headers=alice.headers
        )
    ).json()
    await client.post(f"/invitations/{link['code']}/accept", headers=bob.headers)
    await _befriend(client, bob, carol)

    assert (await _invite(client, room_id, bob, carol)).status_code == 403
    outsider_room = await _room(client, carol)
    assert (await _invite(client, outsider_room, bob, carol)).status_code == 403


async def test_a_member_cannot_be_invited_again(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob = _User(make_token, "alice"), _User(make_token, "bob")
    await _befriend(client, alice, bob)
    room_id = await _room(client, alice)
    code = (await _invite(client, room_id, alice, bob)).json()["code"]
    await client.post(f"/invitations/{code}/accept", headers=bob.headers)

    assert (await _invite(client, room_id, alice, bob)).status_code == 409


async def test_a_new_invitation_replaces_the_open_one(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob = _User(make_token, "alice"), _User(make_token, "bob")
    await _befriend(client, alice, bob)
    room_id = await _room(client, alice)
    first = (await _invite(client, room_id, alice, bob, role="player")).json()["code"]
    second = (await _invite(client, room_id, alice, bob, role="master")).json()["code"]

    mine = await _mine(client, bob)
    assert [(entry["code"], entry["role"]) for entry in mine] == [(second, "master")]
    assert (
        await client.post(f"/invitations/{first}/accept", headers=bob.headers)
    ).status_code == 410


async def test_expired_invitations_are_not_listed(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob = _User(make_token, "alice"), _User(make_token, "bob")
    await _befriend(client, alice, bob)
    room_id = await _room(client, alice)
    code = (await _invite(client, room_id, alice, bob)).json()["code"]
    await db_session.execute(
        update(InvitationRow)
        .where(InvitationRow.code == code)
        .values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
    )

    assert await _mine(client, bob) == []
    assert (
        await client.post(f"/invitations/{code}/accept", headers=bob.headers)
    ).status_code == 410


async def test_link_invitations_are_not_listed_and_still_work_for_anyone(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob = _User(make_token, "alice"), _User(make_token, "bob")
    room_id = await _room(client, alice)
    link = await client.post(
        f"/rooms/{room_id}/invitations", json={"role": "player"}, headers=alice.headers
    )
    assert link.json()["invitee_user_id"] is None

    assert await _mine(client, bob) == []
    accepted = await client.post(f"/invitations/{link.json()['code']}/accept", headers=bob.headers)
    assert accepted.status_code == 200


async def test_sender_email_stays_hidden_when_they_share_a_room(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob = _User(make_token, "alice"), _User(make_token, "bob")
    await _befriend(client, alice, bob)
    first_room = await _room(client, alice)
    code = (await _invite(client, first_room, alice, bob)).json()["code"]
    await client.post(f"/invitations/{code}/accept", headers=bob.headers)

    second_room = await _room(client, alice)
    await _invite(client, second_room, alice, bob)
    mine = await _mine(client, bob)
    assert [entry["room"]["id"] for entry in mine] == [second_room]
    assert mine[0]["invited_by"]["email"] is None


async def test_invitee_declines_silently(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob, mallory = (_User(make_token, n) for n in ("alice", "bob", "mallory"))
    await _befriend(client, alice, bob)
    room_id = await _room(client, alice)
    code = (await _invite(client, room_id, alice, bob)).json()["code"]

    assert (
        await client.post(f"/invitations/{code}/decline", headers=mallory.headers)
    ).status_code == 404
    declined = await client.post(f"/invitations/{code}/decline", headers=bob.headers)
    assert declined.status_code == 204
    assert await _mine(client, bob) == []
    assert (
        await client.post(f"/invitations/{code}/accept", headers=bob.headers)
    ).status_code == 410
    assert (
        await client.post(f"/invitations/{code}/decline", headers=bob.headers)
    ).status_code == 410
    assert (await client.post("/invitations/nope/decline", headers=bob.headers)).status_code == 404
    # The sender may invite again.
    assert (await _invite(client, room_id, alice, bob)).status_code == 201
    assert len(await _mine(client, bob)) == 1


async def test_a_link_invitation_cannot_be_declined(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob = _User(make_token, "alice"), _User(make_token, "bob")
    room_id = await _room(client, alice)
    link = (
        await client.post(
            f"/rooms/{room_id}/invitations", json={"role": "player"}, headers=alice.headers
        )
    ).json()

    assert (
        await client.post(f"/invitations/{link['code']}/decline", headers=bob.headers)
    ).status_code == 404
    assert (
        await client.post(f"/invitations/{link['code']}/accept", headers=bob.headers)
    ).status_code == 200


async def test_removing_the_friendship_revokes_open_invitations_both_ways(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    # D-26: an invitation presumes the Friendship, so ending it revokes the
    # open direct invitations between the two, and only those.
    alice, bob, carol = (_User(make_token, n) for n in ("alice", "bob", "carol"))
    await _befriend(client, alice, bob)
    await _befriend(client, alice, carol)
    alice_room = await _room(client, alice)
    bob_room = await _room(client, bob)
    to_bob = (await _invite(client, alice_room, alice, bob)).json()["code"]
    assert (await _invite(client, bob_room, bob, alice)).status_code == 201
    assert (await _invite(client, alice_room, alice, carol)).status_code == 201

    removed = await client.delete(f"/friends/{alice.id}", headers=bob.headers)
    assert removed.status_code == 204

    assert await _mine(client, bob) == []
    assert await _mine(client, alice) == []
    assert len(await _mine(client, carol)) == 1
    accepted = await client.post(f"/invitations/{to_bob}/accept", headers=bob.headers)
    assert accepted.status_code == 410
    assert bob.id not in await _member_ids(client, alice_room, alice)


async def test_cancelling_a_friend_request_leaves_invitations_alone(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob, carol = (_User(make_token, n) for n in ("alice", "bob", "carol"))
    await _befriend(client, alice, carol)
    room_id = await _room(client, alice)
    assert (await _invite(client, room_id, alice, carol)).status_code == 201
    code = (await client.get("/account/friend-code", headers=bob.headers)).json()["code"]
    await client.post("/friends/requests", json={"code": code}, headers=alice.headers)

    cancelled = await client.delete(f"/friends/{bob.id}", headers=alice.headers)
    assert cancelled.status_code == 204
    assert len(await _mine(client, carol)) == 1

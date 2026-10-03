import uuid
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import friends_repo, users_repo
from app.db.models import FriendshipRow
from app.domain.friends import REQUEST_COOLDOWN, plan_friend_code, plan_request
from app.main import app


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


class _User:
    """A test user with their token, so calls read as `alice.post(...)`."""

    def __init__(self, client: AsyncClient, make_token: Callable[..., str], email: str) -> None:
        self.id = str(uuid.uuid4())
        self.email = email
        self._client = client
        self.headers = {"Authorization": f"Bearer {make_token(self.id, email=email)}"}

    async def get(self, path: str, **kwargs: Any) -> Response:
        return await self._client.get(path, headers=self.headers, **kwargs)

    async def post(self, path: str, **kwargs: Any) -> Response:
        return await self._client.post(path, headers=self.headers, **kwargs)

    async def delete(self, path: str) -> Response:
        return await self._client.delete(path, headers=self.headers)

    async def friends(self) -> dict[str, list[dict[str, Any]]]:
        response = await self.get("/friends")
        assert response.status_code == 200
        body: dict[str, list[dict[str, Any]]] = response.json()
        return body

    async def ids(self) -> dict[str, list[str]]:
        return {
            kind: [entry["user_id"] for entry in entries]
            for kind, entries in (await self.friends()).items()
        }

    async def ask(self, other: "_User") -> Response:
        return await self.post("/friends/requests", json={"user_id": other.id})

    async def code(self) -> str:
        response = await self.get("/account/friend-code")
        assert response.status_code == 200
        code: str = response.json()["code"]
        return code


def _user(client: AsyncClient, make_token: Callable[..., str], name: str) -> _User:
    return _User(client, make_token, f"{name}@example.com")


async def _share_a_room(owner: _User, *others: _User) -> str:
    room = (await owner.post("/rooms", json={"name": "Barovia"})).json()
    invite = (await owner.post(f"/rooms/{room['id']}/invitations", json={"role": "player"})).json()
    for other in others:
        response = await other.post(f"/invitations/{invite['code']}/accept")
        assert response.status_code == 200
    room_id: str = room["id"]
    return room_id


async def _pair(client: AsyncClient, make_token: Callable[..., str]) -> tuple[_User, _User]:
    alice = _user(client, make_token, "alice")
    bob = _user(client, make_token, "bob")
    await _share_a_room(alice, bob)
    return alice, bob


EMPTY: dict[str, list[str]] = {"friends": [], "incoming": [], "outgoing": []}


async def test_members_of_a_shared_room_become_friends(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob = await _pair(client, make_token)
    await client.patch("/account", json={"display_name": "Bob"}, headers=bob.headers)

    response = await alice.ask(bob)
    assert response.status_code == 201
    sent = response.json()
    assert sent["user_id"] == bob.id
    assert sent["display_name"] == "Bob"
    # NFR-03: no email, even though they share a Room.
    assert sent["email"] is None

    assert await alice.ids() == {**EMPTY, "outgoing": [bob.id]}
    incoming = (await bob.friends())["incoming"]
    assert [entry["user_id"] for entry in incoming] == [alice.id]

    accepted = await bob.post(f"/friends/requests/{incoming[0]['friendship_id']}/accept")
    assert accepted.status_code == 200
    assert accepted.json()["user_id"] == alice.id
    assert await alice.ids() == {**EMPTY, "friends": [bob.id]}
    assert await bob.ids() == {**EMPTY, "friends": [alice.id]}


async def test_request_by_user_id_needs_a_shared_room(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    # D-27: no directory, so a stranger's id is no way in.
    alice = _user(client, make_token, "alice")
    stranger = _user(client, make_token, "stranger")
    await _share_a_room(alice)

    response = await alice.ask(stranger)
    assert response.status_code == 403
    assert await stranger.ids() == EMPTY


async def test_request_body_takes_exactly_one_of_user_or_code(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob = await _pair(client, make_token)
    neither = await alice.post("/friends/requests", json={})
    both = await alice.post("/friends/requests", json={"user_id": bob.id, "code": "x"})
    assert neither.status_code == both.status_code == 422


async def test_cannot_befriend_yourself(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice = _user(client, make_token, "alice")
    response = await alice.post("/friends/requests", json={"code": await alice.code()})
    assert response.status_code == 422


async def test_friend_code_is_stable_until_regenerated(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice = _user(client, make_token, "alice")
    first = await alice.code()
    assert await alice.code() == first

    regenerated = await alice.post("/account/friend-code")
    assert regenerated.status_code == 201
    new_code = regenerated.json()["code"]
    assert new_code != first
    assert await alice.code() == new_code


async def test_code_request_reaches_a_stranger_without_their_email(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    # NFR-03: a Friend sharing no Room sees the profile, not the email.
    alice = _user(client, make_token, "alice")
    carol = _user(client, make_token, "carol")
    await client.patch("/account", json={"display_name": "Carol"}, headers=carol.headers)

    response = await alice.post("/friends/requests", json={"code": await carol.code()})
    assert response.status_code == 201
    assert response.json()["display_name"] == "Carol"
    assert response.json()["email"] is None

    incoming = (await carol.friends())["incoming"]
    assert [entry["user_id"] for entry in incoming] == [alice.id]
    assert incoming[0]["email"] is None


async def test_an_old_code_stops_working(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice = _user(client, make_token, "alice")
    carol = _user(client, make_token, "carol")
    old = await carol.code()
    await carol.post("/account/friend-code")

    response = await alice.post("/friends/requests", json={"code": old})
    assert response.status_code == 404
    unknown = await alice.post("/friends/requests", json={"code": "nope"})
    assert unknown.status_code == 404


async def test_no_duplicate_requests_either_way(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob = await _pair(client, make_token)
    await alice.ask(bob)

    assert (await alice.ask(bob)).status_code == 409
    assert (await bob.ask(alice)).status_code == 409
    assert (
        await alice.post("/friends/requests", json={"code": await bob.code()})
    ).status_code == 409

    incoming = (await bob.friends())["incoming"]
    await bob.post(f"/friends/requests/{incoming[0]['friendship_id']}/accept")
    assert (await bob.ask(alice)).status_code == 409


async def test_only_the_recipient_answers(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob = await _pair(client, make_token)
    mallory = _user(client, make_token, "mallory")
    friendship_id = (await alice.ask(bob)).json()["friendship_id"]

    assert (await alice.post(f"/friends/requests/{friendship_id}/accept")).status_code == 403
    assert (await mallory.post(f"/friends/requests/{friendship_id}/accept")).status_code == 404
    assert (await bob.post(f"/friends/requests/{uuid.uuid4()}/accept")).status_code == 404

    assert (await bob.post(f"/friends/requests/{friendship_id}/accept")).status_code == 200
    assert (await bob.post(f"/friends/requests/{friendship_id}/decline")).status_code == 409


async def test_errors_are_translated(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob = await _pair(client, make_token)
    friendship_id = (await alice.ask(bob)).json()["friendship_id"]
    response = await client.post(
        f"/friends/requests/{friendship_id}/accept",
        headers={**alice.headers, "Accept-Language": "it"},
    )
    assert response.json()["detail"] == "Solo chi ha ricevuto la richiesta può rispondere"


async def test_declining_is_silent_and_starts_the_cooldown(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob = await _pair(client, make_token)
    friendship_id = (await alice.ask(bob)).json()["friendship_id"]

    declined = await bob.post(f"/friends/requests/{friendship_id}/decline")
    assert declined.status_code == 204
    assert await bob.ids() == EMPTY
    # D-27: Alice is never told; her request still reads as pending.
    assert await alice.ids() == {**EMPTY, "outgoing": [bob.id]}
    assert (await alice.ask(bob)).status_code == 409
    assert (await alice.post(f"/friends/requests/{friendship_id}/accept")).status_code == 403
    # Bob declined, so he can't turn around and ask for 30 days.
    assert (await bob.ask(alice)).status_code == 409
    assert (await bob.post(f"/friends/requests/{friendship_id}/accept")).status_code == 404
    assert (await bob.delete(f"/friends/{alice.id}")).status_code == 404

    # Alice cancels: gone for her, but the row (and the cooldown) stays.
    assert (await alice.delete(f"/friends/{bob.id}")).status_code == 204
    assert await alice.ids() == EMPTY
    assert (await alice.delete(f"/friends/{bob.id}")).status_code == 404
    assert (await bob.ask(alice)).status_code == 409

    # Asking again inside the cooldown looks like a fresh request to Alice
    # and still reaches nobody.
    resent = await alice.ask(bob)
    assert resent.status_code == 201
    assert resent.json()["friendship_id"] == friendship_id
    assert await alice.ids() == {**EMPTY, "outgoing": [bob.id]}
    assert await bob.ids() == EMPTY


async def test_after_the_cooldown_either_user_may_ask_again(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob = await _pair(client, make_token)
    friendship_id = (await alice.ask(bob)).json()["friendship_id"]
    await bob.post(f"/friends/requests/{friendship_id}/decline")
    await db_session.execute(
        update(FriendshipRow)
        .where(FriendshipRow.id == uuid.UUID(friendship_id))
        .values(responded_at=datetime.now(UTC) - REQUEST_COOLDOWN - timedelta(minutes=1))
    )

    response = await bob.ask(alice)
    assert response.status_code == 201
    assert response.json()["friendship_id"] == friendship_id
    assert await alice.ids() == {**EMPTY, "incoming": [bob.id]}
    assert await bob.ids() == {**EMPTY, "outgoing": [alice.id]}
    # Now Alice is the recipient, so she is the one who answers.
    assert (await bob.post(f"/friends/requests/{friendship_id}/accept")).status_code == 403
    assert (await alice.post(f"/friends/requests/{friendship_id}/accept")).status_code == 200


async def test_sender_cancels_but_recipient_must_answer(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob = await _pair(client, make_token)
    await alice.ask(bob)

    assert (await bob.delete(f"/friends/{alice.id}")).status_code == 409
    assert (await alice.delete(f"/friends/{bob.id}")).status_code == 204
    assert await alice.ids() == EMPTY
    assert await bob.ids() == EMPTY
    # A cancelled request leaves no cooldown: it was never declined.
    assert (await alice.ask(bob)).status_code == 201


async def test_either_friend_removes_the_friendship(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    alice, bob = await _pair(client, make_token)
    friendship_id = (await alice.ask(bob)).json()["friendship_id"]
    await bob.post(f"/friends/requests/{friendship_id}/accept")

    assert (await bob.delete(f"/friends/{alice.id}")).status_code == 204
    assert await alice.ids() == EMPTY
    assert await bob.ids() == EMPTY
    assert (await alice.delete(f"/friends/{bob.id}")).status_code == 404


async def test_friendship_outlives_the_shared_room(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    # D-26: a Friendship isn't tied to a Room; only the email follows the
    # shared-Room audience.
    alice = _user(client, make_token, "alice")
    bob = _user(client, make_token, "bob")
    room_id = await _share_a_room(alice, bob)
    friendship_id = (await alice.ask(bob)).json()["friendship_id"]
    await bob.post(f"/friends/requests/{friendship_id}/accept")
    assert (await bob.delete(f"/rooms/{room_id}/members/{bob.id}")).status_code == 204

    friends = (await alice.friends())["friends"]
    assert [entry["user_id"] for entry in friends] == [bob.id]
    assert friends[0]["email"] is None


async def test_concurrent_first_codes_agree(db_session: AsyncSession) -> None:
    user_id = uuid.uuid4()
    now = datetime.now(UTC)
    first = await friends_repo.ensure_code(db_session, plan_friend_code(user_id, now))
    second = await friends_repo.ensure_code(db_session, plan_friend_code(user_id, now))
    assert first == second


async def test_repo_edge_cases(db_session: AsyncSession) -> None:
    alice, bob = uuid.uuid4(), uuid.uuid4()
    assert await friends_repo.get_between(db_session, alice, bob) is None
    assert await users_repo.get_profiles(db_session, []) == {}
    ghost = plan_request(
        alice, bob, None, via_code=True, shares_room=False, now=datetime.now(UTC)
    ).friendship
    with pytest.raises(LookupError):
        await friends_repo.save(db_session, ghost)

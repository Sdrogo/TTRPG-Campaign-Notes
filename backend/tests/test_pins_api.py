"""Pinned Comments and resolved branches (spec 19c Decisions 3-4, FR-T7):
`POST`/`DELETE .../comments/{id}/pin` and `/resolve`, and the `pinned_at`,
`resolved_at`, `resolved_by`, `can_pin` and `can_resolve` fields on every
Comment."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass

import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.comments import MAX_PINNED_PER_DOCUMENT
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
    """A Room with a Master, a Player who owns `document_id` and a Player
    who doesn't."""

    id: str
    master: _Member
    owner: _Member
    player: _Member
    document_id: str

    @property
    def comments_url(self) -> str:
        return f"/rooms/{self.id}/documents/{self.document_id}/comments"


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
    owner = _new_member(make_token)
    player = _new_member(make_token)
    await _join(client, room["id"], master, owner)
    await _join(client, room["id"], master, player)
    document = await client.post(
        f"/rooms/{room['id']}/documents",
        json={"name": "Castle Ravenloft"},
        headers=master.headers,
    )
    assert document.status_code == 201
    document_id = document.json()["id"]
    added = await client.post(
        f"/rooms/{room['id']}/documents/{document_id}/owners/{owner.id}",
        headers=master.headers,
    )
    assert added.status_code == 201, added.text
    return _Room(id=room["id"], master=master, owner=owner, player=player, document_id=document_id)


async def _comment(
    client: AsyncClient, room: _Room, author: _Member, **fields: object
) -> dict[str, object]:
    response = await client.post(
        room.comments_url, json={"body": "Who has the key?", **fields}, headers=author.headers
    )
    assert response.status_code == 201, response.text
    body: dict[str, object] = response.json()
    return body


async def _act(
    client: AsyncClient,
    room: _Room,
    comment_id: object,
    action: str,
    member: _Member,
    *,
    undo: bool = False,
) -> Response:
    url = f"{room.comments_url}/{comment_id}/{action}"
    if undo:
        return await client.delete(url, headers=member.headers)
    return await client.post(url, headers=member.headers)


async def _listed(client: AsyncClient, room: _Room, member: _Member) -> list[dict[str, object]]:
    response = await client.get(room.comments_url, headers=member.headers)
    assert response.status_code == 200
    listed: list[dict[str, object]] = response.json()
    return listed


async def test_an_owner_pins_and_unpins_a_comment_for_everyone(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    comment = await _comment(client, room, room.player)
    assert comment["pinned_at"] is None

    pinned = await _act(client, room, comment["id"], "pin", room.owner)

    assert pinned.status_code == 200, pinned.text
    assert pinned.json()["pinned_at"] is not None
    # Every viewer sees the pin.
    assert (await _listed(client, room, room.player))[0]["pinned_at"] == pinned.json()["pinned_at"]
    # Pinning again keeps the original time, so the order of pins holds.
    again = await _act(client, room, comment["id"], "pin", room.master)
    assert again.json()["pinned_at"] == pinned.json()["pinned_at"]

    unpinned = await _act(client, room, comment["id"], "pin", room.master, undo=True)
    assert unpinned.status_code == 200
    assert unpinned.json()["pinned_at"] is None
    # Unpinning what isn't pinned changes nothing.
    noop = await _act(client, room, comment["id"], "pin", room.owner, undo=True)
    assert noop.status_code == 200


async def test_only_an_owner_or_the_master_may_pin(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    # Not even the author, who isn't an Owner of the Document.
    comment = await _comment(client, room, room.player)

    for undo in (False, True):
        response = await _act(client, room, comment["id"], "pin", room.player, undo=undo)
        assert response.status_code == 403
        assert response.json()["detail"] == (
            "Only an Owner or the Master can pin this Document's Comments"
        )


async def test_a_document_holds_at_most_three_pinned_comments(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    comments = [
        await _comment(client, room, room.player) for _ in range(MAX_PINNED_PER_DOCUMENT + 1)
    ]
    for comment in comments[:MAX_PINNED_PER_DOCUMENT]:
        assert (await _act(client, room, comment["id"], "pin", room.owner)).status_code == 200

    refused = await _act(client, room, comments[-1]["id"], "pin", room.master)
    assert refused.status_code == 409
    assert refused.json()["detail"] == "A Document can have at most 3 pinned Comments"
    # Deleting a pinned Comment unpins it and frees its slot.
    deleted = await client.delete(
        f"{room.comments_url}/{comments[0]['id']}", headers=room.player.headers
    )
    assert deleted.status_code == 204
    assert (await _listed(client, room, room.master))[0]["pinned_at"] is None
    accepted = await _act(client, room, comments[-1]["id"], "pin", room.master)
    assert accepted.status_code == 200


async def test_a_reply_or_a_deleted_comment_cannot_be_pinned(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    parent = await _comment(client, room, room.player)
    reply = await _comment(client, room, room.player, parent_id=parent["id"])
    assert (reply["can_pin"], reply["can_resolve"]) == (False, False)

    response = await _act(client, room, reply["id"], "pin", room.owner)
    assert response.status_code == 422
    assert response.json()["detail"] == "Only a top-level Comment can be pinned"

    await client.delete(f"{room.comments_url}/{parent['id']}", headers=room.player.headers)
    response = await _act(client, room, parent["id"], "pin", room.owner)
    assert response.status_code == 409
    assert response.json()["detail"] == "This Comment was deleted"


async def test_the_author_resolves_and_reopens_their_branch(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    comment = await _comment(client, room, room.player)

    resolved = await _act(client, room, comment["id"], "resolve", room.player)

    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["resolved_by"] == room.player.id
    assert resolved.json()["resolved_at"] is not None
    # Resolving again keeps who resolved it first.
    again = await _act(client, room, comment["id"], "resolve", room.master)
    assert again.json()["resolved_by"] == room.player.id
    # A new reply doesn't reopen it (Decision 4).
    await _comment(client, room, room.master, parent_id=comment["id"])
    assert (await _listed(client, room, room.player))[0]["resolved_by"] == room.player.id

    reopened = await _act(client, room, comment["id"], "resolve", room.owner, undo=True)
    assert reopened.status_code == 200
    assert (reopened.json()["resolved_at"], reopened.json()["resolved_by"]) == (None, None)


async def test_only_the_author_an_owner_or_the_master_may_resolve(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    comment = await _comment(client, room, room.master)
    player_view = (await _listed(client, room, room.player))[0]
    owner_view = (await _listed(client, room, room.owner))[0]
    assert (player_view["can_pin"], player_view["can_resolve"]) == (False, False)
    assert (owner_view["can_pin"], owner_view["can_resolve"]) == (True, True)

    for undo in (False, True):
        response = await _act(client, room, comment["id"], "resolve", room.player, undo=undo)
        assert response.status_code == 403
        assert response.json()["detail"] == (
            "Only the author, an Owner or the Master can resolve this discussion"
        )


async def test_a_reply_cannot_be_resolved_on_its_own(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    parent = await _comment(client, room, room.master)
    reply = await _comment(client, room, room.player, parent_id=parent["id"])

    for undo in (False, True):
        response = await _act(client, room, reply["id"], "resolve", room.player, undo=undo)
        assert response.status_code == 422
        assert response.json()["detail"] == (
            "Only a top-level Comment's discussion can be resolved"
        )


async def test_a_deleted_top_level_comment_keeps_its_branch_resolvable(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    parent = await _comment(client, room, room.player)
    await _comment(client, room, room.owner, parent_id=parent["id"])
    await _act(client, room, parent["id"], "resolve", room.player)
    await client.delete(f"{room.comments_url}/{parent['id']}", headers=room.player.headers)

    # Deleting kept the branch resolved, and it can still be reopened.
    assert (await _listed(client, room, room.owner))[0]["resolved_by"] == room.player.id
    response = await _act(client, room, parent["id"], "resolve", room.owner, undo=True)
    assert response.status_code == 200
    assert response.json()["deleted"] is True


async def test_a_hidden_comment_is_neither_pinned_nor_resolved(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    # Private: only its author and the Master see it, not the Owner (VR-02).
    hidden = await _comment(client, room, room.player, visibility="private")

    for action in ("pin", "resolve"):
        response = await _act(client, room, hidden["id"], action, room.owner)
        assert response.status_code == 404
    assert (await _act(client, room, hidden["id"], "pin", room.master)).status_code == 200

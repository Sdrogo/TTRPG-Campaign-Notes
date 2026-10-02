"""Promoting a Comment (spec 19c Decision 5, FR-T8): `POST
.../comments/{id}/promote`, the `promoted_*` and `can_promote` fields on every
Comment, the widening confirmation and the AuditLog row."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass

import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditLogRow
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


async def _promote(
    client: AsyncClient, room: _Room, comment_id: object, member: _Member, **fields: object
) -> Response:
    return await client.post(
        f"{room.comments_url}/{comment_id}/promote",
        json={"target": "description", **fields},
        headers=member.headers,
    )


async def _document(
    client: AsyncClient, room: _Room, member: _Member, visibility: str = "room"
) -> str:
    response = await client.post(
        f"/rooms/{room.id}/documents",
        json={"name": "The Key", "visibility": visibility},
        headers=member.headers,
    )
    assert response.status_code == 201, response.text
    document_id: str = response.json()["id"]
    return document_id


async def _audit(db_session: AsyncSession, room: _Room) -> list[AuditLogRow]:
    rows = await db_session.execute(
        select(AuditLogRow).where(
            AuditLogRow.room_id == uuid.UUID(room.id), AuditLogRow.action == "comment_promoted"
        )
    )
    return list(rows.scalars().all())


async def _listed(client: AsyncClient, room: _Room, member: _Member) -> list[dict[str, object]]:
    response = await client.get(room.comments_url, headers=member.headers)
    assert response.status_code == 200
    listed: list[dict[str, object]] = response.json()
    return listed


async def test_an_owner_promotes_a_comment_into_the_description(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    comment = await _comment(client, room, room.player)
    assert (comment["promoted_at"], comment["promoted_to"], comment["can_promote"]) == (
        None,
        None,
        False,
    )
    assert (await _listed(client, room, room.owner))[0]["can_promote"] is True

    response = await _promote(client, room, comment["id"], room.owner)

    assert response.status_code == 200, response.text
    promoted = response.json()
    assert promoted["promoted_at"] is not None
    assert (promoted["promoted_to"], promoted["promoted_document_id"]) == ("description", None)
    # Everyone who sees the Comment sees the mark.
    assert (await _listed(client, room, room.player))[0]["promoted_to"] == "description"
    # Room-visible text into a Room-visible description reaches nobody new,
    # and is audited all the same.
    [entry] = await _audit(db_session, room)
    assert entry.actor_user_id == uuid.UUID(room.owner.id)
    assert entry.target_user_id == uuid.UUID(room.player.id)
    assert entry.details["target"] == "description"
    assert entry.details["newly_reached_user_ids"] == []


async def test_promoting_a_private_comment_must_be_confirmed(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    # The Owner's own Private Comment: only they and the Master read it.
    comment = await _comment(client, room, room.owner, visibility="private")

    refused = await _promote(client, room, comment["id"], room.owner)

    assert refused.status_code == 409
    assert refused.json()["detail"] == (
        "Promoting this Comment shows it to members who can't read it now: confirm to continue"
    )
    assert await _audit(db_session, room) == []

    accepted = await _promote(client, room, comment["id"], room.owner, confirm_widening=True)

    assert accepted.status_code == 200, accepted.text
    [entry] = await _audit(db_session, room)
    assert (entry.details["from"], entry.details["to"]) == ("private", "room")
    assert entry.details["newly_reached_user_ids"] == [room.player.id]


async def test_only_an_owner_or_the_master_may_promote(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    # Not even the author, who isn't an Owner of the Document.
    comment = await _comment(client, room, room.player)

    response = await _promote(client, room, comment["id"], room.player)

    assert response.status_code == 403
    assert response.json()["detail"] == (
        "Only an Owner or the Master can promote this Document's Comments"
    )
    assert (await _promote(client, room, comment["id"], room.master)).status_code == 200


async def test_a_deleted_or_hidden_comment_cannot_be_promoted(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    deleted = await _comment(client, room, room.player)
    await client.delete(f"{room.comments_url}/{deleted['id']}", headers=room.player.headers)
    # Private: only its author and the Master see it, not the Owner (VR-02).
    hidden = await _comment(client, room, room.player, visibility="private")

    response = await _promote(client, room, deleted["id"], room.owner)
    assert response.status_code == 409
    assert response.json()["detail"] == "This Comment was deleted"
    assert (await _promote(client, room, hidden["id"], room.owner)).status_code == 404


async def test_promoting_into_a_new_document_links_it_for_who_sees_it(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    comment = await _comment(client, room, room.player)
    # Master only: the Room-visible Comment reaches nobody new there.
    new_document_id = await _document(client, room, room.master, visibility="master")

    response = await _promote(
        client, room, comment["id"], room.master, target="document", document_id=new_document_id
    )

    assert response.status_code == 200, response.text
    assert response.json()["promoted_to"] == "document"
    assert response.json()["promoted_document_id"] == new_document_id
    [entry] = await _audit(db_session, room)
    assert entry.details["target_document_id"] == new_document_id
    # A Player sees the mark, never the id of a Document hidden from them.
    seen = (await _listed(client, room, room.player))[0]
    assert (seen["promoted_to"], seen["promoted_document_id"]) == ("document", None)


async def test_a_new_document_must_be_named_visible_managed_and_another_one(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    comment = await _comment(client, room, room.player)
    hidden_document_id = await _document(client, room, room.master, visibility="master")
    unowned_document_id = await _document(client, room, room.master)

    missing = await _promote(client, room, comment["id"], room.owner, target="document")
    assert missing.status_code == 422
    assert missing.json()["detail"] == "Choose the Document to promote the Comment into"

    same = await _promote(
        client, room, comment["id"], room.owner, target="document", document_id=room.document_id
    )
    assert same.status_code == 422
    assert same.json()["detail"] == (
        "A Comment can't be promoted into its own Document as a new one"
    )

    hidden = await _promote(
        client, room, comment["id"], room.owner, target="document", document_id=hidden_document_id
    )
    assert hidden.status_code == 404

    unowned = await _promote(
        client, room, comment["id"], room.owner, target="document", document_id=unowned_document_id
    )
    assert unowned.status_code == 403
    assert unowned.json()["detail"] == ("You can only promote a Comment into a Document you own")

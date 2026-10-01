import io
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditLogRow
from app.domain.characters import CHARACTER_PLAYER_CHANGED, DOCUMENT_OWNER_ADDED
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

    def documents_url(self) -> str:
        return f"/rooms/{self.id}/documents"

    def player_url(self, document_id: str) -> str:
        return f"/rooms/{self.id}/documents/{document_id}/player"

    def comments_url(self, document_id: str) -> str:
        return f"/rooms/{self.id}/documents/{document_id}/comments"

    def mine_url(self) -> str:
        return f"/rooms/{self.id}/characters/mine"


def _user(make_token: Callable[..., str]) -> _Member:
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
    master = _user(make_token)
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master.headers)).json()
    player = _user(make_token)
    other_player = _user(make_token)
    await _join(client, room["id"], master, player)
    await _join(client, room["id"], master, other_player)
    return _Room(id=room["id"], master=master, player=player, other_player=other_player)


async def _document(
    client: AsyncClient, room: _Room, name: str, visibility: str = "room", **fields: object
) -> str:
    response = await client.post(
        room.documents_url(),
        json={"name": name, "visibility": visibility, **fields},
        headers=room.master.headers,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _link(
    client: AsyncClient, room: _Room, document_id: str, user_id: str | None, **fields: object
) -> dict[str, object]:
    response = await client.put(
        room.player_url(document_id),
        json={"user_id": user_id, **fields},
        headers=room.master.headers,
    )
    assert response.status_code == 200, response.text
    body: dict[str, object] = response.json()
    return body


async def _comment(
    client: AsyncClient, room: _Room, document_id: str, author: _Member, **fields: object
) -> dict[str, object]:
    response = await client.post(
        room.comments_url(document_id), json={"body": "Hello.", **fields}, headers=author.headers
    )
    assert response.status_code == 201, response.text
    body: dict[str, object] = response.json()
    return body


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 50, 50)).save(buffer, format="PNG")
    return buffer.getvalue()


async def _audit_actions(db_session: AsyncSession, room_id: str) -> list[str]:
    rows = await db_session.execute(
        select(AuditLogRow.action).where(AuditLogRow.room_id == uuid.UUID(room_id))
    )
    return list(rows.scalars())


async def test_master_links_a_character_and_the_player_becomes_owner(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    aria = await _document(client, room, "Aria")

    body = await _link(client, room, aria, room.player.id)

    assert body["played_by"] == room.player.id
    assert room.player.id in body["owner_ids"]  # type: ignore[operator]
    # FR-D9 / Invariant 7: both changes are audited.
    actions = await _audit_actions(db_session, room.id)
    assert actions.count(CHARACTER_PLAYER_CHANGED) == 1
    assert actions.count(DOCUMENT_OWNER_ADDED) == 1
    # The list carries the link too, for the card's avatar.
    listed = (await client.get(room.documents_url(), headers=room.other_player.headers)).json()
    assert [d["played_by"] for d in listed] == [room.player.id]


async def test_linking_without_ownership_and_unlinking(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    aria = await _document(client, room, "Aria")

    linked = await _link(client, room, aria, room.player.id, add_as_owner=False)
    assert linked["played_by"] == room.player.id
    assert room.player.id not in linked["owner_ids"]  # type: ignore[operator]

    unlinked = await _link(client, room, aria, None)
    assert unlinked["played_by"] is None
    assert (await _audit_actions(db_session, room.id)).count(CHARACTER_PLAYER_CHANGED) == 2


async def test_only_owners_and_the_master_link_and_only_members_can_play(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    aria = await _document(client, room, "Aria")

    as_player = await client.put(
        room.player_url(aria), json={"user_id": room.player.id}, headers=room.player.headers
    )
    outsider = await client.put(
        room.player_url(aria), json={"user_id": str(uuid.uuid4())}, headers=room.master.headers
    )

    assert as_player.status_code == 403
    assert outsider.status_code == 422


async def test_editing_a_character_keeps_its_player(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    aria = await _document(client, room, "Aria")
    await _link(client, room, aria, room.player.id)

    response = await client.patch(
        f"{room.documents_url()}/{aria}", json={"name": "Aria Vane"}, headers=room.master.headers
    )

    assert response.json()["played_by"] == room.player.id


async def test_player_writes_as_their_character_and_others_see_it(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    aria = await _document(client, room, "Aria")
    await _link(client, room, aria, room.player.id)
    await client.post(
        f"{room.documents_url()}/{aria}/images",
        files={"file": ("aria.png", _png(), "image/png")},
        headers=room.master.headers,
    )
    tavern = await _document(client, room, "The Blue Water Inn")

    created = await _comment(client, room, tavern, room.player, as_document_id=aria)

    character = created["as_character"]
    assert isinstance(character, dict)
    assert character["document_id"] == aria
    assert character["name"] == "Aria"
    assert str(character["image_url"]).startswith("https://signed.test/")
    # The Post still belongs to its real author (D-24).
    assert created["author_id"] == room.player.id
    listed = (await client.get(room.comments_url(tavern), headers=room.other_player.headers)).json()
    assert listed[0]["as_character"]["name"] == "Aria"


async def test_a_hidden_character_shows_the_real_author(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    # VR-13 / I-13: a reader who can't see the Character's Document gets a
    # plain Comment, never the Character's name.
    room = await _room(client, make_token)
    aria = await _document(client, room, "Aria", visibility="private")
    await _link(client, room, aria, room.player.id)
    tavern = await _document(client, room, "The Blue Water Inn")
    await _comment(client, room, tavern, room.player, as_document_id=aria)

    as_other = (
        await client.get(room.comments_url(tavern), headers=room.other_player.headers)
    ).json()
    as_master = (await client.get(room.comments_url(tavern), headers=room.master.headers)).json()

    assert as_other[0]["as_character"] is None
    assert as_other[0]["author_id"] == room.player.id
    assert as_master[0]["as_character"]["name"] == "Aria"
    # A Character without images has no picture.
    assert as_master[0]["as_character"]["image_url"] is None


async def test_master_writes_as_any_document(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    strahd = await _document(client, room, "Strahd", visibility="master")
    castle = await _document(client, room, "Castle Ravenloft")

    created = await _comment(client, room, castle, room.master, as_document_id=strahd)

    assert created["as_character"]["name"] == "Strahd"  # type: ignore[index]
    seen_by_player = (
        await client.get(room.comments_url(castle), headers=room.player.headers)
    ).json()
    assert seen_by_player[0]["as_character"] is None


async def test_a_player_cant_write_as_a_character_they_dont_play(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    other_room = await _room(client, make_token)
    aria = await _document(client, room, "Aria")
    await _link(client, room, aria, room.other_player.id)
    npc = await _document(client, room, "Ireena")
    hidden = await _document(client, room, "Strahd", visibility="master")
    elsewhere = await _document(client, other_room, "Elsewhere")
    tavern = await _document(client, room, "The Blue Water Inn")

    async def post_as(document_id: str) -> int:
        response = await client.post(
            room.comments_url(tavern),
            json={"body": "Hi", "as_document_id": document_id},
            headers=room.player.headers,
        )
        return response.status_code

    # Someone else's Character, or an NPC: forbidden (D-24).
    assert await post_as(aria) == 403
    assert await post_as(npc) == 403
    # A Document they can't see, of another Room, or missing: not found.
    assert await post_as(hidden) == 404
    assert await post_as(elsewhere) == 404
    assert await post_as(str(uuid.uuid4())) == 404


async def test_editing_a_comment_changes_its_character(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    aria = await _document(client, room, "Aria")
    await _link(client, room, aria, room.player.id)
    npc = await _document(client, room, "Ireena")
    tavern = await _document(client, room, "The Blue Water Inn")
    comment = await _comment(client, room, tavern, room.player)
    url = f"{room.comments_url(tavern)}/{comment['id']}"

    as_aria = await client.patch(url, json={"as_document_id": aria}, headers=room.player.headers)
    as_npc = await client.patch(url, json={"as_document_id": npc}, headers=room.player.headers)
    body_only = await client.patch(url, json={"body": "Hey"}, headers=room.player.headers)

    assert as_aria.json()["as_character"]["name"] == "Aria"
    assert as_npc.status_code == 403
    assert body_only.json()["as_character"]["name"] == "Aria"

    # Unlinked from Aria, the player can still re-send it unchanged...
    await _link(client, room, aria, None)
    same = await client.patch(
        url, json={"body": "Hey!", "as_document_id": aria}, headers=room.player.headers
    )
    assert same.status_code == 200
    # ...and drop it, writing as themselves again.
    plain = await client.patch(url, json={"as_document_id": None}, headers=room.player.headers)
    assert plain.json()["as_character"] is None


async def test_leaving_the_room_unlinks_the_characters_but_keeps_the_comments(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    aria = await _document(client, room, "Aria")
    await _link(client, room, aria, room.player.id)
    tavern = await _document(client, room, "The Blue Water Inn")
    await _comment(client, room, tavern, room.player, as_document_id=aria)

    left = await client.delete(
        f"/rooms/{room.id}/members/{room.player.id}", headers=room.player.headers
    )

    assert left.status_code == 204
    document = await client.get(f"{room.documents_url()}/{aria}", headers=room.master.headers)
    assert document.json()["played_by"] is None
    listed = (await client.get(room.comments_url(tavern), headers=room.master.headers)).json()
    assert listed[0]["as_character"]["name"] == "Aria"


async def test_deleting_the_character_turns_its_comments_into_plain_ones(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    aria = await _document(client, room, "Aria")
    await _link(client, room, aria, room.player.id)
    tavern = await _document(client, room, "The Blue Water Inn")
    await _comment(client, room, tavern, room.player, as_document_id=aria)

    deleted = await client.delete(f"{room.documents_url()}/{aria}", headers=room.master.headers)

    assert deleted.status_code == 204
    listed = (await client.get(room.comments_url(tavern), headers=room.master.headers)).json()
    assert listed[0]["body"] == "Hello."
    assert listed[0]["as_character"] is None


async def test_my_characters_for_the_composer(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    zed = await _document(client, room, "zed")
    aria = await _document(client, room, "Aria")
    hidden = await _document(client, room, "Hidden", visibility="master")
    await _document(client, room, "Ireena")
    for document_id in (zed, aria, hidden):
        await _link(client, room, document_id, room.player.id, add_as_owner=False)

    mine = (await client.get(room.mine_url(), headers=room.player.headers)).json()
    other = (await client.get(room.mine_url(), headers=room.other_player.headers)).json()
    master = (await client.get(room.mine_url(), headers=room.master.headers)).json()
    outsider = await client.get(room.mine_url(), headers=_user(make_token).headers)

    # A Character the player can't see isn't offered (they couldn't post as it).
    assert [c["name"] for c in mine] == ["Aria", "zed"]
    assert other == []
    assert [c["name"] for c in master] == ["Aria", "Hidden", "Ireena", "zed"]
    assert outsider.status_code == 403

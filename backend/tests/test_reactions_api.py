"""Reactions on Comments (spec 19c Decision 1, FR-T6): `PUT`/`DELETE
.../comments/{id}/reactions/{emoji}` and `reactions` on every Comment."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from urllib.parse import quote

import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import CommentReactionRow
from app.domain.reactions import MAX_EMOJI_PER_COMMENT
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

    def comments_url(self, document_id: str) -> str:
        return f"/rooms/{self.id}/documents/{document_id}/comments"

    def reaction_url(self, document_id: str, comment_id: str, emoji: str) -> str:
        return f"{self.comments_url(document_id)}/{comment_id}/reactions/{quote(emoji, safe='')}"


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


async def _document(client: AsyncClient, room: _Room) -> str:
    response = await client.post(
        f"/rooms/{room.id}/documents",
        json={"name": "Castle Ravenloft"},
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


async def _react(
    client: AsyncClient, room: _Room, document_id: str, comment_id: str, member: _Member, emoji: str
) -> Response:
    return await client.put(
        room.reaction_url(document_id, comment_id, emoji), headers=member.headers
    )


async def _unreact(
    client: AsyncClient, room: _Room, document_id: str, comment_id: str, member: _Member, emoji: str
) -> Response:
    return await client.delete(
        room.reaction_url(document_id, comment_id, emoji), headers=member.headers
    )


async def _listed_reactions(
    client: AsyncClient, room: _Room, document_id: str, member: _Member
) -> list[object]:
    listed = (await client.get(room.comments_url(document_id), headers=member.headers)).json()
    return [comment["reactions"] for comment in listed]


async def test_members_react_and_take_their_reaction_back(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment_id = await _comment(client, room, document_id, room.master)

    first = await _react(client, room, document_id, comment_id, room.player, "👍")
    assert first.status_code == 200, first.text
    assert first.json()["reactions"] == [
        {"emoji": "👍", "count": 1, "reacted_by_me": True, "user_ids": [room.player.id]}
    ]
    # Reacting again with the same emoji changes nothing.
    again = await _react(client, room, document_id, comment_id, room.player, "👍")
    assert again.json()["reactions"][0]["count"] == 1
    await _react(client, room, document_id, comment_id, room.other_player, "👍")
    await _react(client, room, document_id, comment_id, room.other_player, "🧑🏿‍🤝‍🧑🏻")

    assert await _listed_reactions(client, room, document_id, room.master) == [
        [
            {
                "emoji": "👍",
                "count": 2,
                "reacted_by_me": False,
                "user_ids": [room.player.id, room.other_player.id],
            },
            {
                "emoji": "🧑🏿‍🤝‍🧑🏻",
                "count": 1,
                "reacted_by_me": False,
                "user_ids": [room.other_player.id],
            },
        ]
    ]

    removed = await _unreact(client, room, document_id, comment_id, room.player, "👍")
    assert removed.status_code == 200
    assert removed.json()["reactions"][0] == {
        "emoji": "👍",
        "count": 1,
        "reacted_by_me": False,
        "user_ids": [room.other_player.id],
    }
    # Taking back an emoji you never used changes nothing.
    noop = await _unreact(client, room, document_id, comment_id, room.player, "🎲")
    assert noop.status_code == 200
    assert len(noop.json()["reactions"]) == 2


async def test_nobody_removes_someone_elses_reaction(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment_id = await _comment(client, room, document_id, room.player)
    await _react(client, room, document_id, comment_id, room.player, "🎲")

    # Not even the Master: DELETE only ever takes back the caller's own.
    response = await _unreact(client, room, document_id, comment_id, room.master, "🎲")

    assert response.json()["reactions"][0]["user_ids"] == [room.player.id]


async def test_a_reaction_must_be_one_emoji(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment_id = await _comment(client, room, document_id, room.master)

    for text in ("ok", "👍👍"):
        response = await _react(client, room, document_id, comment_id, room.player, text)
        assert response.status_code == 422
        assert response.json()["detail"] == "A reaction must be exactly one emoji"
    response = await _unreact(client, room, document_id, comment_id, room.player, "ok")
    assert response.status_code == 422


async def test_a_comment_the_member_cannot_see_cannot_be_reacted_to(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    hidden = await _comment(client, room, document_id, room.player, visibility="private")

    # 404 like a Comment that doesn't exist (VR-07), for adding and removing.
    added = await _react(client, room, document_id, hidden, room.other_player, "👍")
    removed = await _unreact(client, room, document_id, hidden, room.other_player, "👍")
    assert (added.status_code, removed.status_code) == (404, 404)
    # The Master sees everything, so may react (VR-01).
    response = await _react(client, room, document_id, hidden, room.master, "👍")
    assert response.status_code == 200


async def test_a_non_member_cannot_react(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment_id = await _comment(client, room, document_id, room.master)
    outsider = _new_member(make_token)

    response = await _react(client, room, document_id, comment_id, outsider, "👍")

    assert response.status_code == 403


async def test_a_deleted_comment_loses_its_reactions_and_takes_no_new_ones(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment_id = await _comment(client, room, document_id, room.player)
    await _react(client, room, document_id, comment_id, room.other_player, "👍")

    deleted = await client.delete(
        f"{room.comments_url(document_id)}/{comment_id}", headers=room.player.headers
    )
    assert deleted.status_code == 204

    assert await _listed_reactions(client, room, document_id, room.player) == [[]]
    rows = await db_session.execute(
        select(CommentReactionRow).where(CommentReactionRow.comment_id == uuid.UUID(comment_id))
    )
    assert rows.first() is None
    response = await _react(client, room, document_id, comment_id, room.other_player, "👍")
    assert response.status_code == 409
    assert response.json()["detail"] == "A deleted Comment can't be reacted to"


async def test_a_comment_holds_at_most_twenty_different_emoji(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment_id = await _comment(client, room, document_id, room.master)
    emoji = [chr(0x1F600 + i) for i in range(MAX_EMOJI_PER_COMMENT)]
    for each in emoji:
        response = await _react(client, room, document_id, comment_id, room.player, each)
        assert response.status_code == 200

    response = await _react(client, room, document_id, comment_id, room.other_player, "🎲")
    assert response.status_code == 409
    assert response.json()["detail"] == "A Comment can have at most 20 different emoji"
    # Joining an emoji already there still works.
    response = await _react(client, room, document_id, comment_id, room.other_player, emoji[0])
    assert response.status_code == 200
    assert response.json()["reactions"][0]["count"] == 2


async def test_every_comment_response_carries_its_reactions(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    created = await client.post(
        room.comments_url(document_id), json={"body": "Hello"}, headers=room.player.headers
    )
    assert created.json()["reactions"] == []
    comment_id = created.json()["id"]
    await _react(client, room, document_id, comment_id, room.other_player, "👍")

    edited = await client.patch(
        f"{room.comments_url(document_id)}/{comment_id}",
        json={"body": "Hello again"},
        headers=room.player.headers,
    )

    assert edited.json()["reactions"] == [
        {"emoji": "👍", "count": 1, "reacted_by_me": False, "user_ids": [room.other_player.id]}
    ]

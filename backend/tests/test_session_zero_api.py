"""Session 0 boards (spec 46): `/rooms/{id}/session-zero` - the Retro board
in rounds, the Lines & Veils board, drafts, promotion, reactions, the
shared timer and the live event stream (46_2)."""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import session_zero as session_zero_api
from app.domain import session_zero
from app.main import app
from app.realtime.broker import broker


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
    def url(self) -> str:
        return f"/rooms/{self.id}/session-zero"


def _new_member(make_token: Callable[..., str]) -> _Member:
    user_id = str(uuid.uuid4())
    return _Member(
        id=user_id,
        headers={"Authorization": f"Bearer {make_token(user_id)}", "Accept-Language": "en"},
    )


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


async def _started(client: AsyncClient, make_token: Callable[..., str]) -> tuple[_Room, Any]:
    room = await _room(client, make_token)
    response = await client.post(f"{room.url}/start", headers=room.player.headers)
    assert response.status_code == 200, response.text
    return room, response.json()


async def _get(client: AsyncClient, room: _Room, member: _Member, **params: str) -> Any:
    response = await client.get(room.url, params=params, headers=member.headers)
    assert response.status_code == 200, response.text
    return response.json()


def _retro(board: Any) -> list[Any]:
    """The columns of the shown session's first Retro module (spec 47)."""
    return list(next(m["columns"] for m in board["modules"] if m["kind"] == "retro"))


def _cards(board: Any) -> list[Any]:
    columns = [c for m in board["modules"] for c in m["columns"]] + board["lines_veils"]
    return [card for column in columns for card in column["cards"]]


def _column(board: Any, kind: str) -> str:
    return str(next(c["id"] for c in board["lines_veils"] if c["kind"] == kind))


async def _write(
    client: AsyncClient, room: _Room, member: _Member, column_id: str, body: str
) -> str:
    """A draft by `member`; returns its id."""
    response = await client.post(
        f"{room.url}/cards", json={"column_id": column_id, "body": body}, headers=member.headers
    )
    assert response.status_code == 200, response.text
    return str(next(c["id"] for c in _cards(response.json()) if c["body"] == body.strip()))


async def _publish(
    client: AsyncClient, room: _Room, member: _Member, card_id: str, anonymous: bool = False
) -> Response:
    return await client.post(
        f"{room.url}/cards/{card_id}/publish", json={"anonymous": anonymous}, headers=member.headers
    )


async def _posted(
    client: AsyncClient, room: _Room, member: _Member, column_id: str, body: str
) -> str:
    """A published post-it by `member`; returns its id."""
    card_id = await _write(client, room, member, column_id, body)
    assert (await _publish(client, room, member, card_id)).status_code == 200
    return card_id


async def test_session_zero_starts_once_with_the_preset_columns(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)

    before = await _get(client, room, room.player)
    assert before["started"] is False
    assert before["can_manage"] is False
    assert before["timer"] is None
    # Writing before anyone started it is refused, and GET never starts it.
    refused = await client.post(f"{room.url}/rounds", json={}, headers=room.master.headers)
    assert refused.status_code == 409
    assert refused.json()["detail"] == "This Room's Session 0 hasn't started yet"
    assert (await _get(client, room, room.master))["started"] is False

    started = await client.post(
        f"{room.url}/start", headers={**room.player.headers, "Accept-Language": "it"}
    )
    board = started.json()
    assert board["started"] is True
    assert board["revision"] == 1
    assert [c["title"] for c in _retro(board)] == [
        "Lo vogliamo al tavolo",
        "Con cura",
        "Da evitare",
    ]
    assert [c["color"] for c in _retro(board)] == ["green", "gold", "red"]
    assert [(c["kind"], c["color"]) for c in board["lines_veils"]] == [
        ("must", "green"),
        ("veils", "gold"),
        ("lines", "red"),
    ]
    assert [r["number"] for r in board["rounds"]] == [1]
    assert board["round_id"] == board["rounds"][0]["id"]
    assert board["timer"]["state"] == "stopped"

    again = (await client.post(f"{room.url}/start", headers=room.master.headers)).json()
    assert again["revision"] == 1
    assert again["can_manage"] is True
    assert _retro(again) == _retro(board)


async def test_only_members_reach_the_boards(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room, _ = await _started(client, make_token)
    stranger = _new_member(make_token)
    for response in (
        await client.get(room.url, headers=stranger.headers),
        await client.post(f"{room.url}/start", headers=stranger.headers),
        await client.post(f"{room.url}/rounds", json={}, headers=stranger.headers),
    ):
        assert response.status_code in (403, 404)


async def test_drafts_stay_with_their_author_until_published(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room, board = await _started(client, make_token)
    want = _retro(board)[0]["id"]

    card_id = await _write(client, room, room.player, want, "  No spiders  ")
    mine = _cards(await _get(client, room, room.player))
    assert [(c["body"], c["draft"], c["mine"], c["can_publish"]) for c in mine] == [
        ("No spiders", True, True, True)
    ]
    # Nobody else sees it, not even the Master, and the revision didn't move.
    master_view = await _get(client, room, room.master)
    assert _cards(master_view) == []
    assert master_view["revision"] == 1
    for response in (
        await client.patch(
            f"{room.url}/cards/{card_id}", json={"body": "x"}, headers=room.master.headers
        ),
        await client.delete(f"{room.url}/cards/{card_id}", headers=room.master.headers),
        await _publish(client, room, room.master, card_id),
    ):
        assert response.status_code == 404
        assert response.json()["detail"] == "Post-it not found"

    edited = await client.patch(
        f"{room.url}/cards/{card_id}",
        json={"body": "No giant spiders"},
        headers=room.player.headers,
    )
    assert edited.status_code == 200
    assert edited.json()["revision"] == 1

    published = await _publish(client, room, room.player, card_id)
    assert published.status_code == 200
    assert published.json()["revision"] == 2
    seen = _cards(await _get(client, room, room.other_player))
    assert [(c["body"], c["author_id"], c["draft"], c["mine"]) for c in seen] == [
        ("No giant spiders", room.player.id, False, False)
    ]
    again = await _publish(client, room, room.player, card_id)
    assert again.status_code == 409
    assert again.json()["detail"] == "This post-it is already published"

    # A published post-it's edit reaches everyone.
    edited = await client.patch(
        f"{room.url}/cards/{card_id}",
        json={"body": "No spiders at all"},
        headers=room.player.headers,
    )
    assert edited.json()["revision"] == 3


async def test_anonymous_post_its_hide_their_author_from_the_others(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room, board = await _started(client, make_token)
    card_id = await _write(client, room, room.player, _retro(board)[2]["id"], "Gore")
    await _publish(client, room, room.player, card_id, anonymous=True)

    for member in (room.master, room.other_player):
        (card,) = _cards(await _get(client, room, member))
        assert card["anonymous"] is True
        assert card["author_id"] is None
    (own,) = _cards(await _get(client, room, room.player))
    assert own["author_id"] == room.player.id


async def test_writing_post_its_follows_the_rules(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room, board = await _started(client, make_token)
    want = _retro(board)[0]["id"]

    async def add(column_id: str, body: str) -> Response:
        return await client.post(
            f"{room.url}/cards",
            json={"column_id": column_id, "body": body},
            headers=room.player.headers,
        )

    blank = await add(want, "   ")
    assert blank.status_code == 422
    assert blank.json()["detail"] == "A post-it needs some text, at most 500 characters"
    assert (await add(want, "x" * 501)).status_code == 422
    assert (await add(str(uuid.uuid4()), "Hi")).status_code == 404
    # Only the Master writes on Lines & Veils directly (spec 46c Decision 6).
    wrong = await add(_column(board, "lines"), "Hi")
    assert wrong.status_code == 403

    card_id = await _posted(client, room, room.player, want, "Dragons")
    others = await client.patch(
        f"{room.url}/cards/{card_id}", json={"body": "x"}, headers=room.other_player.headers
    )
    assert others.status_code == 403
    assert others.json()["detail"] == "Only the post-it's author can do this"
    empty = await client.patch(
        f"{room.url}/cards/{card_id}", json={"body": ""}, headers=room.player.headers
    )
    assert empty.status_code == 422
    stolen = await client.delete(f"{room.url}/cards/{card_id}", headers=room.other_player.headers)
    assert stolen.status_code == 403

    # A post-it of another Room is not found here.
    elsewhere, other_board = await _started(client, make_token)
    foreign = await _write(
        client, elsewhere, elsewhere.player, _retro(other_board)[0]["id"], "Elsewhere"
    )
    missing = await client.delete(f"{room.url}/cards/{foreign}", headers=room.master.headers)
    assert missing.status_code == 404


async def test_deleting_post_its(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room, board = await _started(client, make_token)
    want = _retro(board)[0]["id"]
    draft = await _write(client, room, room.player, want, "Draft")
    posted = await _posted(client, room, room.player, want, "Posted")
    revision = (await _get(client, room, room.player))["revision"]

    gone = await client.delete(f"{room.url}/cards/{draft}", headers=room.player.headers)
    assert gone.status_code == 200
    assert gone.json()["revision"] == revision
    by_master = await client.delete(f"{room.url}/cards/{posted}", headers=room.master.headers)
    assert by_master.json()["revision"] == revision + 1
    assert _cards(by_master.json()) == []


async def test_the_master_promotes_and_moves_post_its_on_lines_and_veils(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room, board = await _started(client, make_token)
    avoid = _retro(board)[2]["id"]
    lines, veils, must = _column(board, "lines"), _column(board, "veils"), _column(board, "must")
    card_id = await _posted(client, room, room.player, avoid, "Spiders")
    (shown,) = _cards(await _get(client, room, room.master))
    assert shown["can_promote"] is True
    (shown,) = _cards(await _get(client, room, room.player))
    assert shown["can_promote"] is False

    async def promote(member: _Member, card: str, column_id: str) -> Response:
        return await client.post(
            f"{room.url}/cards/{card}/promote",
            json={"column_id": column_id},
            headers=member.headers,
        )

    refused = await promote(room.player, card_id, lines)
    assert refused.status_code == 403
    assert refused.json()["detail"] == "Only the Master can do this"
    promoted = await promote(room.master, card_id, lines)
    assert promoted.status_code == 200, promoted.text
    (copy,) = next(c for c in promoted.json()["lines_veils"] if c["kind"] == "lines")["cards"]
    assert copy["body"] == "Spiders"
    assert copy["author_id"] == room.player.id
    assert copy["from_retro"] is True
    assert copy["can_edit"] is False
    assert copy["can_move"] is True
    assert (await promote(room.master, card_id, lines)).status_code == 409
    assert (await promote(room.master, card_id, avoid)).status_code == 422
    assert (await promote(room.master, card_id, str(uuid.uuid4()))).status_code == 404
    master_draft = await _write(client, room, room.master, avoid, "Mine")
    assert (await promote(room.master, master_draft, lines)).status_code == 409
    # The copy can't be edited, even by the original's author.
    edit = await client.patch(
        f"{room.url}/cards/{copy['id']}", json={"body": "x"}, headers=room.player.headers
    )
    assert edit.status_code == 409

    async def move(member: _Member, column_id: str) -> Response:
        return await client.post(
            f"{room.url}/cards/{copy['id']}/move",
            json={"column_id": column_id},
            headers=member.headers,
        )

    assert (await move(room.player, veils)).status_code == 403
    assert (await move(room.master, avoid)).status_code == 422
    revision = promoted.json()["revision"]
    same = await move(room.master, lines)
    assert same.json()["revision"] == revision
    moved = await move(room.master, veils)
    assert moved.json()["revision"] == revision + 1
    assert [
        c["id"]
        for c in next(c for c in moved.json()["lines_veils"] if c["kind"] == "veils")["cards"]
    ] == [copy["id"]]
    # A second copy, in Must, can't be moved next to the first one.
    await promote(room.master, card_id, must)
    must_copy = next(
        c for c in (await _get(client, room, room.master))["lines_veils"] if c["kind"] == "must"
    )["cards"][0]
    clash = await client.post(
        f"{room.url}/cards/{must_copy['id']}/move",
        json={"column_id": veils},
        headers=room.master.headers,
    )
    assert clash.status_code == 409

    # The original's author may remove the copy; the original stays.
    removed = await client.delete(f"{room.url}/cards/{copy['id']}", headers=room.player.headers)
    assert removed.status_code == 200
    assert card_id in [c["id"] for c in _cards(removed.json())]


async def test_a_copy_outlives_its_original(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 2: editing the original leaves the copy as it was; once the
    original is gone the copy keeps its author and anonymity, and that
    author can still delete it."""
    room, board = await _started(client, make_token)
    lines = _column(board, "lines")
    card_id = await _write(client, room, room.player, _retro(board)[2]["id"], "Spiders")
    await _publish(client, room, room.player, card_id, anonymous=True)
    await client.post(
        f"{room.url}/cards/{card_id}/promote",
        json={"column_id": lines},
        headers=room.master.headers,
    )
    await client.patch(
        f"{room.url}/cards/{card_id}", json={"body": "Big spiders"}, headers=room.player.headers
    )
    gone = await client.delete(f"{room.url}/cards/{card_id}", headers=room.player.headers)
    (copy,) = _cards(gone.json())
    assert (copy["body"], copy["author_id"], copy["mine"]) == ("Spiders", room.player.id, True)
    (seen,) = _cards(await _get(client, room, room.other_player))
    assert (seen["anonymous"], seen["author_id"]) == (True, None)
    removed = await client.delete(f"{room.url}/cards/{copy['id']}", headers=room.player.headers)
    assert _cards(removed.json()) == []


async def test_view_as_reads_the_boards_but_never_writes(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room, board = await _started(client, make_token)
    want = _retro(board)[0]["id"]
    await _write(client, room, room.player, want, "Secret draft")
    await _posted(client, room, room.player, want, "Shared")
    view_as = {**room.master.headers, "X-View-As": room.player.id}

    # The Master sees the board as the player does, minus the player's
    # drafts: those are the author's alone (Decision 1).
    seen = await _get(client, room, _Member(room.master.id, view_as))
    assert [(c["body"], c["mine"]) for c in _cards(seen)] == [("Shared", True)]
    for response in (
        await client.post(f"{room.url}/start", headers=view_as),
        await client.post(
            f"{room.url}/cards",
            json={"column_id": _retro(board)[0]["id"], "body": "x"},
            headers=view_as,
        ),
    ):
        assert response.status_code == 403


async def test_members_react_to_published_post_its(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room, board = await _started(client, make_token)
    want = _retro(board)[0]["id"]
    card_id = await _posted(client, room, room.player, want, "Horror")
    draft = await _write(client, room, room.player, want, "Draft")

    def url(card: str, emoji: str) -> str:
        return f"{room.url}/cards/{card}/reactions/{quote(emoji, safe='')}"

    added = await client.put(url(card_id, "👍"), headers=room.other_player.headers)
    assert added.status_code == 200
    (card,) = [c for c in _cards(added.json()) if c["id"] == card_id]
    assert card["reactions"] == [
        {"emoji": "👍", "count": 1, "reacted_by_me": True, "user_ids": [room.other_player.id]}
    ]
    assert (await client.put(url(card_id, "ok"), headers=room.master.headers)).status_code == 422
    assert (await client.delete(url(card_id, "ok"), headers=room.master.headers)).status_code == 422
    assert (await client.put(url(draft, "👍"), headers=room.player.headers)).status_code == 409
    # Nothing changes, so the revision stays: the same emoji again, one never
    # added, and taking one back from the caller's own draft.
    revision = added.json()["revision"]
    for response in (
        await client.put(url(card_id, "👍"), headers=room.other_player.headers),
        await client.delete(url(card_id, "🎲"), headers=room.other_player.headers),
        await client.delete(url(draft, "👍"), headers=room.player.headers),
    ):
        assert response.status_code == 200
        assert response.json()["revision"] == revision

    removed = await client.delete(url(card_id, "👍"), headers=room.other_player.headers)
    assert removed.status_code == 200
    assert [c for c in _cards(removed.json()) if c["id"] == card_id][0]["reactions"] == []


async def test_the_master_manages_the_retro_columns(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room, board = await _started(client, make_token)
    first = _retro(board)[0]["id"]
    lines = _column(board, "lines")

    for response in (
        await client.post(f"{room.url}/columns", json={"title": "X"}, headers=room.player.headers),
        await client.patch(
            f"{room.url}/columns/{first}", json={"title": "X"}, headers=room.player.headers
        ),
        await client.delete(f"{room.url}/columns/{first}", headers=room.player.headers),
        await client.put(
            f"{room.url}/columns/order", json={"column_ids": []}, headers=room.player.headers
        ),
    ):
        assert response.status_code == 403

    added = await client.post(
        f"{room.url}/columns", json={"title": " Tone "}, headers=room.master.headers
    )
    assert added.status_code == 200
    assert [c["title"] for c in _retro(added.json())][-1] == "Tone"
    blank = await client.post(
        f"{room.url}/columns", json={"title": ""}, headers=room.master.headers
    )
    assert blank.status_code == 422
    assert blank.json()["detail"] == "The title must be 1 to 60 characters"

    renamed = await client.patch(
        f"{room.url}/columns/{first}", json={"title": "Wishes"}, headers=room.master.headers
    )
    assert _retro(renamed.json())[0]["title"] == "Wishes"
    not_retro = await client.patch(
        f"{room.url}/columns/{lines}", json={"title": "X"}, headers=room.master.headers
    )
    assert not_retro.status_code == 422
    missing = await client.patch(
        f"{room.url}/columns/{uuid.uuid4()}", json={"title": "X"}, headers=room.master.headers
    )
    assert missing.status_code == 404

    ids = [c["id"] for c in _retro(renamed.json())]
    reordered = await client.put(
        f"{room.url}/columns/order", json={"column_ids": ids[::-1]}, headers=room.master.headers
    )
    assert [c["id"] for c in _retro(reordered.json())] == ids[::-1]
    for wrong in (ids[1:], ids + [ids[0]], [*ids[1:], lines]):
        bad = await client.put(
            f"{room.url}/columns/order", json={"column_ids": wrong}, headers=room.master.headers
        )
        assert bad.status_code == 422

    await _posted(client, room, room.player, first, "Gone with the column")
    deleted = await client.delete(f"{room.url}/columns/{first}", headers=room.master.headers)
    assert first not in [c["id"] for c in _retro(deleted.json())]
    assert _cards(deleted.json()) == []
    assert (
        await client.delete(f"{room.url}/columns/{lines}", headers=room.master.headers)
    ).status_code == 422

    for n in range(8 - len(_retro(deleted.json()))):
        await client.post(
            f"{room.url}/columns", json={"title": f"C{n}"}, headers=room.master.headers
        )
    full = await client.post(
        f"{room.url}/columns", json={"title": "One more"}, headers=room.master.headers
    )
    assert full.status_code == 409


async def test_a_new_round_closes_the_last_one_and_keeps_lines_and_veils(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room, board = await _started(client, make_token)
    old_want = _retro(board)[0]["id"]
    lines = _column(board, "lines")
    kept = await _posted(client, room, room.player, old_want, "Kept")
    draft = await _write(client, room, room.player, old_want, "Dropped draft")
    await client.post(
        f"{room.url}/cards/{kept}/promote", json={"column_id": lines}, headers=room.master.headers
    )

    assert (
        await client.post(f"{room.url}/rounds", json={}, headers=room.player.headers)
    ).status_code == 403
    long_title = await client.post(
        f"{room.url}/rounds", json={"title": "x" * 101}, headers=room.master.headers
    )
    assert long_title.status_code == 422

    new = await client.post(
        f"{room.url}/rounds", json={"title": " Session 0.5 "}, headers=room.master.headers
    )
    assert new.status_code == 200
    data = new.json()
    assert [(r["number"], r["title"]) for r in data["rounds"]] == [(1, None), (2, "Session 0.5")]
    assert data["rounds"][0]["closed_at"] is not None
    assert data["round_id"] == data["rounds"][1]["id"]
    assert [c["title"] for c in _retro(data)] == [c["title"] for c in _retro(board)]
    assert all(not c["cards"] for c in _retro(data))
    assert [c["body"] for c in _cards(data)] == ["Kept"]

    old = await _get(client, room, room.player, round_id=board["round_id"])
    (card,) = _retro(old)[0]["cards"]
    assert card["id"] == kept
    assert (card["can_edit"], card["can_delete"], card["can_react"]) == (False, False, False)
    # Its drafts went with the round.
    assert draft not in [c["id"] for c in _cards(old)]
    for response in (
        await client.patch(
            f"{room.url}/cards/{kept}", json={"body": "x"}, headers=room.player.headers
        ),
        await client.put(
            f"{room.url}/cards/{kept}/reactions/%F0%9F%91%8D", headers=room.player.headers
        ),
        await client.delete(
            f"{room.url}/cards/{kept}/reactions/%F0%9F%91%8D", headers=room.player.headers
        ),
        await client.post(
            f"{room.url}/cards",
            json={"column_id": old_want, "body": "x"},
            headers=room.player.headers,
        ),
        await client.patch(
            f"{room.url}/columns/{old_want}", json={"title": "x"}, headers=room.master.headers
        ),
    ):
        assert response.status_code == 409
        assert response.json()["detail"] == "This round is closed and read-only"

    # The Master can still promote from a closed round.
    veils = _column(board, "veils")
    promoted = await client.post(
        f"{room.url}/cards/{kept}/promote", json={"column_id": veils}, headers=room.master.headers
    )
    assert promoted.status_code == 200

    unknown = await client.get(
        room.url, params={"round_id": str(uuid.uuid4())}, headers=room.player.headers
    )
    assert unknown.status_code == 404


async def test_the_master_runs_the_shared_timer(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room, _ = await _started(client, make_token)

    async def timer(member: _Member, **body: object) -> Response:
        return await client.post(f"{room.url}/timer", json=body, headers=member.headers)

    assert (await timer(room.player, action="start", duration_s=300)).status_code == 403
    too_short = await timer(room.master, action="start", duration_s=30)
    assert too_short.status_code == 409
    assert too_short.json()["detail"] == "The timer runs from 60 to 3600 seconds"

    running = (await timer(room.master, action="start", duration_s=300)).json()["timer"]
    assert running["state"] == "running"
    assert running["duration_s"] == 300
    assert 299 <= running["remaining_s"] <= 300
    seen = (await _get(client, room, room.player))["timer"]
    assert seen["ends_at"] == running["ends_at"]

    paused = (await timer(room.master, action="pause")).json()["timer"]
    assert paused["state"] == "paused"
    assert paused["ends_at"] is None
    assert (await timer(room.master, action="pause")).status_code == 409
    resumed = (await timer(room.master, action="resume")).json()["timer"]
    assert resumed["state"] == "running"
    stopped = (await timer(room.master, action="stop")).json()["timer"]
    assert stopped == {**stopped, "state": "stopped", "ends_at": None, "remaining_s": None}


async def test_the_board_limit_never_counts_someone_elses_drafts(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Decision 1: a full board is counted as the writer sees it, so a 409
    never reveals other members' drafts; publishing is capped too."""
    monkeypatch.setattr(session_zero, "MAX_CARDS_PER_BOARD", 2)
    room, board = await _started(client, make_token)
    want = _retro(board)[0]["id"]
    first = await _write(client, room, room.player, want, "One")
    second = await _write(client, room, room.player, want, "Two")
    # Two drafts the other player can't see don't fill their board.
    late = await _write(client, room, room.other_player, want, "Late")
    for card_id in (first, second):
        assert (await _publish(client, room, room.player, card_id)).status_code == 200

    full = await _publish(client, room, room.other_player, late)
    assert full.status_code == 409
    assert full.json()["detail"] == "A board holds at most 2 post-its"
    more = await client.post(
        f"{room.url}/cards",
        json={"column_id": want, "body": "x"},
        headers=room.other_player.headers,
    )
    assert more.status_code == 409


async def _listen(client: AsyncClient, room: _Room, member: _Member) -> "asyncio.Task[Response]":
    """Opens `member`'s event stream; returns once it is subscribed. The
    test transport hands the body over only when the stream ends, so each
    test closes the streams before reading them."""
    room_id = uuid.UUID(room.id)
    before = broker.count(room_id)
    task = asyncio.create_task(client.get(f"{room.url}/events", headers=member.headers))
    async with asyncio.timeout(5):
        while broker.count(room_id) == before:
            await asyncio.sleep(0.01)
    return task


async def _heard(task: "asyncio.Task[Response]") -> list[Any]:
    async with asyncio.timeout(5):
        response = await task
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    return [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]


async def test_members_hear_of_shared_writes_and_only_the_author_of_drafts(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room, board = await _started(client, make_token)
    revision = board["revision"]
    master = await _listen(client, room, room.master)
    player = await _listen(client, room, room.player)

    card_id = await _write(client, room, room.player, _retro(board)[0]["id"], "Secret")
    await client.patch(
        f"{room.url}/cards/{card_id}", json={"body": "Still secret"}, headers=room.player.headers
    )
    await _publish(client, room, room.player, card_id)
    await client.post(
        f"{room.url}/timer", json={"action": "start", "duration_s": 60}, headers=room.master.headers
    )
    broker.disconnect(uuid.UUID(room.id))

    draft_events = [
        {"revision": revision, "kind": "card", "id": card_id},
        {"revision": revision, "kind": "card", "id": card_id},
    ]
    shared_events = [
        {"revision": revision + 1, "kind": "card", "id": card_id},
        {"revision": revision + 2, "kind": "timer", "id": None},
    ]
    assert await _heard(player) == draft_events + shared_events
    # The Master never hears of the draft, not even its id or a revision gap.
    assert await _heard(master) == shared_events
    assert broker.count(uuid.UUID(room.id)) == 0


async def test_a_stream_closes_when_its_member_leaves_or_the_room_goes(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room, _ = await _started(client, make_token)
    player = await _listen(client, room, room.player)
    master = await _listen(client, room, room.master)

    removed = await client.delete(
        f"/rooms/{room.id}/members/{room.player.id}", headers=room.master.headers
    )
    assert removed.status_code == 204
    assert await _heard(player) == []
    assert not master.done()

    deleted = await client.delete(f"/rooms/{room.id}", headers=room.master.headers)
    assert deleted.status_code == 204
    assert await _heard(master) == []


async def test_only_signed_in_members_open_a_stream(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room, _ = await _started(client, make_token)
    stranger = _new_member(make_token)
    assert (await client.get(f"{room.url}/events", headers=stranger.headers)).status_code == 403
    assert (await client.get(f"{room.url}/events")).status_code == 401


async def test_an_idle_stream_sends_keep_alives(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(session_zero_api, "KEEPALIVE_S", 0.01)
    room, _ = await _started(client, make_token)
    task = await _listen(client, room, room.player)
    await asyncio.sleep(0.05)
    broker.disconnect(uuid.UUID(room.id))

    response = await task
    assert response.text.startswith(": open\n\n: keep-alive\n\n")


async def test_the_master_writes_lines_and_veils_directly(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Spec 46c Decision 6: published at once, signed, editable by the Master."""
    room, board = await _started(client, make_token)
    veils = _column(board, "veils")
    added = await client.post(
        f"{room.url}/cards",
        json={"column_id": veils, "body": "Torture off screen"},
        headers=room.master.headers,
    )
    assert added.status_code == 200
    assert added.json()["revision"] == board["revision"] + 1
    (card,) = _cards(added.json())
    assert (card["draft"], card["from_retro"], card["can_edit"], card["can_group"]) == (
        False,
        False,
        True,
        False,
    )
    (seen,) = _cards(await _get(client, room, room.player))
    assert (seen["author_id"], seen["can_edit"], seen["can_delete"]) == (
        room.master.id,
        False,
        False,
    )
    edited = await client.patch(
        f"{room.url}/cards/{card['id']}",
        json={"body": "Torture fades to black"},
        headers=room.master.headers,
    )
    assert _cards(edited.json())[0]["body"] == "Torture fades to black"
    gone = await client.delete(f"{room.url}/cards/{card['id']}", headers=room.master.headers)
    assert _cards(gone.json()) == []


async def test_publish_all_publishes_the_callers_drafts_of_the_open_round(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Spec 46c Decision 8: oldest first, as many as fit, all anonymous or
    all signed; someone else's drafts stay theirs."""
    monkeypatch.setattr(session_zero, "MAX_CARDS_PER_BOARD", 4)
    room, board = await _started(client, make_token)
    want, avoid = _retro(board)[0]["id"], _retro(board)[2]["id"]
    ids = [
        await _write(client, room, room.player, want, "One"),
        await _write(client, room, room.player, avoid, "Two"),
        await _write(client, room, room.player, want, "Three"),
    ]
    # Others publish meanwhile, so only two of the three fit.
    await _posted(client, room, room.other_player, avoid, "Theirs 1")
    await _posted(client, room, room.master, avoid, "Master's")
    theirs = await _write(client, room, room.other_player, want, "Theirs")

    published = await client.post(
        f"{room.url}/cards/publish-all", json={"anonymous": True}, headers=room.player.headers
    )
    assert published.status_code == 200
    assert published.json()["revision"] == board["revision"] + 3
    mine = {c["id"]: c for c in _cards(published.json())}
    assert [(mine[i]["draft"], mine[i]["anonymous"]) for i in ids] == [
        (False, True),
        (False, True),
        (True, False),
    ]
    full = await client.post(
        f"{room.url}/cards/publish-all", json={"anonymous": False}, headers=room.player.headers
    )
    assert full.status_code == 409
    others = {c["id"]: c for c in _cards(await _get(client, room, room.other_player))}
    assert others[theirs]["draft"] is True
    assert ids[2] not in others

    # Without drafts nothing changes, not even the revision.
    nothing = await client.post(
        f"{room.url}/cards/publish-all", json={"anonymous": False}, headers=room.master.headers
    )
    assert nothing.status_code == 200
    assert nothing.json()["revision"] == published.json()["revision"]


async def test_columns_have_colours(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Spec 46c Decision 5: picked on create, changed later, kept by a new
    round's Retro step that carries them over (spec 47b)."""
    room, board = await _started(client, make_token)
    first = _retro(board)[0]["id"]

    plain = await client.post(
        f"{room.url}/columns", json={"title": "Tone"}, headers=room.master.headers
    )
    assert _retro(plain.json())[-1]["color"] == "default"
    added = await client.post(
        f"{room.url}/columns",
        json={"title": "Themes", "color": "purple"},
        headers=room.master.headers,
    )
    assert _retro(added.json())[-1]["color"] == "purple"
    bad = await client.post(
        f"{room.url}/columns", json={"title": "X", "color": "plaid"}, headers=room.master.headers
    )
    assert bad.status_code == 422

    recoloured = await client.patch(
        f"{room.url}/columns/{first}", json={"color": "blue"}, headers=room.master.headers
    )
    assert (_retro(recoloured.json())[0]["title"], _retro(recoloured.json())[0]["color"]) == (
        _retro(board)[0]["title"],
        "blue",
    )
    nothing = await client.patch(
        f"{room.url}/columns/{first}", json={}, headers=room.master.headers
    )
    assert nothing.status_code == 422
    assert nothing.json()["detail"] == "Nothing to change"

    new_round = await client.post(
        f"{room.url}/rounds",
        json={"modules": [{"kind": "retro", "carry": True}, "lines_veils"]},
        headers=room.master.headers,
    )
    assert [(c["title"], c["color"]) for c in _retro(new_round.json())] == [
        (c["title"], c["color"]) for c in _retro(recoloured.json())
    ]


async def test_the_master_groups_related_post_its(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Spec 46c Decision 9."""
    room, board = await _started(client, make_token)
    want, avoid = _retro(board)[0]["id"], _retro(board)[2]["id"]
    one = await _posted(client, room, room.player, want, "Dragons")
    two = await _posted(client, room, room.other_player, want, "Wyverns")
    three = await _posted(client, room, room.player, want, "Drakes")
    elsewhere = await _posted(client, room, room.player, avoid, "Spiders")
    draft = await _write(client, room, room.player, want, "Draft")

    async def group(member: _Member, *card_ids: str) -> Response:
        return await client.post(
            f"{room.url}/groups", json={"card_ids": list(card_ids)}, headers=member.headers
        )

    # A Player groups their own published post-its only (spec 46d Q2).
    player_view = _cards(await _get(client, room, room.player))
    assert {c["id"] for c in player_view if c["can_group"]} == {one, three, elsewhere}
    assert (await group(room.player, one, two)).status_code == 403
    assert (await group(room.player)).status_code == 422
    assert (await group(room.master)).status_code == 422
    assert (await group(room.master, one)).status_code == 422
    assert (await group(room.master, one, elsewhere)).status_code == 422
    # Someone else's draft isn't even found.
    assert (await group(room.master, one, draft)).status_code == 404

    grouped = await group(room.master, one, two)
    assert grouped.status_code == 200
    column = _retro(grouped.json())[0]
    (made,) = column["groups"]
    assert made["title"] is None
    by_id = {c["id"]: c for c in column["cards"]}
    assert by_id[one]["group_id"] == by_id[two]["group_id"] == made["id"]
    assert by_id[three]["group_id"] is None

    # A third joins the group, in either order.
    joined = _retro((await group(room.master, three, one)).json())[0]
    assert [g["id"] for g in joined["groups"]] == [made["id"]]
    assert {c["group_id"] for c in joined["cards"]} == {made["id"]}

    titled = await client.patch(
        f"{room.url}/groups/{made['id']}", json={"title": " Dragons "}, headers=room.master.headers
    )
    assert _retro(titled.json())[0]["groups"][0]["title"] == "Dragons"
    long_title = await client.patch(
        f"{room.url}/groups/{made['id']}", json={"title": "x" * 61}, headers=room.master.headers
    )
    assert long_title.status_code == 422
    assert (
        await client.patch(
            f"{room.url}/groups/{made['id']}", json={"title": "x"}, headers=room.player.headers
        )
    ).status_code == 403
    missing = await client.patch(
        f"{room.url}/groups/{uuid.uuid4()}", json={"title": "x"}, headers=room.master.headers
    )
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Group not found"

    # Taking one out keeps the group while two remain; deleting one more dissolves it.
    out = await client.post(f"{room.url}/cards/{three}/ungroup", headers=room.master.headers)
    assert len(_retro(out.json())[0]["groups"]) == 1
    unchanged = await client.post(f"{room.url}/cards/{three}/ungroup", headers=room.master.headers)
    assert unchanged.json()["revision"] == out.json()["revision"]
    assert (
        await client.post(f"{room.url}/cards/{one}/ungroup", headers=room.player.headers)
    ).status_code == 403
    dissolved = await client.delete(f"{room.url}/cards/{two}", headers=room.master.headers)
    assert _retro(dissolved.json())[0]["groups"] == []
    assert {c["group_id"] for c in _retro(dissolved.json())[0]["cards"]} == {None}

    # Two groups merge into the first post-it's; "Ungroup all" keeps the post-its.
    four = await _posted(client, room, room.player, want, "Basilisks")
    five = await _posted(client, room, room.player, want, "Hydras")
    await group(room.master, one, three)
    await group(room.master, four, five)
    merged = _retro((await group(room.master, five, one)).json())[0]
    (kept,) = merged["groups"]
    assert {c["group_id"] for c in merged["cards"] if c["id"] != draft} == {kept["id"]}
    assert (
        await client.delete(f"{room.url}/groups/{kept['id']}", headers=room.player.headers)
    ).status_code == 403
    ungrouped = await client.delete(f"{room.url}/groups/{kept['id']}", headers=room.master.headers)
    assert _retro(ungrouped.json())[0]["groups"] == []
    assert len(_retro(ungrouped.json())[0]["cards"]) == 4

    # A new round starts without groups; the closed round's are read-only.
    await group(room.master, one, three)
    closed_round = (await _get(client, room, room.master))["round_id"]
    fresh = (await client.post(f"{room.url}/rounds", json={}, headers=room.master.headers)).json()
    assert all(c["groups"] == [] for c in _retro(fresh))
    old = await _get(client, room, room.master, round_id=closed_round)
    (old_group,) = _retro(old)[0]["groups"]
    assert not any(c["can_group"] for c in _cards(old))
    for response in (
        await group(room.master, four, five),
        await client.patch(
            f"{room.url}/groups/{old_group['id']}", json={"title": "x"}, headers=room.master.headers
        ),
        await client.delete(f"{room.url}/groups/{old_group['id']}", headers=room.master.headers),
        await client.post(f"{room.url}/cards/{one}/ungroup", headers=room.master.headers),
    ):
        assert response.status_code == 409


async def test_the_master_deletes_the_session_zero(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Spec 46c Decision 3: everything goes, then anyone starts afresh."""
    room, board = await _started(client, make_token)
    want = _retro(board)[0]["id"]
    card_id = await _posted(client, room, room.player, want, "Dragons")
    await _write(client, room, room.player, want, "Draft")
    await client.post(
        f"{room.url}/cards/{card_id}/promote",
        json={"column_id": _column(board, "lines")},
        headers=room.master.headers,
    )
    await client.post(f"{room.url}/rounds", json={}, headers=room.master.headers)
    revision = (await _get(client, room, room.master))["revision"]
    listener = await _listen(client, room, room.player)

    assert (await client.delete(room.url, headers=room.player.headers)).status_code == 403
    deleted = await client.delete(room.url, headers=room.master.headers)
    assert deleted.status_code == 200
    assert deleted.json()["started"] is False
    assert (await _get(client, room, room.player))["started"] is False
    assert (await client.delete(room.url, headers=room.master.headers)).status_code == 409
    broker.disconnect(uuid.UUID(room.id))
    assert await _heard(listener) == [{"revision": revision + 1, "kind": "reset", "id": None}]

    again = (await client.post(f"{room.url}/start", headers=room.player.headers)).json()
    assert again["revision"] == 1
    assert [r["number"] for r in again["rounds"]] == [1]
    assert [c["color"] for c in _retro(again)] == ["green", "gold", "red"]
    assert _cards(again) == []


def _order(column: Any) -> list[Any]:
    """A column as drawn (spec 46d Decision 7): its post-its in no group and
    its groups by `position`, a group as the list of its post-its."""
    groups = {g["id"]: g["position"] for g in column["groups"]}
    items: list[tuple[int, Any]] = [
        (c["position"], c["body"]) for c in column["cards"] if c["group_id"] is None
    ]
    for group_id, position in groups.items():
        members = sorted(
            (c["position"], c["body"]) for c in column["cards"] if c["group_id"] == group_id
        )
        items.append((position, [body for _, body in members]))
    return [item for _, item in sorted(items, key=lambda pair: pair[0])]


async def test_members_drag_post_its_into_place(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Spec 46d Decision 7 and Q2: the Master moves any post-it, a Player
    their own, drafts included, within the open round's Retro board."""
    room, board = await _started(client, make_token)
    want, care = _retro(board)[0]["id"], _retro(board)[1]["id"]
    one = await _posted(client, room, room.player, want, "Dragons")
    two = await _posted(client, room, room.other_player, want, "Wyverns")
    draft = await _write(client, room, room.player, want, "Drakes")

    async def place(member: _Member, card_id: str, **body: str | None) -> Response:
        return await client.put(
            f"{room.url}/cards/{card_id}/place", json=body, headers=member.headers
        )

    # New post-its come last; only the viewer's own carry the handle.
    player_view = await _get(client, room, room.player)
    assert _order(_retro(player_view)[0]) == ["Dragons", "Wyverns", "Drakes"]
    assert {c["id"] for c in _cards(player_view) if c["can_place"]} == {one, draft}
    assert all(c["can_place"] for c in _cards(await _get(client, room, room.master)))

    # A Player's draft moves first; nobody else hears of it.
    revision = player_view["revision"]
    moved = await place(room.player, draft, column_id=want, before_id=one)
    assert moved.status_code == 200, moved.text
    assert _order(_retro(moved.json())[0]) == ["Drakes", "Dragons", "Wyverns"]
    assert moved.json()["revision"] == revision
    assert _order(_retro(await _get(client, room, room.master))[0]) == ["Dragons", "Wyverns"]
    # ...not even as where something else lands: like a missing id.
    hidden = await place(room.master, two, column_id=want, before_id=draft)
    assert hidden.status_code == 422
    assert (
        hidden.json()
        == (await place(room.master, two, column_id=want, before_id=str(uuid.uuid4()))).json()
    )

    # Someone else's post-it is the Master's to move; theirs goes to another column, last.
    assert (await place(room.player, two, column_id=want)).status_code == 403
    across = await place(room.master, two, column_id=care)
    assert across.json()["revision"] == revision + 1
    assert [c["body"] for c in _retro(across.json())[1]["cards"]] == ["Wyverns"]

    # Where it lands must be in that column; it stays on its board.
    assert (await place(room.player, one, column_id=want, before_id=two)).status_code == 422
    assert (await place(room.player, one, column_id=want, before_id=one)).status_code == 422
    lines = await place(room.master, one, column_id=_column(board, "lines"))
    assert lines.status_code == 422
    assert lines.json()["detail"] == (
        "A post-it or group only moves within its own board and session"
    )
    assert (await place(room.player, one, column_id=str(uuid.uuid4()))).status_code == 404

    # A closed round's post-its stay put.
    await client.post(f"{room.url}/rounds", json={}, headers=room.master.headers)
    assert (await place(room.master, one, column_id=want)).status_code == 409


async def test_dragging_post_its_into_and_out_of_groups(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Spec 46d Decision 7: groups keep their place in the column, and a
    Player groups their own post-its only (Q2)."""
    room, board = await _started(client, make_token)
    want, care = _retro(board)[0]["id"], _retro(board)[1]["id"]
    one = await _posted(client, room, room.player, want, "Dragons")
    two = await _posted(client, room, room.player, want, "Drakes")
    three = await _posted(client, room, room.other_player, want, "Wyverns")
    four = await _posted(client, room, room.player, want, "Basilisks")
    draft = await _write(client, room, room.player, want, "Hydras")

    async def place(member: _Member, card_id: str, **body: str | None) -> Response:
        return await client.put(
            f"{room.url}/cards/{card_id}/place", json=body, headers=member.headers
        )

    async def group(member: _Member, *card_ids: str) -> Response:
        return await client.post(
            f"{room.url}/groups", json={"card_ids": list(card_ids)}, headers=member.headers
        )

    # A Player drops their post-it on another of theirs: the group stands
    # where the one dropped on did.
    grouped = await group(room.player, two, four)
    assert grouped.status_code == 200, grouped.text
    column = _retro(grouped.json())[0]
    assert _order(column) == ["Dragons", ["Drakes", "Basilisks"], "Wyverns", "Hydras"]
    (made,) = column["groups"]
    assert (await group(room.player, one, three)).status_code == 403
    assert (await group(room.player, three, two)).status_code == 403

    # Dropped into the group: theirs, published, into a group of theirs only.
    joined = await place(room.player, one, column_id=want, group_id=made["id"], before_id=four)
    assert _order(_retro(joined.json())[0]) == [
        ["Drakes", "Dragons", "Basilisks"],
        "Wyverns",
        "Hydras",
    ]
    assert (await place(room.player, draft, column_id=want, group_id=made["id"])).status_code == 422
    assert (
        await place(room.player, one, column_id=want, group_id=made["id"], before_id=three)
    ).status_code == 422
    assert (await place(room.player, one, column_id=care, group_id=made["id"])).status_code == 422
    missing = await place(room.player, one, column_id=want, group_id=str(uuid.uuid4()))
    assert missing.status_code == 404
    mixed = await place(room.master, three, column_id=want, group_id=made["id"])
    assert _order(_retro(mixed.json())[0])[0] == ["Drakes", "Dragons", "Basilisks", "Wyverns"]
    assert (await place(room.player, one, column_id=want)).status_code == 403
    assert (await place(room.player, one, column_id=want, group_id=made["id"])).status_code == 200

    # Taken out, a post-it lands just after its group; left alone, the last
    # one takes the group's place.
    out = await client.post(f"{room.url}/cards/{three}/ungroup", headers=room.master.headers)
    assert _order(_retro(out.json())[0]) == [["Drakes", "Basilisks", "Dragons"], "Wyverns"]
    await place(room.player, one, column_id=want, before_id=draft)
    alone = await place(room.player, four, column_id=care)
    assert _order(_retro(alone.json())[0]) == ["Drakes", "Wyverns", "Dragons", "Hydras"]
    assert _retro(alone.json())[0]["groups"] == []

    # "Ungroup all" leaves the post-its where the group stood.
    regrouped = _retro((await group(room.master, three, two, one)).json())[0]
    assert _order(regrouped) == [["Wyverns", "Drakes", "Dragons"]]
    (kept,) = regrouped["groups"]
    ungrouped = await client.delete(f"{room.url}/groups/{kept['id']}", headers=room.master.headers)
    assert _order(_retro(ungrouped.json())[0]) == ["Wyverns", "Drakes", "Dragons"]
    player_view = await _get(client, room, room.player)
    assert _order(_retro(player_view)[0]) == ["Wyverns", "Drakes", "Dragons", "Hydras"]


async def test_the_master_drags_groups_and_lines_and_veils(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Spec 46d Decision 7: a group moves as one block; Lines & Veils is
    ordered by the Master."""
    room, board = await _started(client, make_token)
    want, care = _retro(board)[0]["id"], _retro(board)[1]["id"]
    one = await _posted(client, room, room.player, want, "Dragons")
    two = await _posted(client, room, room.player, want, "Drakes")
    three = await _posted(client, room, room.player, care, "Wyverns")
    made = _retro(
        (
            await client.post(
                f"{room.url}/groups", json={"card_ids": [one, two]}, headers=room.master.headers
            )
        ).json()
    )[0]["groups"][0]

    async def place_group(member: _Member, **body: str | None) -> Response:
        return await client.put(
            f"{room.url}/groups/{made['id']}/place", json=body, headers=member.headers
        )

    assert (await place_group(room.player, column_id=care)).status_code == 403
    assert (await place_group(room.master, column_id=care, before_id=one)).status_code == 422
    assert (await place_group(room.master, column_id=_column(board, "must"))).status_code == 422
    moved = await place_group(room.master, column_id=care, before_id=three)
    assert moved.status_code == 200, moved.text
    assert _order(_retro(moved.json())[0]) == []
    assert _order(_retro(moved.json())[1]) == [["Dragons", "Drakes"], "Wyverns"]
    last = await place_group(room.master, column_id=care)
    assert _order(_retro(last.json())[1]) == ["Wyverns", ["Dragons", "Drakes"]]

    # Lines & Veils: copies come last; the Master reorders them and moves
    # them between rows.
    must, lines = _column(board, "must"), _column(board, "lines")
    for card_id in (one, three):
        await client.post(
            f"{room.url}/cards/{card_id}/promote",
            json={"column_id": must},
            headers=room.master.headers,
        )
    copies = {
        c["body"]: c["id"]
        for c in (await _get(client, room, room.master))["lines_veils"][0]["cards"]
    }
    assert list(copies) == ["Dragons", "Wyverns"]
    assert (
        await client.put(
            f"{room.url}/cards/{copies['Wyverns']}/place",
            json={"column_id": must, "before_id": copies["Dragons"]},
            headers=room.player.headers,
        )
    ).status_code == 403
    reordered = await client.put(
        f"{room.url}/cards/{copies['Wyverns']}/place",
        json={"column_id": must, "before_id": copies["Dragons"]},
        headers=room.master.headers,
    )
    assert [c["body"] for c in reordered.json()["lines_veils"][0]["cards"]] == [
        "Wyverns",
        "Dragons",
    ]
    to_lines = await client.put(
        f"{room.url}/cards/{copies['Wyverns']}/place",
        json={"column_id": lines},
        headers=room.master.headers,
    )
    assert [c["body"] for c in to_lines.json()["lines_veils"][2]["cards"]] == ["Wyverns"]

    # A closed round's groups stay put.
    await client.post(f"{room.url}/rounds", json={}, headers=room.master.headers)
    assert (await place_group(room.master, column_id=care)).status_code == 409


# Spec 47: a modular Session 0.


def _module(board: Any, kind: str, index: int = 0) -> Any:
    return [m for m in board["modules"] if m["kind"] == kind][index]


async def _composed(
    client: AsyncClient, make_token: Callable[..., str], *kinds: str
) -> tuple[_Room, Any]:
    room = await _room(client, make_token)
    response = await client.post(
        f"{room.url}/start", json={"modules": list(kinds)}, headers=room.master.headers
    )
    assert response.status_code == 200, response.text
    return room, response.json()


async def test_session_zero_starts_with_a_chain(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 2: anyone starts with the default chain, only the Master
    composes one; Stars and Wishes brings its two fixed columns."""
    room, started = await _started(client, make_token)
    # The Player who started it sees the first step only.
    assert [m["kind"] for m in started["modules"]] == ["retro"]
    assert started["hidden_modules"] == 1
    board = await _get(client, room, room.master)
    assert [m["kind"] for m in board["modules"]] == ["retro", "lines_veils"]
    assert board["current_module_id"] == board["modules"][0]["id"]
    assert board["hidden_modules"] == 0
    assert _module(board, "lines_veils")["columns"] == []

    other = await _room(client, make_token)
    refused = await client.post(
        f"{other.url}/start", json={"modules": ["retro"]}, headers=other.player.headers
    )
    assert refused.status_code == 403
    for chain in ([], ["retro"] * 11):
        bad = await client.post(
            f"{other.url}/start", json={"modules": chain}, headers=other.master.headers
        )
        assert bad.status_code == 422

    _, composed = await _composed(client, make_token, "stars_wishes", "retro")
    stars = _module(composed, "stars_wishes")
    assert [(c["kind"], c["color"]) for c in stars["columns"]] == [
        ("stars", "gold"),
        ("wishes", "blue"),
    ]
    assert composed["current_module_id"] == stars["id"]


async def test_players_see_only_the_steps_reached(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decisions 4 and 5: later steps are hidden from Players (404 when
    written to) until the Master moves the table on."""
    room, board = await _composed(client, make_token, "retro", "stars_wishes")
    retro, stars = board["modules"]
    star_column = stars["columns"][0]["id"]
    master_card = await _posted(client, room, room.master, star_column, "Mine")
    group_id = str(
        _module(
            (
                await client.post(
                    f"{room.url}/groups",
                    json={
                        "card_ids": [
                            master_card,
                            await _posted(client, room, room.master, star_column, "Also mine"),
                        ]
                    },
                    headers=room.master.headers,
                )
            ).json(),
            "stars_wishes",
        )["columns"][0]["groups"][0]["id"]
    )

    seen = await _get(client, room, room.player)
    assert [m["id"] for m in seen["modules"]] == [retro["id"]]
    assert seen["hidden_modules"] == 1
    hidden_write = await client.post(
        f"{room.url}/cards",
        json={"column_id": star_column, "body": "Early"},
        headers=room.player.headers,
    )
    assert hidden_write.status_code == 404
    hidden_card = await client.put(
        f"{room.url}/cards/{master_card}/reactions/{quote('👍')}", headers=room.player.headers
    )
    assert hidden_card.status_code == 404
    hidden_group = await client.delete(f"{room.url}/groups/{group_id}", headers=room.player.headers)
    assert hidden_group.status_code == 404

    async def move(member: _Member, module_id: str) -> Response:
        return await client.put(
            f"{room.url}/modules/current", json={"module_id": module_id}, headers=member.headers
        )

    assert (await move(room.player, stars["id"])).status_code == 403
    assert (await move(room.master, str(uuid.uuid4()))).status_code == 404
    revision = board["revision"]
    same = await move(room.master, retro["id"])
    assert same.json()["revision"] == (await _get(client, room, room.master))["revision"]
    moved = await move(room.master, stars["id"])
    assert moved.status_code == 200
    assert moved.json()["revision"] > revision
    now_seen = await _get(client, room, room.player)
    assert [m["id"] for m in now_seen["modules"]] == [retro["id"], stars["id"]]
    assert now_seen["current_module_id"] == stars["id"]
    assert await _write(client, room, room.player, star_column, "Now") != ""


async def test_the_master_composes_the_open_sessions_chain(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 3: add, reorder and remove steps; removing the current one
    moves the table back; the chain keeps one."""
    room, _ = await _started(client, make_token)
    board = await _get(client, room, room.master)
    retro, lines = board["modules"]

    refused = await client.post(
        f"{room.url}/modules", json={"kind": "retro"}, headers=room.player.headers
    )
    assert refused.status_code == 403
    added = await client.post(
        f"{room.url}/modules", json={"kind": "stars_wishes"}, headers=room.master.headers
    )
    assert added.status_code == 200
    stars = added.json()["modules"][-1]
    assert (stars["kind"], stars["position"]) == ("stars_wishes", 2)
    for _ in range(7):
        more = await client.post(
            f"{room.url}/modules", json={"kind": "retro"}, headers=room.master.headers
        )
        assert more.status_code == 200
    full = await client.post(
        f"{room.url}/modules", json={"kind": "retro"}, headers=room.master.headers
    )
    assert full.status_code == 422
    # The added Retro modules start with the preset columns.
    assert len(_module(more.json(), "retro", 1)["columns"]) == 3

    ids = [m["id"] for m in more.json()["modules"]]

    async def order(member: _Member, module_ids: list[str]) -> Response:
        return await client.put(
            f"{room.url}/modules/order", json={"module_ids": module_ids}, headers=member.headers
        )

    assert (await order(room.player, ids[::-1])).status_code == 403
    assert (await order(room.master, ids[1:])).status_code == 422
    reordered = await order(room.master, ids[::-1])
    assert [m["id"] for m in reordered.json()["modules"]] == ids[::-1]
    assert reordered.json()["current_module_id"] == retro["id"]

    async def remove(member: _Member, module_id: str) -> Response:
        return await client.delete(f"{room.url}/modules/{module_id}", headers=member.headers)

    assert (await remove(room.player, stars["id"])).status_code == 403
    # Removing the current step moves the table to the one before it.
    removed = await remove(room.master, retro["id"])
    assert removed.status_code == 200
    data = removed.json()
    remaining = [m["id"] for m in data["modules"]]
    assert retro["id"] not in remaining
    assert data["current_module_id"] == ids[::-1][-2]
    assert [m["position"] for m in data["modules"]] == list(range(len(remaining)))
    for module_id in remaining[1:]:
        assert (await remove(room.master, module_id)).status_code == 200
    last = await remove(room.master, remaining[0])
    assert last.status_code == 409
    assert lines["id"] in remaining


async def test_a_new_session_takes_its_own_chain(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 2: a new session copies the previous chain, or takes the one
    the Master composes. Its steps start empty (spec 47b): a Retro step
    carrying over takes the newest session's Nth Retro columns (its last
    when it has fewer), presets otherwise. The closed session's steps can't
    move."""
    room, board = await _composed(client, make_token, "retro", "stars_wishes")
    retro_columns = _module(board, "retro")["columns"]
    renamed = await client.patch(
        f"{room.url}/columns/{retro_columns[0]['id']}",
        json={"title": "Hopes"},
        headers=room.master.headers,
    )
    assert renamed.status_code == 200
    copied = await client.post(f"{room.url}/rounds", json={}, headers=room.master.headers)
    assert [m["kind"] for m in copied.json()["modules"]] == ["retro", "stars_wishes"]
    assert _retro(copied.json())[0]["title"] != "Hopes"
    assert copied.json()["current_module_id"] == copied.json()["modules"][0]["id"]

    # A step added with "carry" takes the closed session's (its only Retro
    # step for a second one); Stars and Wishes has nothing to carry.
    nothing = await client.post(
        f"{room.url}/modules",
        json={"kind": "stars_wishes", "carry": True},
        headers=room.master.headers,
    )
    assert nothing.status_code == 200
    carried = await client.post(
        f"{room.url}/modules", json={"kind": "retro", "carry": True}, headers=room.master.headers
    )
    assert _module(carried.json(), "retro", 1)["columns"][0]["title"] == "Hopes"

    composed = await client.post(
        f"{room.url}/rounds",
        json={
            "title": "Fine arco",
            "modules": [
                "lines_veils",
                {"kind": "retro", "carry": True},
                {"kind": "retro", "carry": True},
                {"kind": "retro", "carry": True},
                "retro",
            ],
        },
        headers=room.master.headers,
    )
    assert composed.status_code == 200
    data = composed.json()
    assert [m["kind"] for m in data["modules"]] == ["lines_veils", *["retro"] * 4]
    titles = [_module(data, "retro", i)["columns"][0]["title"] for i in range(4)]
    assert titles[1] == titles[2] == "Hopes" != titles[0] == titles[3]
    bad = await client.post(f"{room.url}/rounds", json={"modules": []}, headers=room.master.headers)
    assert bad.status_code == 422

    first_round = data["rounds"][0]["id"]
    old = await _get(client, room, room.master, round_id=first_round)
    old_stars = _module(old, "stars_wishes")["id"]
    closed_move = await client.put(
        f"{room.url}/modules/current", json={"module_id": old_stars}, headers=room.master.headers
    )
    assert closed_move.status_code == 409
    closed_remove = await client.delete(
        f"{room.url}/modules/{old_stars}", headers=room.master.headers
    )
    assert closed_remove.status_code == 409


async def test_stars_and_wishes_is_a_fixed_post_it_board(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 7: drafts, publishing and reactions as on the Retro, but its
    columns can't be renamed, reordered or added to, and nothing is
    promoted from it. Columns go to Retro modules only."""
    room, board = await _composed(client, make_token, "stars_wishes", "retro")
    stars, retro = board["modules"]
    star_column = stars["columns"][0]["id"]
    card_id = await _posted(client, room, room.master, star_column, "The finale")
    must = _column(board, "must")
    promote = await client.post(
        f"{room.url}/cards/{card_id}/promote",
        json={"column_id": must},
        headers=room.master.headers,
    )
    assert promote.status_code == 422
    rename = await client.patch(
        f"{room.url}/columns/{star_column}", json={"title": "x"}, headers=room.master.headers
    )
    assert rename.status_code == 422
    reorder = await client.put(
        f"{room.url}/columns/order",
        json={"column_ids": [c["id"] for c in stars["columns"]][::-1]},
        headers=room.master.headers,
    )
    assert reorder.status_code == 422
    for module_id, expected in ((stars["id"], 422), (str(uuid.uuid4()), 404)):
        added = await client.post(
            f"{room.url}/columns",
            json={"title": "More", "module_id": module_id},
            headers=room.master.headers,
        )
        assert added.status_code == expected
    to_retro = await client.post(
        f"{room.url}/columns",
        json={"title": "More", "module_id": retro["id"]},
        headers=room.master.headers,
    )
    assert _retro(to_retro.json())[-1]["title"] == "More"

    # A chain with no Retro module takes no column without one named.
    only_stars, _ = await _composed(client, make_token, "stars_wishes")
    nowhere = await client.post(
        f"{only_stars.url}/columns", json={"title": "More"}, headers=only_stars.master.headers
    )
    assert nowhere.status_code == 422


async def test_publish_all_fills_each_module_up_to_its_limit(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Publish-all goes module by module: a full board's drafts wait while
    another module's are published."""
    monkeypatch.setattr(session_zero, "MAX_CARDS_PER_BOARD", 1)
    room, board = await _composed(client, make_token, "retro", "stars_wishes")
    retro, stars = board["modules"]
    await client.put(
        f"{room.url}/modules/current", json={"module_id": stars["id"]}, headers=room.master.headers
    )
    waiting = await _write(client, room, room.player, retro["columns"][1]["id"], "Waits")
    await _posted(client, room, room.master, retro["columns"][0]["id"], "Full")
    only = await client.post(
        f"{room.url}/cards/publish-all", json={"anonymous": False}, headers=room.player.headers
    )
    assert only.status_code == 409
    star = await _write(client, room, room.player, stars["columns"][0]["id"], "Shines")
    published = await client.post(
        f"{room.url}/cards/publish-all", json={"anonymous": False}, headers=room.player.headers
    )
    assert published.status_code == 200
    by_id = {c["id"]: c for c in _cards(published.json())}
    assert (by_id[star]["draft"], by_id[waiting]["draft"]) == (False, True)

"""Session 0 boards (spec 46): `/rooms/{id}/session-zero` - the Retro board
in rounds, the Lines & Veils board, drafts, promotion, reactions and the
shared timer."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

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


def _cards(board: Any) -> list[Any]:
    return [card for column in board["retro"] + board["lines_veils"] for card in column["cards"]]


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
    assert [c["title"] for c in board["retro"]] == [
        "Lo vogliamo al tavolo",
        "Con cura",
        "Da evitare",
        "Domande",
    ]
    assert [c["kind"] for c in board["lines_veils"]] == ["must", "lines", "veils"]
    assert [r["number"] for r in board["rounds"]] == [1]
    assert board["round_id"] == board["rounds"][0]["id"]
    assert board["timer"]["state"] == "stopped"

    again = (await client.post(f"{room.url}/start", headers=room.master.headers)).json()
    assert again["revision"] == 1
    assert again["can_manage"] is True
    assert again["retro"] == board["retro"]


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
    want = board["retro"][0]["id"]

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
    card_id = await _write(client, room, room.player, board["retro"][2]["id"], "Gore")
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
    want = board["retro"][0]["id"]

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
    wrong = await add(_column(board, "lines"), "Hi")
    assert wrong.status_code == 422

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
        client, elsewhere, elsewhere.player, other_board["retro"][0]["id"], "Elsewhere"
    )
    missing = await client.delete(f"{room.url}/cards/{foreign}", headers=room.master.headers)
    assert missing.status_code == 404


async def test_deleting_post_its(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room, board = await _started(client, make_token)
    want = board["retro"][0]["id"]
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
    avoid = board["retro"][2]["id"]
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
    card_id = await _write(client, room, room.player, board["retro"][2]["id"], "Spiders")
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
    want = board["retro"][0]["id"]
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
            json={"column_id": board["retro"][0]["id"], "body": "x"},
            headers=view_as,
        ),
    ):
        assert response.status_code == 403


async def test_members_react_to_published_post_its(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room, board = await _started(client, make_token)
    want = board["retro"][0]["id"]
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
    first = board["retro"][0]["id"]
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
    assert [c["title"] for c in added.json()["retro"]][-1] == "Tone"
    blank = await client.post(
        f"{room.url}/columns", json={"title": ""}, headers=room.master.headers
    )
    assert blank.status_code == 422
    assert blank.json()["detail"] == "The title must be 1 to 60 characters"

    renamed = await client.patch(
        f"{room.url}/columns/{first}", json={"title": "Wishes"}, headers=room.master.headers
    )
    assert renamed.json()["retro"][0]["title"] == "Wishes"
    not_retro = await client.patch(
        f"{room.url}/columns/{lines}", json={"title": "X"}, headers=room.master.headers
    )
    assert not_retro.status_code == 422
    missing = await client.patch(
        f"{room.url}/columns/{uuid.uuid4()}", json={"title": "X"}, headers=room.master.headers
    )
    assert missing.status_code == 404

    ids = [c["id"] for c in renamed.json()["retro"]]
    reordered = await client.put(
        f"{room.url}/columns/order", json={"column_ids": ids[::-1]}, headers=room.master.headers
    )
    assert [c["id"] for c in reordered.json()["retro"]] == ids[::-1]
    for wrong in (ids[1:], ids + [ids[0]], [*ids[1:], lines]):
        bad = await client.put(
            f"{room.url}/columns/order", json={"column_ids": wrong}, headers=room.master.headers
        )
        assert bad.status_code == 422

    await _posted(client, room, room.player, first, "Gone with the column")
    deleted = await client.delete(f"{room.url}/columns/{first}", headers=room.master.headers)
    assert first not in [c["id"] for c in deleted.json()["retro"]]
    assert _cards(deleted.json()) == []
    assert (
        await client.delete(f"{room.url}/columns/{lines}", headers=room.master.headers)
    ).status_code == 422

    for n in range(8 - len(deleted.json()["retro"])):
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
    old_want = board["retro"][0]["id"]
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
    assert [c["title"] for c in data["retro"]] == [c["title"] for c in board["retro"]]
    assert all(not c["cards"] for c in data["retro"])
    assert [c["body"] for c in _cards(data)] == ["Kept"]

    old = await _get(client, room, room.player, round_id=board["round_id"])
    (card,) = old["retro"][0]["cards"]
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

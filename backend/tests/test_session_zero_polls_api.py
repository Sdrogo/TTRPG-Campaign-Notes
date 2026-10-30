"""Session 0's Poll module (spec 53): the Master's polls and their
settings, voting, the tally and the names each member sees, closing and
revealing, carry over and personal data."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import session_zero_polls_repo
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


async def _room(
    client: AsyncClient, make_token: Callable[..., str], *kinds: str
) -> tuple[_Room, Any]:
    """A Room of a Master and two Players whose Session 0 is a chain of
    `kinds`, on its first step; the Master's view of it."""
    master = _new_member(make_token)
    created = (await client.post("/rooms", json={"name": "Barovia"}, headers=master.headers)).json()
    room = _Room(created["id"], master, _new_member(make_token), _new_member(make_token))
    await _join(client, room.id, master, room.player)
    await _join(client, room.id, master, room.other_player)
    started = await client.post(
        f"{room.url}/start", json={"modules": list(kinds)}, headers=master.headers
    )
    assert started.status_code == 200, started.text
    return room, started.json()


def _module(board: Any, index: int = 0) -> Any:
    return [m for m in board["modules"] if m["kind"] == "poll"][index]


def _poll(
    body: str = "System?", options: tuple[str, ...] = ("D&D", "PbtA"), **settings: Any
) -> Any:
    return {"body": body, "options": [{"body": o} for o in options], **settings}


async def _set(client: AsyncClient, room: _Room, module_id: str, *polls: Any) -> Any:
    response = await client.put(
        f"{room.url}/modules/{module_id}/polls",
        json={"polls": list(polls)},
        headers=room.master.headers,
    )
    assert response.status_code == 200, response.text
    return _module(response.json())["polls"]


async def _vote(
    client: AsyncClient, room: _Room, member: _Member, poll: Any, *indexes: int
) -> Response:
    return await client.put(
        f"{room.url}/polls/{poll['id']}/vote",
        json={"option_ids": [poll["options"][i]["id"] for i in indexes]},
        headers=member.headers,
    )


async def _view(client: AsyncClient, room: _Room, member: _Member) -> Any:
    response = await client.get(room.url, headers=member.headers)
    assert response.status_code == 200, response.text
    return _module(response.json())["polls"]


async def test_the_master_writes_polls(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decisions 2 and 3: the whole list in order; ids keep polls and
    choices, new ones are added, those left out go."""
    room, board = await _room(client, make_token, "poll")
    module = _module(board)
    assert module["polls"] == []
    [first, second] = await _set(
        client,
        room,
        module["id"],
        _poll(hint=" pick one "),
        _poll("Day?", ("Mon", "Tue", "Wed"), max_choices=2, master_votes=True),
    )
    assert first["hint"] == "pick one" and first["max_choices"] == 1
    assert first["voters_visible"] == "master" and first["results"] == "live"
    assert second["max_choices"] == 2 and second["master_votes"] is True
    assert second["electorate"] == 3 and first["electorate"] == 2

    kept = second["options"][0]
    [moved, added] = await _set(
        client,
        room,
        module["id"],
        {
            "id": second["id"],
            "body": "Day?",
            "max_choices": 2,
            "master_votes": True,
            "options": [{"id": kept["id"], "body": "Monday"}, {"body": "Fri"}],
        },
        _poll("Tone?", ("Grim", "Light")),
    )
    assert moved["id"] == second["id"] and moved["position"] == 0
    assert [(o["id"] == kept["id"], o["body"]) for o in moved["options"]] == [
        (True, "Monday"),
        (False, "Fri"),
    ]
    assert added["body"] == "Tone?"


async def test_polls_setup_errors(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room, board = await _room(client, make_token, "poll", "retro")
    module_id = _module(board)["id"]
    url = f"{room.url}/modules/{module_id}/polls"
    one = {"polls": [_poll()]}
    assert (await client.put(url, json=one, headers=room.player.headers)).status_code == 403
    retro = next(m for m in board["modules"] if m["kind"] == "retro")
    not_poll = await client.put(
        f"{room.url}/modules/{retro['id']}/polls", json=one, headers=room.master.headers
    )
    assert not_poll.status_code == 422
    short = {"polls": [_poll(options=("Only",))]}
    assert (await client.put(url, json=short, headers=room.master.headers)).status_code == 422

    [poll] = await _set(client, room, module_id, _poll())
    stray = {
        "polls": [
            {**_poll(), "options": [{"id": poll["options"][0]["id"], "body": "a"}, {"body": "b"}]}
        ]
    }
    assert (await client.put(url, json=stray, headers=room.master.headers)).status_code == 422
    unknown = {"polls": [{**_poll(), "id": str(uuid.uuid4())}]}
    assert (await client.put(url, json=unknown, headers=room.master.headers)).status_code == 422
    other = {
        "polls": [
            {
                **_poll(),
                "id": poll["id"],
                "options": [{"id": str(uuid.uuid4()), "body": "x"}, {"body": "y"}],
            }
        ]
    }
    assert (await client.put(url, json=other, headers=room.master.headers)).status_code == 422

    assert (await _vote(client, room, room.player, poll, 0)).status_code == 200
    locked = {"polls": [{**_poll(results="hidden"), "id": poll["id"]}]}
    response = await client.put(url, json=locked, headers=room.master.headers)
    assert response.status_code == 409
    same = {"polls": [{**_poll("Which system?"), "id": poll["id"]}]}
    assert (await client.put(url, json=same, headers=room.master.headers)).status_code == 200


async def test_voting(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 4: a vote replaces the previous one, none withdraws it, no
    more than the votes per person, the Master only when the poll says so."""
    room, board = await _room(client, make_token, "poll")
    [single, multi] = await _set(
        client,
        room,
        _module(board)["id"],
        _poll(),
        _poll("Day?", ("Mon", "Tue", "Wed"), max_choices=2),
    )
    assert (await _vote(client, room, room.master, single, 0)).status_code == 403
    assert (await _vote(client, room, room.player, single, 0, 1)).status_code == 422
    assert (await _vote(client, room, room.player, multi, 0, 0)).status_code == 422
    stray = await client.put(
        f"{room.url}/polls/{single['id']}/vote",
        json={"option_ids": [multi["options"][0]["id"]]},
        headers=room.player.headers,
    )
    assert stray.status_code == 422

    voted = await _vote(client, room, room.player, multi, 0, 2)
    assert voted.status_code == 200
    mine = _module(voted.json())["polls"][1]
    assert set(mine["my_option_ids"]) == {multi["options"][0]["id"], multi["options"][2]["id"]}
    assert mine["voter_count"] == 1 and mine["can_vote"] is True
    changed = _module((await _vote(client, room, room.player, multi, 1)).json())["polls"][1]
    assert changed["my_option_ids"] == [multi["options"][1]["id"]]
    assert [o["count"] for o in changed["options"]] == [0, 1, 0]
    again = await _vote(client, room, room.player, multi, 1)
    assert (
        again.json()["revision"]
        == (await client.get(room.url, headers=room.player.headers)).json()["revision"]
    )
    withdrawn = _module((await _vote(client, room, room.player, multi)).json())["polls"][1]
    assert withdrawn["my_option_ids"] == [] and withdrawn["voter_count"] == 0

    missing = await client.put(
        f"{room.url}/polls/{uuid.uuid4()}/vote",
        json={"option_ids": []},
        headers=room.player.headers,
    )
    assert missing.status_code == 404


async def test_tally_names_and_progress(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decisions 2 and 5: who sees the tally and the names, the voters
    count, who hasn't voted."""
    room, board = await _room(client, make_token, "poll")
    [named, public, anonymous, secret] = await _set(
        client,
        room,
        _module(board)["id"],
        _poll("A?"),
        _poll("B?", voters_visible="everyone"),
        _poll("C?", voters_visible="nobody"),
        _poll("D?", results="hidden", voters_visible="everyone"),
    )
    for poll in (named, public, anonymous, secret):
        await _vote(client, room, room.player, poll, 0)

    master = await _view(client, room, room.master)
    player = await _view(client, room, room.other_player)
    assert master[0]["options"][0]["voters"] == [room.player.id]
    assert master[0]["not_voted"] == [room.other_player.id]
    assert player[0]["options"][0] == {**player[0]["options"][0], "count": 1, "voters": None}
    assert player[0]["not_voted"] is None
    assert player[1]["options"][0]["voters"] == [room.player.id]
    assert master[2]["options"][0]["voters"] is None and master[2]["not_voted"] is None
    assert master[3]["options"][0]["count"] == 1 and master[3]["tally_visible"] is True
    assert player[3]["options"][0]["count"] is None and player[3]["options"][0]["voters"] is None
    assert player[3]["tally_visible"] is False and player[3]["voter_count"] == 1

    reveal = f"{room.url}/polls/{secret['id']}/reveal"
    body = {"revealed": True}
    assert (await client.put(reveal, json=body, headers=room.player.headers)).status_code == 403
    assert (await client.put(reveal, json=body, headers=room.master.headers)).status_code == 200
    assert (await client.put(reveal, json=body, headers=room.master.headers)).status_code == 200
    shown = (await _view(client, room, room.other_player))[3]
    assert shown["revealed"] is True and shown["options"][0]["count"] == 1
    assert shown["options"][0]["voters"] == [room.player.id]
    # Spec 54 Decision 7: a revealed secret poll shows its winner while open.
    assert [o["winner"] for o in shown["options"]] == [True, False]
    assert all(not o["winner"] for o in player[1]["options"])


async def test_closing(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 6: a closed poll takes no votes and shows its winners."""
    room, board = await _room(client, make_token, "poll")
    [poll] = await _set(client, room, _module(board)["id"], _poll(options=("A", "B", "C")))
    await _vote(client, room, room.player, poll, 0)
    await _vote(client, room, room.other_player, poll, 1)
    url = f"{room.url}/polls/{poll['id']}/closed"
    assert (
        await client.put(url, json={"closed": True}, headers=room.player.headers)
    ).status_code == 403
    closed = await client.put(url, json={"closed": True}, headers=room.master.headers)
    shown = _module(closed.json())["polls"][0]
    assert shown["closed"] is True and shown["can_vote"] is False
    assert [o["winner"] for o in shown["options"]] == [True, True, False]
    assert (
        await client.put(url, json={"closed": True}, headers=room.master.headers)
    ).status_code == 200
    assert (await _vote(client, room, room.player, poll, 2)).status_code == 409
    reopened = await client.put(url, json={"closed": False}, headers=room.master.headers)
    assert _module(reopened.json())["polls"][0]["closed"] is False
    assert (await _vote(client, room, room.player, poll, 2)).status_code == 200


async def test_choice_descriptions(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Spec 54 Decisions 1 and 12: a choice's description is stored
    trimmed, editable once the poll has votes (keeping them), 422 when too
    long, and carried over with the choice."""
    room, board = await _room(client, make_token, "poll")
    module_id = _module(board)["id"]
    [poll] = await _set(
        client,
        room,
        module_id,
        {
            "body": "Hook?",
            "options": [
                {"body": "Stanza 404", "description": "  All'#Hotel Kaguya...  "},
                {"body": "Budōkan"},
            ],
        },
    )
    assert [o["description"] for o in poll["options"]] == ["All'#Hotel Kaguya...", None]
    await _vote(client, room, room.player, poll, 0)
    [edited] = await _set(
        client,
        room,
        module_id,
        {
            "id": poll["id"],
            "body": "Hook?",
            "options": [
                {"id": poll["options"][0]["id"], "body": "Stanza 404", "description": ""},
                {"id": poll["options"][1]["id"], "body": "Budōkan", "description": "#SHITE"},
            ],
        },
    )
    assert [o["description"] for o in edited["options"]] == [None, "#SHITE"]
    assert edited["options"][0]["count"] == 1
    too_long = await client.put(
        f"{room.url}/modules/{module_id}/polls",
        json={
            "polls": [
                _poll() | {"options": [{"body": "a", "description": "d" * 2001}, {"body": "b"}]}
            ]
        },
        headers=room.master.headers,
    )
    assert too_long.status_code == 422

    fresh = await client.post(
        f"{room.url}/rounds",
        json={"modules": [{"kind": "poll", "carry": True}]},
        headers=room.master.headers,
    )
    assert fresh.status_code == 200, fresh.text
    copied = _module(fresh.json())["polls"][0]
    assert [o["description"] for o in copied["options"]] == [None, "#SHITE"]


async def test_hidden_steps_closed_sessions_and_other_rooms(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """A poll of a step not reached is 404 to a Player; a closed session's
    is read-only (409); another Room's poll is 404."""
    room, board = await _room(client, make_token, "retro", "poll")
    module_id = _module(board)["id"]
    [poll] = await _set(client, room, module_id, _poll())
    assert (await _vote(client, room, room.player, poll, 0)).status_code == 404
    await client.put(
        f"{room.url}/modules/current", json={"module_id": module_id}, headers=room.master.headers
    )
    assert (await _vote(client, room, room.player, poll, 0)).status_code == 200

    other, _ = await _room(client, make_token, "poll")
    stray = await client.put(
        f"{other.url}/polls/{poll['id']}/vote",
        json={"option_ids": []},
        headers=other.player.headers,
    )
    assert stray.status_code == 404

    fresh = await client.post(
        f"{room.url}/rounds",
        json={"modules": [{"kind": "poll", "carry": True}, "poll"]},
        headers=room.master.headers,
    )
    assert fresh.status_code == 200, fresh.text
    copied, empty = _module(fresh.json())["polls"], _module(fresh.json(), 1)["polls"]
    assert [p["body"] for p in copied] == ["System?"] and empty == []
    assert copied[0]["voter_count"] == 0 and copied[0]["id"] != poll["id"]
    assert (await _vote(client, room, room.player, poll, 1)).status_code == 409

    added = await client.post(
        f"{room.url}/modules", json={"kind": "poll", "carry": True}, headers=room.master.headers
    )
    assert [p["body"] for p in _module(added.json(), 2)["polls"]] == ["System?"]


async def test_votes_reach_every_stream(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 8: the voters count is public, so everyone hears of a vote."""
    room, board = await _room(client, make_token, "poll")
    [poll] = await _set(client, room, _module(board)["id"], _poll())
    room_id = uuid.UUID(room.id)
    streams = [broker.subscribe(room_id, uuid.UUID(m.id)) for m in (room.master, room.other_player)]
    try:
        await _vote(client, room, room.player, poll, 0)
        for stream in streams:
            event = stream.queue.get_nowait()
            assert event is not None and event.kind == "vote"
    finally:
        for stream in streams:
            broker.unsubscribe(stream)


async def test_votes_are_in_the_export(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 11, spec 31."""
    room, board = await _room(client, make_token, "poll")
    [poll] = await _set(client, room, _module(board)["id"], _poll())
    await _vote(client, room, room.player, poll, 1)
    export = await client.get("/account/export", headers=room.player.headers)
    assert export.status_code == 200, export.text
    assert [(v["room_id"], v["poll"], v["choice"]) for v in export.json()["votes"]] == [
        (room.id, "System?", "PbtA")
    ]
    assert await session_zero_polls_repo.list_polls(db_session, []) == []
    assert await session_zero_polls_repo.list_options(db_session, []) == []
    assert await session_zero_polls_repo.list_votes(db_session, []) == []

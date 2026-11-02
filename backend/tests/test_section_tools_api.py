"""A Section's tools (spec 60): a Session 0 step of its own in a tool
block, outside every session, hidden from the Players until the Master
shows it, deleted with its block, never in a copy or an export."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.realtime.broker import Event, broker


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
    section_id: str

    @property
    def url(self) -> str:
        return f"/rooms/{self.id}/sections/{self.section_id}"

    @property
    def zero(self) -> str:
        return f"/rooms/{self.id}/session-zero"


def _member(make_token: Callable[..., str]) -> _Member:
    user_id = str(uuid.uuid4())
    return _Member(
        user_id, {"Authorization": f"Bearer {make_token(user_id)}", "Accept-Language": "en"}
    )


async def _room(client: AsyncClient, make_token: Callable[..., str]) -> _Room:
    master, player = _member(make_token), _member(make_token)
    created = await client.post("/rooms", json={"name": "Barovia"}, headers=master.headers)
    room_id = created.json()["id"]
    invite = (
        await client.post(
            f"/rooms/{room_id}/invitations", json={"role": "player"}, headers=master.headers
        )
    ).json()
    await client.post(f"/invitations/{invite['code']}/accept", headers=player.headers)
    section = await client.post(
        f"/rooms/{room_id}/sections", json={"title": "Village"}, headers=master.headers
    )
    assert section.status_code == 201, section.text
    return _Room(room_id, master, player, section.json()["id"])


async def _tool(client: AsyncClient, room: _Room, kind: str) -> Any:
    """Adds a tool; its block."""
    response = await client.post(
        f"{room.url}/tools", json={"kind": kind}, headers=room.master.headers
    )
    assert response.status_code == 201, response.text
    return response.json()["blocks"][-1]


async def _show(client: AsyncClient, room: _Room, block: Any, visible: bool = True) -> Any:
    response = await client.put(
        f"{room.url}/tools/{block['module_id']}/visible",
        json={"visible": visible},
        headers=room.master.headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _tools(client: AsyncClient, room: _Room, member: _Member, **headers: str) -> Any:
    response = await client.get(f"{room.url}/tools", headers={**member.headers, **headers})
    assert response.status_code == 200, response.text
    return response.json()


async def _section(client: AsyncClient, room: _Room, member: _Member) -> Any:
    response = await client.get(room.url, headers=member.headers)
    assert response.status_code == 200, response.text
    return response.json()


def _body(block: Any) -> Any:
    keys = ("kind", "heading", "tag_ids", "groups", "map_kind", "features", "module_id")
    return {key: block[key] for key in keys} | {"collapsed": block["collapsed"]}


async def test_a_tool_is_added_hidden_without_starting_session_zero(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)

    block = await _tool(client, room, "poll")

    assert block["kind"] == "tool" and block["tool_kind"] == "poll"
    assert block["players_visible"] is False and block["collapsed"] is False
    assert (await _section(client, room, room.player))["blocks"] == []
    assert (await _tools(client, room, room.player))["tools"] == []
    (tool,) = (await _tools(client, room, room.master))["tools"]
    assert tool["module_id"] == block["module_id"] and tool["players_visible"] is False
    assert tool["module"]["kind"] == "poll" and tool["module"]["polls"] == []
    board = (await client.get(room.zero, headers=room.master.headers)).json()
    assert board["started"] is False and board["modules"] == []
    overview = (await client.get(f"{room.zero}/overview", headers=room.master.headers)).json()
    assert overview == {**overview, "started": False, "rounds": []}
    # Nothing the session-wide endpoints change exists yet.
    assert (await client.delete(room.zero, headers=room.master.headers)).status_code == 409
    publish_all = await client.post(
        f"{room.zero}/cards/publish-all", json={"anonymous": False}, headers=room.master.headers
    )
    assert publish_all.status_code == 409


async def test_who_adds_which_tool_where(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    sections = (await client.get(f"/rooms/{room.id}/sections", headers=room.master.headers)).json()
    page = sections[0]["id"]
    base = f"/rooms/{room.id}/sections"

    lines = await client.post(
        f"{room.url}/tools", json={"kind": "lines_veils"}, headers=room.master.headers
    )
    player = await client.post(
        f"{room.url}/tools", json={"kind": "retro"}, headers=room.player.headers
    )
    on_page = await client.post(
        f"{base}/{page}/tools", json={"kind": "retro"}, headers=room.master.headers
    )
    missing = await client.post(
        f"{base}/{uuid.uuid4()}/tools", json={"kind": "retro"}, headers=room.master.headers
    )

    assert lines.status_code == 422 and lines.json()["detail"]
    assert player.status_code == 403
    assert on_page.status_code == 409
    assert missing.status_code == 404
    assert (await client.get(f"{base}/{page}/tools", headers=room.player.headers)).json() == {
        "revision": 0,
        "tools": [],
    }


async def test_the_master_shows_and_hides_a_tool(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    block = await _tool(client, room, "stars_wishes")
    subscription = broker.subscribe(uuid.UUID(room.id), uuid.UUID(room.player.id))
    try:
        shown = await _show(client, room, block)
        again = await _show(client, room, block)
        events = []
        while not subscription.queue.empty():
            events.append(subscription.queue.get_nowait())
    finally:
        broker.unsubscribe(subscription)

    assert shown["blocks"][0]["players_visible"] is True
    assert again == shown
    assert Event(None, "changed", uuid.UUID(room.section_id), "landing") in events
    assert len(events) == 2  # the Session 0 change and the landing's, once
    (seen,) = (await _section(client, room, room.player))["blocks"]
    assert seen["players_visible"] is True
    (tool,) = (await _tools(client, room, room.player))["tools"]
    assert [c["kind"] for c in tool["module"]["columns"]] == ["stars", "wishes"]
    # "View as" previews the Players' view.
    viewed = await _tools(client, room, room.master, **{"X-View-As": room.player.id})
    assert len(viewed["tools"]) == 1

    hidden = await _show(client, room, block, visible=False)

    assert hidden["blocks"][0]["players_visible"] is False
    assert (await _tools(client, room, room.player))["tools"] == []
    wrong = await client.put(
        f"{room.url}/tools/{uuid.uuid4()}/visible",
        json={"visible": True},
        headers=room.master.headers,
    )
    assert wrong.status_code == 404
    by_player = await client.put(
        f"{room.url}/tools/{block['module_id']}/visible",
        json={"visible": True},
        headers=room.player.headers,
    )
    assert by_player.status_code == 403


async def test_a_poll_tool_keeps_its_votes_until_its_block_goes(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    block = await _tool(client, room, "poll")
    module_id = block["module_id"]
    written = await client.put(
        f"{room.zero}/modules/{module_id}/polls",
        json={"polls": [{"body": "System?", "options": [{"body": "D&D"}, {"body": "PbtA"}]}]},
        headers=room.master.headers,
    )
    assert written.status_code == 200, written.text
    (poll,) = (await _tools(client, room, room.master))["tools"][0]["module"]["polls"]
    vote_url = f"{room.zero}/polls/{poll['id']}/vote"
    vote = {"option_ids": [poll["options"][0]["id"]]}

    hidden_vote = await client.put(vote_url, json=vote, headers=room.player.headers)
    await _show(client, room, block)
    voted = await client.put(vote_url, json=vote, headers=room.player.headers)

    assert hidden_vote.status_code == 404
    assert voted.status_code == 200, voted.text
    # Moving the block, folding it and adding another keeps the votes.
    saved = await client.put(
        f"{room.url}/blocks",
        json={"blocks": [{"kind": "maps"}, {**_body(block), "collapsed": True}]},
        headers=room.master.headers,
    )
    assert saved.status_code == 200, saved.text
    assert [b["kind"] for b in saved.json()["blocks"]] == ["maps", "tool"]
    assert saved.json()["blocks"][1]["collapsed"] is True
    (tool,) = (await _tools(client, room, room.player))["tools"]
    assert tool["module"]["polls"][0]["my_option_ids"] == vote["option_ids"]

    dropped = await client.put(
        f"{room.url}/blocks", json={"blocks": [{"kind": "maps"}]}, headers=room.master.headers
    )

    assert dropped.status_code == 200
    assert (await _tools(client, room, room.master))["tools"] == []
    gone = await client.put(vote_url, json=vote, headers=room.player.headers)
    assert gone.status_code == 404


async def test_a_tool_block_must_name_one_of_its_sections_tools(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    block = await _tool(client, room, "questions")
    url = f"{room.url}/blocks"
    headers = room.master.headers

    for blocks in (
        [{"kind": "tool", "module_id": str(uuid.uuid4())}],
        [{"kind": "tool"}],
        [_body(block), _body(block)],
        [{"kind": "maps", "module_id": block["module_id"]}],
    ):
        response = await client.put(url, json={"blocks": blocks}, headers=headers)
        assert response.status_code == 422, blocks

    assert len((await _tools(client, room, room.master))["tools"]) == 1


async def test_a_retro_tool_takes_post_its_outside_every_session(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    block = await _tool(client, room, "retro")
    await _show(client, room, block)
    (tool,) = (await _tools(client, room, room.player))["tools"]
    column = tool["module"]["columns"][0]

    added = await client.post(
        f"{room.zero}/cards",
        json={"column_id": column["id"], "body": "Loved the fog"},
        headers=room.player.headers,
    )
    assert added.status_code == 200, added.text
    published = await client.post(
        f"{room.zero}/cards/publish-all",
        json={"anonymous": True, "module_id": block["module_id"]},
        headers=room.player.headers,
    )
    assert published.status_code == 200, published.text
    other_column = await client.post(
        f"{room.zero}/columns",
        json={"title": "Ideas", "module_id": block["module_id"]},
        headers=room.master.headers,
    )
    assert other_column.status_code == 200, other_column.text

    (tool,) = (await _tools(client, room, room.master))["tools"]
    (card,) = tool["module"]["columns"][0]["cards"]
    assert card["body"] == "Loved the fog" and card["anonymous"] and not card["draft"]
    assert [c["title"] for c in tool["module"]["columns"]][-1] == "Ideas"
    # The Session 0 page knows nothing of it: it hasn't started.
    assert (await client.get(room.zero, headers=room.player.headers)).json()["started"] is False


async def test_session_zero_leaves_the_tools_alone(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    block = await _tool(client, room, "retro")
    await _show(client, room, block)
    headers = room.master.headers

    before = (await _tools(client, room, room.master))["tools"]

    started = await client.post(
        f"{room.zero}/start", json={"modules": ["retro", "poll"]}, headers=headers
    )

    assert started.status_code == 200, started.text
    board = started.json()
    assert board["started"] is True
    assert [r["number"] for r in board["rounds"]] == [1]
    assert [m["kind"] for m in board["modules"]] == ["retro", "poll"]
    # Round 1's Retro gets its preset columns; the tool is left as it was.
    assert board["modules"][0]["columns"]
    assert (await _tools(client, room, room.master))["tools"] == before
    again = await client.post(f"{room.zero}/start", json={"modules": ["poll"]}, headers=headers)
    assert [m["kind"] for m in again.json()["modules"]] == ["retro", "poll"]
    assert [r["number"] for r in again.json()["rounds"]] == [1]  # idempotent
    overview = (await client.get(f"{room.zero}/overview", headers=headers)).json()
    assert [[s["kind"] for s in r["steps"]] for r in overview["rounds"]] == [["retro", "poll"]]
    # A tool's step isn't one of the session's.
    for response in (
        await client.delete(f"{room.zero}/modules/{block['module_id']}", headers=headers),
        await client.put(
            f"{room.zero}/modules/current", json={"module_id": block["module_id"]}, headers=headers
        ),
    ):
        assert response.status_code == 404, response.text
    second = await client.post(f"{room.zero}/rounds", json={"modules": ["retro"]}, headers=headers)
    assert second.status_code == 200, second.text
    assert [r["number"] for r in second.json()["rounds"]] == [1, 2]

    deleted = await client.delete(room.zero, headers=headers)

    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["started"] is False
    (tool,) = (await _tools(client, room, room.player))["tools"]
    assert tool["module_id"] == block["module_id"]
    restarted = await client.post(f"{room.zero}/start", json={"modules": ["ddi"]}, headers=headers)
    assert restarted.status_code == 200, restarted.text
    assert [r["number"] for r in restarted.json()["rounds"]] == [1]


async def test_deleting_the_section_deletes_its_tools(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    block = await _tool(client, room, "ddi")

    deleted = await client.delete(room.url, headers=room.master.headers)

    assert deleted.status_code == 204
    gone = await client.put(
        f"{room.zero}/modules/{block['module_id']}/document",
        json={"document_id": None},
        headers=room.master.headers,
    )
    assert gone.status_code == 404


async def test_a_copied_room_or_its_export_has_no_tools(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    block = await _tool(client, room, "poll")
    saved = await client.put(
        f"{room.url}/blocks",
        json={"blocks": [_body(block), {"kind": "maps", "collapsed": True}]},
        headers=room.master.headers,
    )
    assert saved.status_code == 200, saved.text

    copied = await client.post(f"/rooms/{room.id}/duplicate", headers=room.master.headers)

    assert copied.status_code == 201, copied.text
    copy_id = copied.json()["room"]["id"]
    sections = (await client.get(f"/rooms/{copy_id}/sections", headers=room.master.headers)).json()
    (only,) = sections[-1]["blocks"]
    assert (only["kind"], only["position"], only["collapsed"]) == ("maps", 0, True)


async def test_publish_all_on_a_closed_sessions_step_is_refused(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    headers = room.master.headers
    started = await client.post(f"{room.zero}/start", json={"modules": ["retro"]}, headers=headers)
    first_step = started.json()["modules"][0]["id"]
    await client.post(f"{room.zero}/rounds", json={"modules": ["retro"]}, headers=headers)

    closed = await client.post(
        f"{room.zero}/cards/publish-all",
        json={"anonymous": False, "module_id": first_step},
        headers=headers,
    )

    assert closed.status_code == 409, closed.text

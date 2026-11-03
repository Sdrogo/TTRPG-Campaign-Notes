"""Clocks 61_2: groups (free, race, turn, sequence), the Clocks block of a
Section, the Clocks page card, the Room's duplication and the personal data
export."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import clock_groups as groups_api
from app.domain import room_sections as sections_domain
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

    @property
    def url(self) -> str:
        return f"/rooms/{self.id}"

    def group(self, group_id: str) -> str:
        return f"/rooms/{self.id}/clock-groups/{group_id}"


async def _member(
    client: AsyncClient, make_token: Callable[..., str], room_id: str | None, master: _Member | None
) -> _Member:
    user_id = str(uuid.uuid4())
    member = _Member(id=user_id, headers={"Authorization": f"Bearer {make_token(user_id)}"})
    if room_id and master:
        invite = (
            await client.post(
                f"/rooms/{room_id}/invitations", json={"role": "player"}, headers=master.headers
            )
        ).json()
        await client.post(f"/invitations/{invite['code']}/accept", headers=member.headers)
    return member


async def _new_room(client: AsyncClient, make_token: Callable[..., str]) -> _Room:
    master = await _member(client, make_token, None, None)
    created = (await client.post("/rooms", json={"name": "Bebop"}, headers=master.headers)).json()
    return _Room(
        id=created["id"],
        master=master,
        player=await _member(client, make_token, created["id"], master),
    )


@pytest_asyncio.fixture
async def room(
    client: AsyncClient, make_token: Callable[..., str], db_session: AsyncSession
) -> _Room:
    return await _new_room(client, make_token)


async def _clock(client: AsyncClient, room: _Room, name: str, **fields: Any) -> dict[str, Any]:
    response = await client.post(
        f"{room.url}/clocks",
        json={"name": name, "segments": 2, "visibility": "room", **fields},
        headers=room.master.headers,
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


async def _group(client: AsyncClient, room: _Room, mode: str, name: str = "Fuga") -> dict[str, Any]:
    response = await client.post(
        f"{room.url}/clock-groups", json={"name": name, "mode": mode}, headers=room.master.headers
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


async def _set(client: AsyncClient, room: _Room, group_id: str, *items: dict[str, Any]) -> Any:
    return await client.put(
        f"{room.group(group_id)}/clocks", json={"items": list(items)}, headers=room.master.headers
    )


async def _fill(client: AsyncClient, room: _Room, clock_id: str) -> Any:
    return await client.post(
        f"{room.url}/clocks/{clock_id}/marks", json={"delta": 16}, headers=room.master.headers
    )


async def _groups(client: AsyncClient, room: _Room, member: _Member) -> list[dict[str, Any]]:
    response = await client.get(f"{room.url}/clock-groups", headers=member.headers)
    assert response.status_code == 200
    return list(response.json())


# --- Groups -------------------------------------------------------------------


async def test_create_list_and_limits(
    client: AsyncClient, room: _Room, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = f"{room.url}/clock-groups"
    refused = await client.post(url, json={"name": "X"}, headers=room.player.headers)
    assert refused.status_code == 403
    assert (
        await client.post(url, json={"name": " "}, headers=room.master.headers)
    ).status_code == 422
    empty = await _group(client, room, "free", "Fazioni")
    assert empty["clock_ids"] == [] and empty["mode"] == "free" and not empty["ended"]
    assert [g["id"] for g in await _groups(client, room, room.master)] == [empty["id"]]
    assert await _groups(client, room, room.player) == []
    monkeypatch.setattr(groups_api, "MAX_GROUPS_PER_ROOM", 1)
    assert (
        await client.post(url, json={"name": "X"}, headers=room.master.headers)
    ).status_code == 409


async def test_group_clocks(
    client: AsyncClient, room: _Room, monkeypatch: pytest.MonkeyPatch
) -> None:
    turn = await _group(client, room, "turn", "Bomba")
    free = await _group(client, room, "free", "Altro")
    bomb = await _clock(client, room, "Disinnescare")
    alarm = await _clock(client, room, "Allarme", visibility="master")
    third = await _clock(client, room, "Terzo")
    assert (
        await _set(client, room, turn["id"], {"clock_id": str(uuid.uuid4())})
    ).status_code == 422
    twice = await _set(client, room, turn["id"], {"clock_id": bomb["id"]}, {"clock_id": bomb["id"]})
    assert twice.status_code == 422
    long_label = await _set(
        client, room, turn["id"], {"clock_id": bomb["id"], "decisive_label": "x" * 31}
    )
    assert long_label.status_code == 422
    set_turn = await _set(
        client,
        room,
        turn["id"],
        {"clock_id": bomb["id"], "decisive_label": " Svolta  positiva "},
        {"clock_id": alarm["id"]},
    )
    assert set_turn.json()["clock_ids"] == [bomb["id"], alarm["id"]]
    clocks = {
        c["id"]: c
        for c in (await client.get(f"{room.url}/clocks", headers=room.master.headers)).json()
    }
    assert clocks[bomb["id"]]["decisive_label"] == "Svolta positiva"
    assert clocks[bomb["id"]]["group_id"] == turn["id"]

    player_groups = await _groups(client, room, room.player)
    assert [(g["id"], g["clock_ids"]) for g in player_groups] == [(turn["id"], [bomb["id"]])]

    moved = await _set(client, room, free["id"], {"clock_id": alarm["id"], "decisive_label": "x"})
    assert moved.json()["clock_ids"] == [alarm["id"]]
    master_groups = {g["id"]: g for g in await _groups(client, room, room.master)}
    assert master_groups[turn["id"]]["clock_ids"] == [bomb["id"]]
    clocks = {
        c["id"]: c
        for c in (await client.get(f"{room.url}/clocks", headers=room.master.headers)).json()
    }
    assert clocks[alarm["id"]]["decisive_label"] is None

    again = await _set(client, room, free["id"], {"clock_id": third["id"]})
    assert again.json()["clock_ids"] == [third["id"]]
    clocks = {
        c["id"]: c
        for c in (await client.get(f"{room.url}/clocks", headers=room.master.headers)).json()
    }
    assert clocks[alarm["id"]]["group_id"] is None
    monkeypatch.setattr(groups_api, "MAX_CLOCKS_PER_GROUP", 1)
    full = await _set(
        client, room, free["id"], {"clock_id": third["id"]}, {"clock_id": alarm["id"]}
    )
    assert full.status_code == 409
    missing = await _set(client, room, str(uuid.uuid4()))
    assert missing.status_code == 404


async def test_race(client: AsyncClient, room: _Room) -> None:
    race = await _group(client, room, "race")
    escape = await _clock(client, room, "Fuga")
    caught = await _clock(client, room, "Accerchiati")
    await _set(client, room, race["id"], {"clock_id": escape["id"]}, {"clock_id": caught["id"]})
    end = f"{room.group(race['id'])}/end"
    assert (await client.post(end, headers=room.master.headers)).status_code == 409
    await _fill(client, room, escape["id"])
    pending = (await _groups(client, room, room.player))[0]
    assert pending["pending_ids"] == [escape["id"]]
    assert (await client.post(end, headers=room.player.headers)).status_code == 403
    ended = (await client.post(end, headers=room.master.headers)).json()
    assert ended["group"]["ended"] and ended["group"]["result"] == {
        "winner_ids": [escape["id"]],
        "tie": False,
    }
    assert ended["group"]["pending_ids"] == []
    assert [c["state"] for c in ended["clocks"]] == ["closed", "open"]
    assert (await client.post(end, headers=room.master.headers)).status_code == 409
    switched = await client.patch(
        room.group(race["id"]), json={"mode": "turn"}, headers=room.master.headers
    )
    assert switched.status_code == 409
    renamed = await client.patch(
        room.group(race["id"]),
        json={"name": "Inseguimento", "mode": "race"},
        headers=room.master.headers,
    )
    assert renamed.json()["name"] == "Inseguimento"


async def test_race_tie(client: AsyncClient, room: _Room) -> None:
    race = await _group(client, room, "race")
    escape = await _clock(client, room, "Fuga")
    caught = await _clock(client, room, "Accerchiati")
    await _set(client, room, race["id"], {"clock_id": escape["id"]}, {"clock_id": caught["id"]})
    await _fill(client, room, escape["id"])
    await _fill(client, room, caught["id"])
    ended = (await client.post(f"{room.group(race['id'])}/end", headers=room.master.headers)).json()
    assert ended["group"]["result"]["tie"] is True


async def test_turn(client: AsyncClient, room: _Room) -> None:
    turn = await _group(client, room, "turn")
    bomb = await _clock(client, room, "Bomba")
    other = await _clock(client, room, "Fuga")
    await _set(
        client,
        room,
        turn["id"],
        {"clock_id": bomb["id"], "decisive_label": "Svolta positiva"},
        {"clock_id": other["id"]},
    )
    await _fill(client, room, bomb["id"])
    assert (await _groups(client, room, room.master))[0]["pending_ids"] == [bomb["id"]]
    ended = (await client.post(f"{room.group(turn['id'])}/end", headers=room.master.headers)).json()
    assert ended["group"]["result"] == {
        "outcomes": [{"clock_id": bomb["id"], "label": "Svolta positiva"}]
    }
    states = {c["id"]: c["state"] for c in ended["clocks"]}
    assert states == {bomb["id"]: "closed", other["id"]: "lapsed"}
    marked = await client.post(
        f"{room.url}/clocks/{other['id']}/marks", json={"delta": 1}, headers=room.master.headers
    )
    assert marked.status_code == 409
    history = (
        await client.get(f"{room.url}/clocks/{other['id']}/history", headers=room.master.headers)
    ).json()
    assert history["entries"][0]["action"] == "lapsed"


async def test_sequence(client: AsyncClient, room: _Room) -> None:
    sequence = await _group(client, room, "sequence", "Colpo")
    first = await _clock(client, room, "Entrare")
    second = await _clock(client, room, "Covo")
    await _set(client, room, sequence["id"], {"clock_id": first["id"]}, {"clock_id": second["id"]})
    locked = await client.post(
        f"{room.url}/clocks/{second['id']}/marks", json={"delta": 1}, headers=room.master.headers
    )
    assert locked.status_code == 409
    await _fill(client, room, first["id"])
    opened = await client.post(
        f"{room.url}/clocks/{second['id']}/marks", json={"delta": 1}, headers=room.master.headers
    )
    assert opened.status_code == 201


async def test_update_archive_order_and_delete(client: AsyncClient, room: _Room) -> None:
    turn = await _group(client, room, "turn", "Uno")
    other = await _group(client, room, "free", "Due")
    clock = await _clock(client, room, "Bomba")
    await _set(client, room, turn["id"], {"clock_id": clock["id"], "decisive_label": "Esito"})
    url = room.group(turn["id"])
    assert (
        await client.patch(url, json={"name": "X"}, headers=room.player.headers)
    ).status_code == 403
    assert (
        await client.patch(url, json={"name": " "}, headers=room.master.headers)
    ).status_code == 422
    assert (
        await client.patch(room.group(str(uuid.uuid4())), json={}, headers=room.master.headers)
    ).status_code == 404
    freed = await client.patch(url, json={"mode": "free"}, headers=room.master.headers)
    assert freed.json()["mode"] == "free"
    shown = (
        await client.get(f"{room.url}/clocks/{clock['id']}", headers=room.master.headers)
    ).json()
    assert shown["decisive_label"] is None

    archived = await client.patch(url, json={"archived": True}, headers=room.master.headers)
    assert archived.status_code == 200
    shown = (
        await client.get(f"{room.url}/clocks/{clock['id']}", headers=room.master.headers)
    ).json()
    assert shown["archived"]
    await client.patch(url, json={"archived": True}, headers=room.master.headers)
    await client.patch(url, json={"archived": False}, headers=room.master.headers)
    history = (
        await client.get(f"{room.url}/clocks/{clock['id']}/history", headers=room.master.headers)
    ).json()
    assert [e["action"] for e in history["entries"][:2]] == ["restored", "archived"]

    order = f"{room.url}/clock-groups-order"
    assert (
        await client.put(order, json={"ids": []}, headers=room.player.headers)
    ).status_code == 403
    assert (
        await client.put(order, json={"ids": [turn["id"]]}, headers=room.master.headers)
    ).status_code == 422
    ordered = await client.put(
        order, json={"ids": [other["id"], turn["id"]]}, headers=room.master.headers
    )
    assert [g["name"] for g in ordered.json()] == ["Due", "Uno"]

    assert (await client.delete(url, headers=room.master.headers)).status_code == 204
    shown = (
        await client.get(f"{room.url}/clocks/{clock['id']}", headers=room.master.headers)
    ).json()
    assert shown["group_id"] is None
    assert [g["name"] for g in await _groups(client, room, room.master)] == ["Due"]


async def test_group_events_reach_who_sees_a_clock(client: AsyncClient, room: _Room) -> None:
    room_id = uuid.UUID(room.id)
    player = broker.subscribe(room_id, uuid.UUID(room.player.id))
    try:
        hidden = await _group(client, room, "free", "Segreto")
        shared = await _group(client, room, "free", "Pubblico")
        secret = await _clock(client, room, "Covo", visibility="master")
        clock = await _clock(client, room, "Allarme")
        await _set(client, room, hidden["id"], {"clock_id": secret["id"]})
        await _set(client, room, shared["id"], {"clock_id": clock["id"]})
        heard = []
        while not player.queue.empty():
            event = player.queue.get_nowait()
            assert event is not None
            if event.topic == "clock_group":
                heard.append(str(event.id))
        assert heard == [shared["id"]]
    finally:
        broker.unsubscribe(player)


# --- Clocks block and page card -----------------------------------------------


async def _sections(client: AsyncClient, room: _Room, member: _Member) -> list[dict[str, Any]]:
    response = await client.get(f"{room.url}/sections", headers=member.headers)
    assert response.status_code == 200
    return list(response.json())


async def test_page_card_joins_on_first_use(
    client: AsyncClient,
    room: _Room,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    kinds = [s["kind"] for s in await _sections(client, room, room.master)]
    assert "page_clocks" not in kinds
    await _clock(client, room, "Primo")
    landing = await _sections(client, room, room.master)
    assert [s["kind"] for s in landing][-1] == "page_clocks"
    rules = {"open_policy": "master", "mark_policy": "master", "allow_unmark": True}
    await client.put(f"{room.url}/clock-rules", json=rules, headers=room.master.headers)
    assert [s["kind"] for s in await _sections(client, room, room.master)].count("page_clocks") == 1

    other = await _new_room(client, make_token)
    await client.put(f"/rooms/{other.id}/clock-rules", json=rules, headers=other.master.headers)
    card = next(
        s for s in await _sections(client, other, other.master) if s["kind"] == "page_clocks"
    )
    await client.delete(f"/rooms/{other.id}/sections/{card['id']}", headers=other.master.headers)
    await _clock(client, other, "Dopo")
    assert "page_clocks" not in [s["kind"] for s in await _sections(client, other, other.master)]

    full = await _new_room(client, make_token)
    monkeypatch.setattr(sections_domain, "MAX_SECTIONS", 3)
    await _clock(client, full, "Pieno")
    assert "page_clocks" not in [s["kind"] for s in await _sections(client, full, full.master)]


async def test_clocks_block(client: AsyncClient, room: _Room) -> None:
    section = (
        await client.post(
            f"{room.url}/sections", json={"title": "Clock"}, headers=room.master.headers
        )
    ).json()
    shared = await _clock(client, room, "Allarme")
    secret = await _clock(client, room, "Covo", visibility="master")
    group = await _group(client, room, "race")
    hidden_group = await _group(client, room, "free", "Vuoto")
    await _set(client, room, group["id"], {"clock_id": shared["id"]})
    url = f"{room.url}/sections/{section['id']}/blocks"

    async def save(*blocks: dict[str, Any]) -> Any:
        return await client.put(url, json={"blocks": list(blocks)}, headers=room.master.headers)

    chips = [
        {"clock_id": shared["id"]},
        {"clock_id": secret["id"]},
        {"group_id": group["id"]},
        {"group_id": hidden_group["id"]},
    ]
    saved = await save({"kind": "clocks", "clock_chips": chips, "heading": "Tensione"})
    assert saved.status_code == 200, saved.text
    assert len(saved.json()["blocks"][0]["clock_chips"]) == 4
    player_block = next(
        s for s in await _sections(client, room, room.player) if s["id"] == section["id"]
    )["blocks"][0]
    assert player_block["clock_chips"] == [
        {"clock_id": shared["id"], "group_id": None},
        {"clock_id": None, "group_id": group["id"]},
    ]
    one = await client.get(f"{room.url}/sections/{section['id']}", headers=room.player.headers)
    assert len(one.json()["blocks"][0]["clock_chips"]) == 2
    own = await client.get(f"{room.url}/sections/{section['id']}", headers=room.master.headers)
    assert len(own.json()["blocks"][0]["clock_chips"]) == 4

    for bad in (
        {"kind": "clocks", "clock_chips": [{"clock_id": shared["id"], "group_id": group["id"]}]},
        {"kind": "clocks", "clock_chips": [{}]},
        {"kind": "clocks", "clock_chips": [{"clock_id": str(uuid.uuid4())}]},
        {"kind": "clocks", "clock_chips": [{"clock_id": shared["id"]}, {"clock_id": shared["id"]}]},
        {"kind": "maps", "all_clocks": True},
    ):
        assert (await save(bad)).status_code == 422, bad
    many = [{"clock_id": shared["id"]}] * 21
    assert (await save({"kind": "clocks", "clock_chips": many})).status_code == 422
    every = await save({"kind": "clocks", "all_clocks": True})
    assert every.json()["blocks"][0]["all_clocks"] is True

    await save({"kind": "clocks", "clock_chips": [{"clock_id": shared["id"]}], "all_clocks": True})
    copy = await client.post(f"{room.url}/duplicate", headers=room.master.headers)
    assert copy.status_code == 201
    copied = await client.get(
        f"/rooms/{copy.json()['room']['id']}/sections", headers=room.master.headers
    )
    block = next(s for s in copied.json() if s["title"] == "Clock")["blocks"][0]
    assert block["clock_chips"] == [] and block["all_clocks"] is True


# --- Duplication and personal data ---------------------------------------------


async def test_duplicate_copies_the_setup_not_the_clocks(client: AsyncClient, room: _Room) -> None:
    plain = await client.post(f"{room.url}/duplicate", headers=room.master.headers)
    plain_rules = await client.get(
        f"/rooms/{plain.json()['room']['id']}/clock-rules", headers=room.master.headers
    )
    assert plain_rules.json()["labels"] == []

    rules = {"open_policy": "propose", "mark_policy": "everyone", "allow_unmark": False}
    await client.put(f"{room.url}/clock-rules", json=rules, headers=room.master.headers)
    label = (
        await client.post(
            f"{room.url}/clock-rules/labels",
            json={"name": "Jazz", "color": "blue"},
            headers=room.master.headers,
        )
    ).json()
    await client.post(
        f"{room.url}/clock-rules/mark-kinds",
        json={"name": "Shock", "who": "master"},
        headers=room.master.headers,
    )
    await client.post(
        f"{room.url}/clock-rules/templates",
        json={"name": "Pericolo", "settings": {"segments": 4, "label_ids": [label["id"]]}},
        headers=room.master.headers,
    )
    await _clock(client, room, "Allarme")
    await _group(client, room, "race")
    copy = (await client.post(f"{room.url}/duplicate", headers=room.master.headers)).json()
    copy_url = f"/rooms/{copy['room']['id']}"
    setup = (await client.get(f"{copy_url}/clock-rules", headers=room.master.headers)).json()
    assert (setup["open_policy"], setup["mark_policy"], setup["allow_unmark"]) == (
        "propose",
        "everyone",
        False,
    )
    assert [(x["name"], x["color"]) for x in setup["labels"]] == [("Jazz", "blue")]
    assert setup["labels"][0]["id"] != label["id"]
    assert [k["name"] for k in setup["mark_kinds"]] == ["Shock"]
    assert setup["templates"][0]["settings"]["label_ids"] == [setup["labels"][0]["id"]]
    assert (await client.get(f"{copy_url}/clocks", headers=room.master.headers)).json() == []
    assert (await client.get(f"{copy_url}/clock-groups", headers=room.master.headers)).json() == []


async def test_personal_data_lists_clocks_and_marks(client: AsyncClient, room: _Room) -> None:
    rules = {"open_policy": "propose", "mark_policy": "everyone", "allow_unmark": True}
    await client.put(f"{room.url}/clock-rules", json=rules, headers=room.master.headers)
    proposal = await client.post(
        f"{room.url}/clocks", json={"name": "Mio"}, headers=room.player.headers
    )
    assert proposal.status_code == 201
    clock = await _clock(client, room, "Allarme")
    mark = (
        await client.post(
            f"{room.url}/clocks/{clock['id']}/marks",
            json={"delta": 1, "note": "piede di porco"},
            headers=room.player.headers,
        )
    ).json()
    await client.post(
        f"{room.url}/clocks/{clock['id']}/marks/{mark['mark_id']}/undo", headers=room.player.headers
    )
    data = (await client.get("/account/export", headers=room.player.headers)).json()
    assert [(c["name"], c["state"]) for c in data["clocks"]] == [("Mio", "proposed")]
    assert [(m["clock"], m["delta"], m["note"], m["undone"]) for m in data["clock_marks"]] == [
        ("Allarme", 1, "piede di porco", True)
    ]

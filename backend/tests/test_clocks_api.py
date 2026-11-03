"""Clocks (spec 61_1): rules, labels, mark kinds, templates, clocks, marks
and undo, history, visibility, proposals and the live events."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import clocks as clocks_api
from app.db import clocks_repo
from app.db.models import AuditLogRow, RoomClockMarkRow
from app.domain.clocks import ClockGroup, GroupMode
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
    other: _Member

    @property
    def url(self) -> str:
        return f"/rooms/{self.id}"

    def clock(self, clock_id: str) -> str:
        return f"/rooms/{self.id}/clocks/{clock_id}"


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


@pytest_asyncio.fixture
async def room(
    client: AsyncClient, make_token: Callable[..., str], db_session: AsyncSession
) -> _Room:
    master = await _member(client, make_token, None, None)
    created = (await client.post("/rooms", json={"name": "Bebop"}, headers=master.headers)).json()
    return _Room(
        id=created["id"],
        master=master,
        player=await _member(client, make_token, created["id"], master),
        other=await _member(client, make_token, created["id"], master),
    )


async def _clock(
    client: AsyncClient, room: _Room, member: _Member | None = None, **fields: Any
) -> dict[str, Any]:
    response = await client.post(
        f"{room.url}/clocks",
        json={"name": "Allarme", "segments": 4, "visibility": "room", **fields},
        headers=(member or room.master).headers,
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


async def _rules(client: AsyncClient, room: _Room, **rules: Any) -> None:
    body = {"open_policy": "master", "mark_policy": "master", "allow_unmark": True, **rules}
    response = await client.put(f"{room.url}/clock-rules", json=body, headers=room.master.headers)
    assert response.status_code == 200, response.text


async def _mark(
    client: AsyncClient, room: _Room, clock_id: str, member: _Member | None = None, **body: Any
) -> Any:
    return await client.post(
        f"{room.clock(clock_id)}/marks",
        json={"delta": 1, **body},
        headers=(member or room.master).headers,
    )


def _drain(stream: Any) -> list[Event]:
    events = []
    while not stream.queue.empty():
        events.append(stream.queue.get_nowait())
    return events


# --- Rules, labels, mark kinds, templates -------------------------------------


async def test_rules_default_and_saved(client: AsyncClient, room: _Room) -> None:
    got = await client.get(f"{room.url}/clock-rules", headers=room.player.headers)
    assert got.status_code == 200
    assert got.json() == {
        "open_policy": "master",
        "mark_policy": "master",
        "allow_unmark": True,
        "labels": [],
        "mark_kinds": [],
        "templates": [],
    }
    refused = await client.put(
        f"{room.url}/clock-rules",
        json={"open_policy": "everyone", "mark_policy": "everyone", "allow_unmark": False},
        headers=room.player.headers,
    )
    assert refused.status_code == 403
    await _rules(client, room, open_policy="propose", mark_policy="everyone", allow_unmark=False)
    await _rules(client, room, open_policy="everyone")
    saved = (await client.get(f"{room.url}/clock-rules", headers=room.player.headers)).json()
    assert (saved["open_policy"], saved["mark_policy"], saved["allow_unmark"]) == (
        "everyone",
        "master",
        True,
    )


async def test_labels(client: AsyncClient, room: _Room, monkeypatch: pytest.MonkeyPatch) -> None:
    url = f"{room.url}/clock-rules/labels"
    assert (
        await client.post(url, json={"name": "Jazz"}, headers=room.player.headers)
    ).status_code == 403
    jazz = await client.post(
        url, json={"name": " Jazz ", "color": "blue"}, headers=room.master.headers
    )
    assert jazz.status_code == 201
    assert jazz.json()["name"] == "Jazz" and jazz.json()["clock_count"] == 0
    rock = (await client.post(url, json={"name": "Rock"}, headers=room.master.headers)).json()
    assert (
        await client.post(url, json={"name": "jazz"}, headers=room.master.headers)
    ).status_code == 409
    assert (
        await client.post(url, json={"name": " "}, headers=room.master.headers)
    ).status_code == 422
    monkeypatch.setattr(clocks_api, "MAX_LABELS_PER_ROOM", 2)
    assert (
        await client.post(url, json={"name": "Funk"}, headers=room.master.headers)
    ).status_code == 409

    jazz_id = jazz.json()["id"]
    await _clock(client, room, label_ids=[jazz_id])
    renamed = await client.patch(
        f"{url}/{jazz_id}", json={"name": "Blues"}, headers=room.master.headers
    )
    assert renamed.json() == {
        "id": jazz_id,
        "name": "Blues",
        "color": "blue",
        "position": 0,
        "clock_count": 1,
    }
    recolored = await client.patch(
        f"{url}/{jazz_id}", json={"color": "red"}, headers=room.master.headers
    )
    assert recolored.json()["name"] == "Blues" and recolored.json()["color"] == "red"
    taken = await client.patch(
        f"{url}/{jazz_id}", json={"name": "ROCK"}, headers=room.master.headers
    )
    assert taken.status_code == 409
    missing = await client.patch(f"{url}/{uuid.uuid4()}", json={}, headers=room.master.headers)
    assert missing.status_code == 404

    order = f"{room.url}/clock-rules/labels-order"
    bad = await client.put(order, json={"ids": [jazz_id]}, headers=room.master.headers)
    assert bad.status_code == 422
    good = await client.put(order, json={"ids": [rock["id"], jazz_id]}, headers=room.master.headers)
    assert [label["name"] for label in good.json()["labels"]] == ["Rock", "Blues"]
    player_view = (await client.get(f"{room.url}/clock-rules", headers=room.player.headers)).json()
    assert {label["clock_count"] for label in player_view["labels"]} == {None}

    assert (
        await client.delete(f"{url}/{uuid.uuid4()}", headers=room.master.headers)
    ).status_code == 404
    assert (await client.delete(f"{url}/{jazz_id}", headers=room.master.headers)).status_code == 204
    clocks = (await client.get(f"{room.url}/clocks", headers=room.master.headers)).json()
    assert clocks[0]["label_ids"] == []


async def test_mark_kinds(
    client: AsyncClient, room: _Room, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = f"{room.url}/clock-rules/mark-kinds"
    assert (
        await client.post(url, json={"name": "Shock"}, headers=room.player.headers)
    ).status_code == 403
    shock = (
        await client.post(
            url,
            json={"name": "Shock", "color": "red", "who": "master"},
            headers=room.master.headers,
        )
    ).json()
    success = (
        await client.post(
            url, json={"name": "Successo", "who": "players"}, headers=room.master.headers
        )
    ).json()
    assert (
        await client.post(url, json={"name": "shock"}, headers=room.master.headers)
    ).status_code == 409
    assert (
        await client.post(url, json={"name": ""}, headers=room.master.headers)
    ).status_code == 422
    monkeypatch.setattr(clocks_api, "MAX_MARK_KINDS", 2)
    assert (
        await client.post(url, json={"name": "Altro"}, headers=room.master.headers)
    ).status_code == 409

    edited = await client.patch(
        f"{url}/{shock['id']}",
        json={"name": "Botta", "who": "everyone"},
        headers=room.master.headers,
    )
    assert edited.json()["name"] == "Botta" and edited.json()["who"] == "everyone"
    kept = await client.patch(
        f"{url}/{shock['id']}", json={"color": "gold"}, headers=room.master.headers
    )
    assert kept.json()["name"] == "Botta" and kept.json()["color"] == "gold"
    taken = await client.patch(
        f"{url}/{shock['id']}", json={"name": "SUCCESSO"}, headers=room.master.headers
    )
    assert taken.status_code == 409
    assert (
        await client.patch(f"{url}/{uuid.uuid4()}", json={}, headers=room.master.headers)
    ).status_code == 404

    order = f"{room.url}/clock-rules/mark-kinds-order"
    assert (
        await client.put(order, json={"ids": []}, headers=room.master.headers)
    ).status_code == 422
    reordered = await client.put(
        order, json={"ids": [success["id"], shock["id"]]}, headers=room.master.headers
    )
    assert [kind["name"] for kind in reordered.json()["mark_kinds"]] == ["Successo", "Botta"]

    clock = await _clock(client, room, mark_policy="everyone")
    await _mark(client, room, clock["id"], room.player)
    assert (
        await client.delete(f"{url}/{uuid.uuid4()}", headers=room.master.headers)
    ).status_code == 404
    assert (
        await client.delete(f"{url}/{success['id']}", headers=room.master.headers)
    ).status_code == 204
    shown = (await client.get(room.clock(clock["id"]), headers=room.master.headers)).json()
    assert shown["segment_kinds"] == [None]


async def test_templates(client: AsyncClient, room: _Room, monkeypatch: pytest.MonkeyPatch) -> None:
    url = f"{room.url}/clock-rules/templates"
    settings = {"segments": 8, "color": "blue", "consequence": "Arrivano", "stage_labels": ["Uno"]}
    assert (
        await client.post(
            url, json={"name": "P", "settings": settings}, headers=room.player.headers
        )
    ).status_code == 403
    created = await client.post(
        url, json={"name": "Progetto", "settings": settings}, headers=room.master.headers
    )
    assert created.status_code == 201
    template = created.json()
    assert template["settings"]["consequence"] == "Arrivano"
    unknown = {**settings, "label_ids": [str(uuid.uuid4())]}
    assert (
        await client.post(url, json={"name": "X", "settings": unknown}, headers=room.master.headers)
    ).status_code == 422
    assert (
        await client.post(url, json={"name": "", "settings": settings}, headers=room.master.headers)
    ).status_code == 422
    bad = {**settings, "segments": 40}
    assert (
        await client.post(url, json={"name": "X", "settings": bad}, headers=room.master.headers)
    ).status_code == 422
    monkeypatch.setattr(clocks_api, "MAX_TEMPLATES_PER_ROOM", 1)
    assert (
        await client.post(
            url, json={"name": "X", "settings": settings}, headers=room.master.headers
        )
    ).status_code == 409

    seen = (await client.get(f"{room.url}/clock-rules", headers=room.player.headers)).json()
    assert seen["templates"][0]["settings"]["consequence"] is None

    item = f"{url}/{template['id']}"
    renamed = await client.patch(item, json={"name": "Piano"}, headers=room.master.headers)
    assert renamed.json()["name"] == "Piano" and renamed.json()["settings"]["segments"] == 8
    resettled = await client.patch(
        item, json={"settings": {"segments": 3}}, headers=room.master.headers
    )
    assert resettled.json()["settings"]["segments"] == 3 and resettled.json()["name"] == "Piano"
    assert (
        await client.patch(item, json={"name": " "}, headers=room.master.headers)
    ).status_code == 422
    assert (
        await client.patch(f"{url}/{uuid.uuid4()}", json={}, headers=room.master.headers)
    ).status_code == 404
    assert (
        await client.delete(f"{url}/{uuid.uuid4()}", headers=room.master.headers)
    ).status_code == 404
    assert (await client.delete(item, headers=room.master.headers)).status_code == 204


# --- Creating, proposals, visibility ------------------------------------------


async def test_create_and_read(client: AsyncClient, room: _Room) -> None:
    clock = await _clock(
        client,
        room,
        description=" **Presto** ",
        segments=5,
        color="emerald",
        stage_labels=["Sospetto", "Allerta"],
        closing_condition="L'ultimo segno da una prova Jazz",
        consequence="Arriva la polizia",
    )
    assert clock["segments"] == 5 and clock["filled"] == 0 and clock["state"] == "open"
    assert clock["description"] == "**Presto**"
    assert clock["consequence"] == "Arriva la polizia"
    assert clock["can_manage"] and clock["can_mark"] and clock["can_unmark"]
    assert clock["selective_user_ids"] == []
    seen = (await client.get(room.clock(clock["id"]), headers=room.player.headers)).json()
    assert seen["consequence"] is None
    assert seen["selective_user_ids"] is None
    assert not seen["can_manage"] and not seen["can_mark"]
    listed = (await client.get(f"{room.url}/clocks", headers=room.player.headers)).json()
    assert [c["id"] for c in listed] == [clock["id"]]

    for fields in ({"segments": 1}, {"segments": 17}, {"name": " "}, {"stage_labels": ["a"] * 5}):
        response = await client.post(
            f"{room.url}/clocks",
            json={"name": "X", "segments": 4, **fields},
            headers=room.master.headers,
        )
        assert response.status_code == 422, fields
    unknown = await client.post(
        f"{room.url}/clocks",
        json={"name": "X", "label_ids": [str(uuid.uuid4())]},
        headers=room.master.headers,
    )
    assert unknown.status_code == 422
    outsider = await client.post(
        f"{room.url}/clocks",
        json={"name": "X", "visibility": "selective", "selective_user_ids": [str(uuid.uuid4())]},
        headers=room.master.headers,
    )
    assert outsider.status_code == 422


async def test_room_cap(client: AsyncClient, room: _Room, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(clocks_api, "MAX_CLOCKS_PER_ROOM", 1)
    await _clock(client, room)
    refused = await client.post(
        f"{room.url}/clocks", json={"name": "X"}, headers=room.master.headers
    )
    assert refused.status_code == 409


async def test_who_opens(client: AsyncClient, room: _Room) -> None:
    refused = await client.post(
        f"{room.url}/clocks", json={"name": "Mio"}, headers=room.player.headers
    )
    assert refused.status_code == 403
    await _rules(client, room, open_policy="everyone")
    mine = await _clock(client, room, room.player)
    assert mine["state"] == "open" and mine["can_manage"]
    consequence = await client.post(
        f"{room.url}/clocks", json={"name": "X", "consequence": "y"}, headers=room.player.headers
    )
    assert consequence.status_code == 403
    await client.patch(
        room.url, json={"players_can_create_documents": False}, headers=room.master.headers
    )
    barred = await client.post(
        f"{room.url}/clocks", json={"name": "X"}, headers=room.player.headers
    )
    assert barred.status_code == 403


async def test_proposals(client: AsyncClient, room: _Room) -> None:
    await _rules(client, room, open_policy="propose")
    proposal = await _clock(client, room, room.player, segments=6)
    assert proposal["state"] == "proposed" and not proposal["can_mark"]
    assert (
        await client.get(room.clock(proposal["id"]), headers=room.other.headers)
    ).status_code == 404
    assert (await client.get(f"{room.url}/clocks", headers=room.other.headers)).json() == []
    assert (await _mark(client, room, proposal["id"])).status_code == 409
    assert (
        await client.post(f"{room.clock(proposal['id'])}/open", headers=room.player.headers)
    ).status_code == 403
    resized = await client.patch(
        room.clock(proposal["id"]), json={"segments": 8}, headers=room.master.headers
    )
    assert resized.json()["state"] == "proposed"
    opened = await client.post(f"{room.clock(proposal['id'])}/open", headers=room.master.headers)
    assert opened.json()["state"] == "open" and opened.json()["segments"] == 8
    assert (
        await client.get(room.clock(proposal["id"]), headers=room.other.headers)
    ).status_code == 200
    again = await client.post(f"{room.clock(proposal['id'])}/open", headers=room.master.headers)
    assert again.status_code == 409

    refused = await _clock(client, room, room.player)
    assert (
        await client.delete(room.clock(refused["id"]), headers=room.master.headers)
    ).status_code == 204
    assert (
        await client.get(room.clock(refused["id"]), headers=room.player.headers)
    ).status_code == 404


async def test_hidden_and_foreign_clocks(
    client: AsyncClient, room: _Room, make_token: Callable[..., str]
) -> None:
    secret = await _clock(client, room, visibility="master")
    assert (
        await client.get(room.clock(secret["id"]), headers=room.player.headers)
    ).status_code == 404
    assert (await client.get(f"{room.url}/clocks", headers=room.player.headers)).json() == []
    assert (
        await client.get(room.clock(str(uuid.uuid4())), headers=room.player.headers)
    ).status_code == 404
    master = await _member(client, make_token, None, None)
    elsewhere = (await client.post("/rooms", json={"name": "Altro"}, headers=master.headers)).json()
    foreign = await client.get(
        f"/rooms/{elsewhere['id']}/clocks/{secret['id']}", headers=master.headers
    )
    assert foreign.status_code == 404
    shared = await _clock(client, room, visibility="selective", selective_user_ids=[room.player.id])
    assert (
        await client.get(room.clock(shared["id"]), headers=room.player.headers)
    ).status_code == 200
    assert (
        await client.get(room.clock(shared["id"]), headers=room.other.headers)
    ).status_code == 404


async def test_document_link(
    client: AsyncClient, room: _Room, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def document(name: str, visibility: str) -> str:
        response = await client.post(
            f"{room.url}/documents",
            json={"name": name, "visibility": visibility},
            headers=room.master.headers,
        )
        return str(response.json()["id"])

    lighthouse = await document("Faro", "room")
    secret = await document("Covo", "master")
    linked = await _clock(client, room, document_id=lighthouse)
    assert linked["document"] == {"id": lighthouse, "name": "Faro"}
    hidden_link = await _clock(client, room, document_id=secret)
    assert (await client.get(room.clock(hidden_link["id"]), headers=room.player.headers)).json()[
        "document"
    ] is None
    await _rules(client, room, open_policy="everyone")
    refused = await client.post(
        f"{room.url}/clocks", json={"name": "X", "document_id": secret}, headers=room.player.headers
    )
    assert refused.status_code == 422
    missing = await client.post(
        f"{room.url}/clocks",
        json={"name": "X", "document_id": str(uuid.uuid4())},
        headers=room.master.headers,
    )
    assert missing.status_code == 422
    monkeypatch.setattr(clocks_api, "MAX_CLOCKS_PER_DOCUMENT", 1)
    full = await client.post(
        f"{room.url}/clocks",
        json={"name": "X", "document_id": lighthouse},
        headers=room.master.headers,
    )
    assert full.status_code == 409
    moved = await client.patch(
        room.clock(hidden_link["id"]), json={"document_id": lighthouse}, headers=room.master.headers
    )
    assert moved.status_code == 409
    same = await client.patch(
        room.clock(linked["id"]), json={"document_id": lighthouse}, headers=room.master.headers
    )
    assert same.status_code == 200
    cleared = await client.patch(
        room.clock(linked["id"]), json={"clear": ["document_id"]}, headers=room.master.headers
    )
    assert cleared.json()["document"] is None


# --- Editing ------------------------------------------------------------------


async def test_edit(client: AsyncClient, room: _Room, db_session: AsyncSession) -> None:
    label = (
        await client.post(
            f"{room.url}/clock-rules/labels", json={"name": "Jazz"}, headers=room.master.headers
        )
    ).json()
    clock = await _clock(client, room, consequence="Boom", closing_condition="Prova Jazz")
    url = room.clock(clock["id"])
    assert (
        await client.patch(url, json={"name": "X"}, headers=room.player.headers)
    ).status_code == 403
    stale = await client.patch(url, json={"base_revision": 99}, headers=room.master.headers)
    assert stale.status_code == 412
    edited = await client.patch(
        url,
        json={
            "base_revision": clock["revision"],
            "name": "Allarme rosso",
            "label_ids": [label["id"]],
            "forward_only": True,
            "mark_policy": "everyone",
            "clear": ["closing_condition"],
        },
        headers=room.master.headers,
    )
    body = edited.json()
    assert body["name"] == "Allarme rosso" and body["label_ids"] == [label["id"]]
    assert body["forward_only"] and not body["can_unmark"] and body["mark_policy"] == "everyone"
    assert body["closing_condition"] is None and body["consequence"] == "Boom"
    assert body["revision"] == clock["revision"] + 1
    for bad in ({"name": " "}, {"clear": ["name"]}, {"label_ids": [str(uuid.uuid4())]}):
        assert (await client.patch(url, json=bad, headers=room.master.headers)).status_code == 422
    unchanged = await client.patch(url, json={}, headers=room.master.headers)
    assert unchanged.status_code == 200

    await _rules(client, room, open_policy="everyone")
    mine = await _clock(client, room, room.player)
    mine_url = room.clock(mine["id"])
    for bad in ({"consequence": "x"}, {"clear": ["consequence"]}):
        assert (
            await client.patch(mine_url, json=bad, headers=room.player.headers)
        ).status_code == 403
    own = await client.patch(
        mine_url, json={"mark_policy": "master_and_creator"}, headers=room.player.headers
    )
    assert own.json()["can_mark"]

    selective = await client.patch(
        url,
        json={"visibility": "selective", "selective_user_ids": [room.player.id]},
        headers=room.master.headers,
    )
    assert selective.json()["selective_user_ids"] == [room.player.id]
    outsider = await client.patch(
        url, json={"selective_user_ids": [str(uuid.uuid4())]}, headers=room.master.headers
    )
    assert outsider.status_code == 422
    back = await client.patch(url, json={"visibility": "room"}, headers=room.master.headers)
    assert back.json()["selective_user_ids"] == []
    audits = (
        await db_session.execute(
            select(AuditLogRow).where(AuditLogRow.action == "clock_visibility_changed")
        )
    ).scalars()
    assert [(row.details["from"], row.details["to"]) for row in audits] == [
        ("room", "selective"),
        ("selective", "room"),
    ]

    archived = await client.patch(url, json={"archived": True}, headers=room.master.headers)
    assert archived.json()["archived"] and not archived.json()["can_mark"]
    assert (await _mark(client, room, clock["id"])).status_code == 409
    restored = await client.patch(url, json={"archived": False}, headers=room.master.headers)
    assert not restored.json()["archived"]
    same = await client.patch(url, json={"archived": False}, headers=room.master.headers)
    assert not same.json()["archived"]

    history = (await client.get(f"{url}/history", headers=room.master.headers)).json()
    actions = [entry["action"] for entry in reversed(history["entries"])]
    assert actions == ["created", "edited", "edited", "edited", "archived", "restored"]
    assert history["entries"][3]["details"]["fields"] == ["visibility", "selective_user_ids"]


async def test_resize_closes_and_reopens(client: AsyncClient, room: _Room) -> None:
    clock = await _clock(client, room, segments=4)
    for _ in range(3):
        await _mark(client, room, clock["id"])
    shrunk = await client.patch(
        room.clock(clock["id"]), json={"segments": 3}, headers=room.master.headers
    )
    assert (shrunk.json()["filled"], shrunk.json()["state"]) == (3, "closed")
    grown = await client.patch(
        room.clock(clock["id"]), json={"segments": 6}, headers=room.master.headers
    )
    assert (grown.json()["filled"], grown.json()["state"]) == (3, "open")
    history = (
        await client.get(f"{room.clock(clock['id'])}/history", headers=room.master.headers)
    ).json()
    assert [entry["action"] for entry in history["entries"][:4]] == [
        "reopened",
        "edited",
        "closed",
        "edited",
    ]


async def test_order_and_delete(client: AsyncClient, room: _Room) -> None:
    first = await _clock(client, room, name="Uno")
    second = await _clock(client, room, name="Due")
    url = f"{room.url}/clocks-order"
    assert (await client.put(url, json={"ids": []}, headers=room.player.headers)).status_code == 403
    assert (
        await client.put(url, json={"ids": [first["id"]]}, headers=room.master.headers)
    ).status_code == 422
    ordered = await client.put(
        url, json={"ids": [second["id"], first["id"]]}, headers=room.master.headers
    )
    assert [clock["name"] for clock in ordered.json()] == ["Due", "Uno"]
    assert (
        await client.delete(room.clock(first["id"]), headers=room.player.headers)
    ).status_code == 403
    assert (
        await client.delete(room.clock(first["id"]), headers=room.master.headers)
    ).status_code == 204
    assert [
        c["name"]
        for c in (await client.get(f"{room.url}/clocks", headers=room.master.headers)).json()
    ] == ["Due"]


# --- Marking ------------------------------------------------------------------


async def test_marks_fill_close_and_reopen(client: AsyncClient, room: _Room) -> None:
    clock = await _clock(client, room, segments=4)
    two = await _mark(client, room, clock["id"], delta=2, note="  forzata   la serratura ")
    assert two.status_code == 201
    assert two.json()["clock"]["filled"] == 2
    full = await _mark(client, room, clock["id"], delta=5)
    assert (full.json()["clock"]["filled"], full.json()["clock"]["state"]) == (4, "closed")
    assert (await _mark(client, room, clock["id"])).status_code == 409
    assert (await _mark(client, room, clock["id"], delta=0)).status_code == 422
    assert (await _mark(client, room, clock["id"], note="x" * 201, delta=-1)).status_code == 422
    reopened = await _mark(client, room, clock["id"], delta=-1)
    assert (reopened.json()["clock"]["filled"], reopened.json()["clock"]["state"]) == (3, "open")
    history = (
        await client.get(f"{room.clock(clock['id'])}/history", headers=room.player.headers)
    ).json()
    actions = [entry["action"] for entry in reversed(history["entries"])]
    assert actions == ["created", "marked", "marked", "closed", "marked", "reopened"]
    first_mark = history["entries"][-2]["details"]
    assert first_mark["delta"] == 2 and first_mark["note"] == "forzata la serratura"
    assert history["next_before"] is None


async def test_who_marks(client: AsyncClient, room: _Room) -> None:
    clock = await _clock(client, room)
    assert (await _mark(client, room, clock["id"], room.player)).status_code == 403
    await _rules(client, room, mark_policy="everyone", allow_unmark=False)
    assert (await _mark(client, room, clock["id"], room.player)).status_code == 201
    refused = await _mark(client, room, clock["id"], room.master, delta=-1)
    assert refused.status_code == 403
    listed = (await client.get(f"{room.url}/clocks", headers=room.player.headers)).json()
    assert listed[0]["can_mark"] and not listed[0]["can_unmark"]


async def test_mark_kinds_on_marks(client: AsyncClient, room: _Room) -> None:
    url = f"{room.url}/clock-rules/mark-kinds"
    shock = (
        await client.post(url, json={"name": "Shock", "who": "master"}, headers=room.master.headers)
    ).json()
    success = (
        await client.post(
            url, json={"name": "Successo", "who": "players"}, headers=room.master.headers
        )
    ).json()
    clock = await _clock(client, room, mark_policy="everyone", segments=6)
    await _mark(client, room, clock["id"], room.player, delta=2)
    await _mark(client, room, clock["id"], room.master)
    refused = await _mark(client, room, clock["id"], room.player, kind_id=shock["id"])
    assert refused.status_code == 403
    unknown = await _mark(client, room, clock["id"], room.player, kind_id=str(uuid.uuid4()))
    assert unknown.status_code == 422
    emptied = await _mark(client, room, clock["id"], room.master, delta=-1, kind_id=shock["id"])
    assert emptied.json()["clock"]["segment_kinds"] == [success["id"], success["id"]]


async def test_undo(client: AsyncClient, room: _Room, db_session: AsyncSession) -> None:
    await _rules(client, room, mark_policy="everyone", allow_unmark=False)
    clock = await _clock(client, room, segments=2)
    other = await _clock(client, room)
    marked = (await _mark(client, room, clock["id"], room.player, delta=2)).json()
    assert marked["clock"]["state"] == "closed"
    url = f"{room.clock(clock['id'])}/marks/{marked['mark_id']}/undo"
    assert (await client.post(url, headers=room.other.headers)).status_code == 403
    wrong = f"{room.clock(other['id'])}/marks/{marked['mark_id']}/undo"
    assert (await client.post(wrong, headers=room.player.headers)).status_code == 404
    undone = await client.post(url, headers=room.player.headers)
    assert undone.status_code == 200
    assert (undone.json()["clock"]["filled"], undone.json()["clock"]["state"]) == (0, "open")
    assert (await client.post(url, headers=room.player.headers)).status_code == 409

    late = (await _mark(client, room, clock["id"], room.player)).json()
    await db_session.execute(
        update(RoomClockMarkRow)
        .where(RoomClockMarkRow.id == uuid.UUID(late["mark_id"]))
        .values(created_at=datetime.now(UTC) - timedelta(minutes=5))
    )
    expired = await client.post(
        f"{room.clock(clock['id'])}/marks/{late['mark_id']}/undo", headers=room.player.headers
    )
    assert expired.status_code == 409
    history = (
        await client.get(f"{room.clock(clock['id'])}/history", headers=room.master.headers)
    ).json()
    assert [entry["action"] for entry in reversed(history["entries"])] == [
        "created",
        "marked",
        "closed",
        "undone",
        "reopened",
        "marked",
    ]


async def test_sequence_locks(client: AsyncClient, room: _Room, db_session: AsyncSession) -> None:
    first = await _clock(client, room, name="Entrare", segments=2)
    second = await _clock(client, room, name="Covo")
    now = datetime.now(UTC)
    group = await clocks_repo.save_group(
        db_session,
        ClockGroup(
            id=uuid.uuid4(),
            room_id=uuid.UUID(room.id),
            name="Colpo",
            mode=GroupMode.SEQUENCE,
            position=0,
            created_by=uuid.UUID(room.master.id),
            created_at=now,
            updated_at=now,
        ),
    )
    for position, clock in enumerate((first, second)):
        stored = await clocks_repo.get_clock(db_session, uuid.UUID(clock["id"]))
        assert stored is not None
        await clocks_repo.update_clock(
            db_session, replace(stored, group_id=group.id, group_position=position)
        )
    listed = {
        c["name"]: c
        for c in (await client.get(f"{room.url}/clocks", headers=room.master.headers)).json()
    }
    assert listed["Covo"]["locked"] and not listed["Covo"]["can_mark"]
    assert not listed["Entrare"]["locked"]
    assert (await _mark(client, room, second["id"])).status_code == 409
    await _mark(client, room, first["id"], delta=2)
    assert (await _mark(client, room, second["id"])).status_code == 201


async def test_history_pages_and_hides_the_consequence(
    client: AsyncClient, room: _Room, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = await _clock(client, room, consequence="Boom")
    await client.patch(
        room.clock(clock["id"]),
        json={"consequence": "Bang", "name": "Nuovo"},
        headers=room.master.headers,
    )
    await client.patch(
        room.clock(clock["id"]), json={"consequence": "Crash"}, headers=room.master.headers
    )
    monkeypatch.setattr(clocks_api, "HISTORY_PAGE_SIZE", 2)
    url = f"{room.clock(clock['id'])}/history"
    page = (await client.get(url, headers=room.player.headers)).json()
    assert [entry["details"].get("fields") for entry in page["entries"]] == [[], ["name"]]
    assert page["next_before"] is not None
    rest = (
        await client.get(url, params={"before": page["next_before"]}, headers=room.player.headers)
    ).json()
    assert [entry["action"] for entry in rest["entries"]] == ["created"]
    assert rest["next_before"] is None
    master_view = (await client.get(url, headers=room.master.headers)).json()
    assert master_view["entries"][0]["details"]["fields"] == ["consequence"]


# --- Live events ----------------------------------------------------------------


async def test_events_reach_who_sees_the_clock(client: AsyncClient, room: _Room) -> None:
    room_id = uuid.UUID(room.id)
    player = broker.subscribe(room_id, uuid.UUID(room.player.id))
    master = broker.subscribe(room_id, uuid.UUID(room.master.id))
    try:
        shared = await _clock(client, room)
        secret = await _clock(client, room, visibility="master")
        marked = (await _mark(client, room, shared["id"])).json()
        await _mark(client, room, secret["id"])
        hidden = (
            await client.patch(
                room.clock(shared["id"]), json={"visibility": "master"}, headers=room.master.headers
            )
        ).json()
        await client.delete(room.clock(secret["id"]), headers=room.master.headers)
        await _rules(client, room)
        heard = [(e.topic, e.kind, e.id) for e in _drain(player)]
        shared_id, secret_id = uuid.UUID(shared["id"]), uuid.UUID(secret["id"])
        assert heard == [
            ("landing", "changed", None),
            ("clock", "changed", shared_id),
            ("clock", "marked", shared_id),
            ("clock", "changed", shared_id),
            ("clock_rules", "changed", None),
        ]
        master_heard = [(e.kind, e.id) for e in _drain(master) if e.topic == "clock"]
        assert ("deleted", secret_id) in master_heard and ("marked", secret_id) in master_heard
        assert marked["clock"]["revision"] < hidden["revision"]
    finally:
        broker.unsubscribe(player)
        broker.unsubscribe(master)

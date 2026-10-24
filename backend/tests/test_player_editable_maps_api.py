"""Maps editable by players (spec 42_1): the switch that opens a free or
geographic map's board to every member who sees it, what stays with its
managers, and the revision guard against overwriting someone else's save."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app

SQUARE = [[10, 10], [110, 10], [110, 110], [10, 110]]


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
    def maps_url(self) -> str:
        return f"/rooms/{self.id}/maps"

    def map_url(self, map_id: str) -> str:
        return f"/rooms/{self.id}/maps/{map_id}"


def _id() -> str:
    return str(uuid.uuid4())


async def _member(client: AsyncClient, make_token: Callable[..., str]) -> _Member:
    user_id = _id()
    return _Member(id=user_id, headers={"Authorization": f"Bearer {make_token(user_id)}"})


async def _room(client: AsyncClient, make_token: Callable[..., str]) -> _Room:
    master = await _member(client, make_token)
    room = (
        await client.post("/rooms", json={"name": "Los Angeles"}, headers=master.headers)
    ).json()
    player = await _member(client, make_token)
    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations", json={"role": "player"}, headers=master.headers
        )
    ).json()
    await client.post(f"/invitations/{invite['code']}/accept", headers=player.headers)
    return _Room(id=room["id"], master=master, player=player)


async def _document(client: AsyncClient, room: _Room, name: str, visibility: str = "room") -> str:
    response = await client.post(
        f"/rooms/{room.id}/documents",
        json={"name": name, "visibility": visibility},
        headers=room.master.headers,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _map(client: AsyncClient, room: _Room, **fields: Any) -> dict[str, Any]:
    response = await client.post(
        room.maps_url, json={"name": "Coterie", **fields}, headers=room.master.headers
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def _unlock(client: AsyncClient, room: _Room, map_id: str, on: bool = True) -> Any:
    response = await client.patch(
        room.map_url(map_id), json={"players_can_edit": on}, headers=room.master.headers
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _board(client: AsyncClient, room: _Room, map_id: str, viewer: _Member) -> Any:
    response = await client.get(room.map_url(map_id), headers=viewer.headers)
    assert response.status_code == 200, response.text
    return response.json()


async def _save(
    client: AsyncClient, room: _Room, map_id: str, editor: _Member, **board: Any
) -> Any:
    return await client.put(f"{room.map_url(map_id)}/board", json=board, headers=editor.headers)


def _text_card(text: str = "Unknown Sire", **fields: Any) -> dict[str, Any]:
    return {"id": _id(), "text": text, "x": 10, "y": 20, **fields}


async def test_a_map_starts_locked_and_only_its_managers_edit_it(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    created = await _map(client, room)

    assert created["players_can_edit"] is False
    assert created["revision"] == 0
    assert (created["can_edit"], created["can_manage"]) == (True, True)
    seen = await _board(client, room, created["id"], room.player)
    assert (seen["can_edit"], seen["can_manage"]) == (False, False)
    refused = await _save(client, room, created["id"], room.player, cards=[_text_card()])
    assert refused.status_code == 403
    assert "locked" in refused.json()["detail"]


async def test_an_unlocked_map_is_edited_by_a_player_but_not_managed(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    thorn = await _document(client, room, "Thorn")
    mira = await _document(client, room, "Mira")
    relationship_map = await _map(client, room)
    map_id = relationship_map["id"]

    unlocked = await _unlock(client, room, map_id)
    assert unlocked["players_can_edit"] is True
    assert unlocked["revision"] == 1

    listed = (await client.get(room.maps_url, headers=room.player.headers)).json()
    assert [(m["players_can_edit"], m["can_edit"], m["can_manage"]) for m in listed] == [
        (True, True, False)
    ]
    assert listed[0]["selective_user_ids"] is None

    thorn_card = {"id": _id(), "document_id": thorn, "x": 0, "y": 0}
    mira_card = {"id": _id(), "document_id": mira, "x": 200, "y": 0}
    arrow = {
        "id": _id(),
        "from_end": {"card_id": thorn_card["id"]},
        "to_end": {"card_id": mira_card["id"]},
        "label": "rivale",
    }
    saved = await _save(
        client, room, map_id, room.player, cards=[thorn_card, mira_card], arrows=[arrow]
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 2
    board = await _board(client, room, map_id, room.master)
    assert {card["document_id"] for card in board["cards"]} == {thorn, mira}
    assert [a["label"] for a in board["arrows"]] == ["rivale"]

    url = room.map_url(map_id)
    for body in ({"name": "Mine"}, {"visibility": "private"}, {"players_can_edit": False}):
        assert (await client.patch(url, json=body, headers=room.player.headers)).status_code == 403
    assert (await client.delete(url, headers=room.player.headers)).status_code == 403

    await _unlock(client, room, map_id, on=False)
    relocked = await _save(client, room, map_id, room.player, cards=[])
    assert relocked.status_code == 403


async def test_a_players_edit_keeps_what_is_hidden_from_them_and_no_master_only_content(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    secret = await _document(client, room, "The Sire", visibility="master")
    map_id = (await _map(client, room))["id"]
    hidden_card = {"id": _id(), "document_id": secret, "x": 0, "y": 0}
    master_note = _text_card("Father of", master_only=True)
    assert (
        await _save(client, room, map_id, room.master, cards=[hidden_card, master_note])
    ).status_code == 200
    await _unlock(client, room, map_id)

    assert (await _save(client, room, map_id, room.player, cards=[_text_card()])).status_code == 200
    kept = await _board(client, room, map_id, room.master)
    assert {card["id"] for card in kept["cards"]} >= {hidden_card["id"], master_note["id"]}
    assert len(kept["cards"]) == 3

    forbidden = await _save(
        client, room, map_id, room.player, cards=[_text_card("Mine", master_only=True)]
    )
    assert forbidden.status_code == 403


async def test_an_unlocked_map_hidden_from_a_player_stays_not_found(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    map_id = (await _map(client, room, visibility="master"))["id"]
    await _unlock(client, room, map_id)

    assert (await _save(client, room, map_id, room.player, cards=[])).status_code == 404


async def test_a_save_based_on_an_old_revision_is_refused_and_writes_nothing(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    map_id = (await _map(client, room))["id"]
    await _unlock(client, room, map_id)  # revision 1

    first = _text_card("Giulia's")
    giulia = await _save(client, room, map_id, room.player, base_revision=1, cards=[first])
    assert giulia.status_code == 200
    assert giulia.json()["revision"] == 2

    # Marco's page still holds revision 1: his board lacks Giulia's card.
    marco = await _save(client, room, map_id, room.master, base_revision=1, cards=[_text_card()])
    assert marco.status_code == 412
    assert "Someone else" in marco.json()["detail"]
    board = await _board(client, room, map_id, room.master)
    assert [card["id"] for card in board["cards"]] == [first["id"]]
    assert board["revision"] == 2

    # Without a base revision (an old tab) the save isn't checked.
    unchecked = await _save(client, room, map_id, room.master, cards=[first])
    assert unchecked.status_code == 200
    assert unchecked.json()["revision"] == 3


async def test_a_geographic_map_unlocked_is_edited_by_a_player_but_its_plane_is_not(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    map_id = (await _map(client, room, kind="geographic"))["id"]
    url = room.map_url(map_id)
    pin = {"id": _id(), "name": "Shibuya 109", "x": 50, "y": 60}

    locked = await client.put(f"{url}/geo", json={"pins": [pin]}, headers=room.player.headers)
    assert locked.status_code == 403
    unlocked = await _unlock(client, room, map_id)

    saved = await client.put(
        f"{url}/geo",
        json={"base_revision": unlocked["revision"], "pins": [pin], "areas": []},
        headers=room.player.headers,
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["can_manage"] is False
    assert [p["name"] for p in saved.json()["pins"]] == ["Shibuya 109"]

    stale = await client.put(
        f"{url}/geo", json={"base_revision": unlocked["revision"]}, headers=room.player.headers
    )
    assert stale.status_code == 412

    assert (
        await client.patch(url, json={"plane_width": 3000}, headers=room.player.headers)
    ).status_code == 403
    assert (
        await client.delete(f"{url}/background", headers=room.player.headers)
    ).status_code == 403


async def test_a_duplicated_room_has_its_maps_locked(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    map_id = (await _map(client, room))["id"]
    await _unlock(client, room, map_id)

    copy = await client.post(f"/rooms/{room.id}/duplicate", headers=room.master.headers)
    assert copy.status_code == 201, copy.text
    copied = (
        await client.get(f"/rooms/{copy.json()['room']['id']}/maps", headers=room.master.headers)
    ).json()
    assert [m["players_can_edit"] for m in copied] == [False]

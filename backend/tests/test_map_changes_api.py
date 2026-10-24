"""Per-item saves (spec 43_1): `PATCH .../board` and `PATCH .../geo` send
only what an editor changed, laid over the stored map, so two editors never
overwrite each other's work."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
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


async def _patch(
    client: AsyncClient, room: _Room, map_id: str, editor: _Member, **changes: Any
) -> Any:
    response = await client.patch(
        f"{room.map_url(map_id)}/board", json=changes, headers=editor.headers
    )
    return response


async def test_two_editors_saving_their_own_changes_keep_each_others_work(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    thorn = await _document(client, room, "Thorn")
    map_id = (await _map(client, room))["id"]
    await _unlock(client, room, map_id)

    # Both load the empty board, then each adds a card the other never saw.
    master_card = {"id": _id(), "document_id": thorn, "x": 0, "y": 0}
    player_card = _text_card("Mira's debt")
    first = await _patch(
        client, room, map_id, room.master, cards=[master_card], created_ids=[master_card["id"]]
    )
    assert first.status_code == 200, first.text
    second = await _patch(
        client,
        room,
        map_id,
        room.player,
        base_revision=1,
        cards=[player_card],
        created_ids=[player_card["id"]],
    )
    assert second.status_code == 200, second.text
    assert {card["id"] for card in second.json()["cards"]} == {
        master_card["id"],
        player_card["id"],
    }
    assert second.json()["revision"] == 3

    # The Master moves their card and deletes the Player's: both apply.
    moved = {**master_card, "x": 300}
    third = await _patch(
        client, room, map_id, room.master, cards=[moved], deleted_ids=[player_card["id"]]
    )
    assert [(c["id"], c["x"]) for c in third.json()["cards"]] == [(master_card["id"], 300)]

    # The Player, not knowing, moves the card that is gone: dropped, not revived.
    late = await _patch(client, room, map_id, room.player, cards=[{**player_card, "x": 99}])
    assert late.status_code == 200, late.text
    assert [c["id"] for c in late.json()["cards"]] == [master_card["id"]]
    # A second card for Thorn, made before they saw the Master's, is dropped.
    twin = {"id": _id(), "document_id": thorn, "x": 50, "y": 50}
    dropped = await _patch(
        client, room, map_id, room.player, cards=[twin], created_ids=[twin["id"]]
    )
    assert [c["id"] for c in dropped.json()["cards"]] == [master_card["id"]]


async def test_a_players_changes_leave_hidden_items_alone_and_follow_the_board_rules(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    map_id = (await _map(client, room))["id"]
    master_note = _text_card("Father of", master_only=True)
    assert (
        await _patch(
            client, room, map_id, room.master, cards=[master_note], created_ids=[master_note["id"]]
        )
    ).status_code == 200

    locked = await _patch(client, room, map_id, room.player, cards=[_text_card()])
    assert locked.status_code == 403
    await _unlock(client, room, map_id)

    # Guessing the hidden card's id changes nothing and refuses nothing.
    guessed = await _patch(
        client,
        room,
        map_id,
        room.player,
        cards=[{**master_note, "master_only": False, "text": "Mine"}],
        deleted_ids=[master_note["id"]],
    )
    assert guessed.status_code == 200, guessed.text
    assert guessed.json()["cards"] == []
    kept = await _board(client, room, map_id, room.master)
    assert [(c["id"], c["text"]) for c in kept["cards"]] == [(master_note["id"], "Father of")]

    mine = _text_card("Mine", master_only=True)
    forbidden = await _patch(
        client, room, map_id, room.player, cards=[mine], created_ids=[mine["id"]]
    )
    assert forbidden.status_code == 403
    twice = _text_card()
    repeated = await _patch(
        client, room, map_id, room.player, cards=[twice, twice], created_ids=[twice["id"]]
    )
    assert repeated.status_code == 422


async def test_a_geographic_map_takes_changes_and_each_route_its_own_kind(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    geo_id = (await _map(client, room, kind="geographic"))["id"]
    free_id = (await _map(client, room))["id"]
    await _unlock(client, room, geo_id)
    url = room.map_url(geo_id)
    pin = {"id": _id(), "name": "Shibuya 109", "x": 50, "y": 60}
    area = {"id": _id(), "name": "Bosco", "points": [[10, 10], [110, 10], [110, 110], [10, 110]]}

    first = await client.patch(
        f"{url}/geo", json={"pins": [pin], "created_ids": [pin["id"]]}, headers=room.master.headers
    )
    assert first.status_code == 200, first.text
    second = await client.patch(
        f"{url}/geo",
        json={"areas": [area], "created_ids": [area["id"]]},
        headers=room.player.headers,
    )
    assert second.status_code == 200, second.text
    assert [p["id"] for p in second.json()["pins"]] == [pin["id"]]
    assert [a["id"] for a in second.json()["areas"]] == [area["id"]]
    moved = await client.patch(
        f"{url}/geo", json={"pins": [{**pin, "x": 80}]}, headers=room.player.headers
    )
    assert [(p["x"], len(moved.json()["areas"])) for p in moved.json()["pins"]] == [(80, 1)]

    on_free = await client.patch(
        f"{room.map_url(free_id)}/geo", json={}, headers=room.master.headers
    )
    assert on_free.status_code == 409
    on_geo = await _patch(client, room, geo_id, room.master)
    assert on_geo.status_code == 409

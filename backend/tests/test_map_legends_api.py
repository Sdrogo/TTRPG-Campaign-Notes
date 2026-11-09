"""Spec 68: relation color meanings of a free map, its own or through a Room
preset it stays linked to, and the presets themselves."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.map_legends import MAX_PRESETS_PER_ROOM
from app.main import app


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@dataclass
class _Room:
    id: str
    master: dict[str, str]
    player: dict[str, str]

    @property
    def presets(self) -> str:
        return f"/rooms/{self.id}/map-legend-presets"

    def map_url(self, map_id: str) -> str:
        return f"/rooms/{self.id}/maps/{map_id}"


def _headers(make_token: Callable[..., str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(str(uuid.uuid4()))}"}


async def _room(client: AsyncClient, make_token: Callable[..., str]) -> _Room:
    master = _headers(make_token)
    room = (await client.post("/rooms", json={"name": "Los Angeles"}, headers=master)).json()
    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations", json={"role": "player"}, headers=master
        )
    ).json()
    player = _headers(make_token)
    await client.post(f"/invitations/{invite['code']}/accept", headers=player)
    return _Room(room["id"], master, player)


async def _map(client: AsyncClient, room: _Room, **fields: Any) -> str:
    response = await client.post(
        f"/rooms/{room.id}/maps", json={"name": "Court", **fields}, headers=room.master
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _legend(
    client: AsyncClient, room: _Room, map_id: str, headers: dict[str, str], **legend: Any
) -> Response:
    return await client.patch(
        f"{room.map_url(map_id)}/board", json={"legend": legend}, headers=headers
    )


async def _detail(client: AsyncClient, room: _Room, map_id: str) -> dict[str, Any]:
    response = await client.get(room.map_url(map_id), headers=room.player)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def _preset(client: AsyncClient, room: _Room, name: str, **entries: str) -> dict[str, Any]:
    response = await client.post(
        room.presets, json={"name": name, "entries": entries}, headers=room.master
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_a_map_keeps_its_own_meanings_cleaned_until_cleared(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    map_id = await _map(client, room)
    assert (await _detail(client, room, map_id))["color_legend"] == {}

    saved = await _legend(
        client,
        room,
        map_id,
        room.master,
        meanings={"pink": "  Love   interest ", "red": "Rival", "green": "  "},
    )
    assert saved.status_code == 200, saved.text
    body = await _detail(client, room, map_id)
    # Trimmed, the empty one dropped, in palette order (Decisions 2, 5).
    assert list(body["color_legend"].items()) == [("red", "Rival"), ("pink", "Love interest")]
    assert body["legend_preset"] is None

    # A board save without `legend` leaves it as it is.
    untouched = await client.patch(
        f"{room.map_url(map_id)}/board", json={"cards": []}, headers=room.master
    )
    assert untouched.json()["color_legend"] == {"red": "Rival", "pink": "Love interest"}
    # So does a whole-board save.
    whole = await client.put(f"{room.map_url(map_id)}/board", json={}, headers=room.master)
    assert whole.json()["color_legend"] == {"red": "Rival", "pink": "Love interest"}

    too_long = await _legend(client, room, map_id, room.master, meanings={"red": "x" * 41})
    assert too_long.status_code == 422

    cleared = await _legend(client, room, map_id, room.master, meanings={})
    assert cleared.json()["color_legend"] == {}


async def test_only_who_edits_the_board_changes_the_meanings(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    map_id = await _map(client, room)

    refused = await _legend(client, room, map_id, room.player, meanings={"red": "Rival"})
    assert refused.status_code == 403

    await client.patch(room.map_url(map_id), json={"players_can_edit": True}, headers=room.master)
    allowed = await _legend(client, room, map_id, room.player, meanings={"red": "Rival"})
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["color_legend"] == {"red": "Rival"}


async def test_only_the_master_writes_presets_and_every_member_reads_them(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    body = {"name": "Court", "entries": {"red": "Adversary"}}
    # A new Room has none.
    assert (await client.get(room.presets, headers=room.player)).json() == []

    refused = await client.post(room.presets, json=body, headers=room.player)
    assert refused.status_code == 403

    court = await _preset(client, room, " Court ", green="Ally", red="Adversary")
    assert court["name"] == "Court"
    assert list(court["entries"]) == ["red", "green"] and court["map_count"] == 0
    await _preset(client, room, "Atlantis harbor", silver="Neutral")

    listed = await client.get(room.presets, headers=room.player)
    assert listed.status_code == 200
    assert [p["name"] for p in listed.json()] == ["Atlantis harbor", "Court"]

    taken = await client.post(room.presets, json=body, headers=room.master)
    assert taken.status_code == 409
    nameless = await client.post(
        room.presets, json={"name": " ", "entries": {"red": "x"}}, headers=room.master
    )
    assert nameless.status_code == 422
    empty = await client.post(
        room.presets, json={"name": "Empty", "entries": {"red": " "}}, headers=room.master
    )
    assert empty.status_code == 422
    long_meaning = await client.post(
        room.presets, json={"name": "Long", "entries": {"red": "x" * 41}}, headers=room.master
    )
    assert long_meaning.status_code == 422

    player_edit = await client.patch(
        f"{room.presets}/{court['id']}", json={"name": "Mine"}, headers=room.player
    )
    assert player_edit.status_code == 403
    player_delete = await client.delete(f"{room.presets}/{court['id']}", headers=room.player)
    assert player_delete.status_code == 403


async def test_a_room_holds_a_limited_number_of_presets(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    for number in range(MAX_PRESETS_PER_ROOM):
        await _preset(client, room, f"Preset {number}", red="Rival")
    over = await client.post(
        room.presets, json={"name": "One more", "entries": {"red": "x"}}, headers=room.master
    )
    assert over.status_code == 409


async def test_a_linked_map_follows_its_preset_live_and_keeps_a_copy_when_it_goes(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    map_id = await _map(client, room)
    other_map = await _map(client, room)
    court = await _preset(client, room, "Court", red="Adversary", green="Ally")
    harbor = await _preset(client, room, "Harbor", orange="Smuggling")

    await _legend(client, room, map_id, room.master, meanings={"lime": "Former ally"})
    linked = await _legend(client, room, map_id, room.master, preset_id=court["id"])
    assert linked.status_code == 200, linked.text
    # Applying replaces the map's own meanings (Decision 21).
    assert linked.json()["color_legend"] == {"red": "Adversary", "green": "Ally"}
    assert linked.json()["legend_preset"] == {"id": court["id"], "name": "Court"}
    await _legend(client, room, other_map, room.master, preset_id=court["id"])

    listed = (await client.get(room.presets, headers=room.master)).json()
    assert {p["name"]: p["map_count"] for p in listed} == {"Court": 2, "Harbor": 0}

    # Editing the preset changes every linked map at once (Decision 20).
    edited = await client.patch(
        f"{room.presets}/{court['id']}",
        json={"entries": {"red": "Enemy", "pink": "Love interest"}},
        headers=room.master,
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["map_count"] == 2
    for linked_map in (map_id, other_map):
        assert (await _detail(client, room, linked_map))["color_legend"] == {
            "red": "Enemy",
            "pink": "Love interest",
        }

    renamed = await client.patch(
        f"{room.presets}/{court['id']}", json={"name": "Vampire court"}, headers=room.master
    )
    assert renamed.json()["entries"] == {"red": "Enemy", "pink": "Love interest"}
    assert (await _detail(client, room, map_id))["legend_preset"]["name"] == "Vampire court"
    same_name = await client.patch(
        f"{room.presets}/{court['id']}", json={"name": "Vampire court"}, headers=room.master
    )
    assert same_name.status_code == 200
    clash = await client.patch(
        f"{room.presets}/{court['id']}", json={"name": "Harbor"}, headers=room.master
    )
    assert clash.status_code == 409

    # Unlinking: the client sends the preset's meanings as the map's own.
    unlinked = await _legend(client, room, other_map, room.master, meanings={"red": "Enemy"})
    assert unlinked.json()["legend_preset"] is None

    # Deleting the preset leaves the linked map its copy (Decision 23).
    deleted = await client.delete(f"{room.presets}/{court['id']}", headers=room.master)
    assert deleted.status_code == 204
    kept = await _detail(client, room, map_id)
    assert kept["legend_preset"] is None
    assert kept["color_legend"] == {"red": "Enemy", "pink": "Love interest"}
    gone = await client.delete(f"{room.presets}/{court['id']}", headers=room.master)
    assert gone.status_code == 404
    assert harbor["map_count"] == 0


async def test_a_preset_of_another_room_is_not_found(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    elsewhere = await _room(client, make_token)
    foreign = await _preset(client, elsewhere, "Theirs", red="Rival")
    map_id = await _map(client, room)

    linked = await _legend(client, room, map_id, room.master, preset_id=foreign["id"])
    assert linked.status_code == 404
    missing = await _legend(client, room, map_id, room.master, preset_id=str(uuid.uuid4()))
    assert missing.status_code == 404
    edited = await client.patch(
        f"{room.presets}/{foreign['id']}", json={"name": "Ours"}, headers=room.master
    )
    assert edited.status_code == 404


async def test_the_copy_of_a_room_keeps_presets_and_links(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    linked_map = await _map(client, room, name="Linked")
    own_map = await _map(client, room, name="Own")
    court = await _preset(client, room, "Court", red="Adversary")
    await _legend(client, room, linked_map, room.master, preset_id=court["id"])
    await _legend(client, room, own_map, room.master, meanings={"green": "Ally"})

    response = await client.post(f"/rooms/{room.id}/duplicate", headers=room.master)
    assert response.status_code == 201, response.text
    copy_id = response.json()["room"]["id"]

    presets = (await client.get(f"/rooms/{copy_id}/map-legend-presets", headers=room.master)).json()
    assert [(p["name"], p["map_count"]) for p in presets] == [("Court", 1)]
    assert presets[0]["id"] != court["id"]
    maps = (await client.get(f"/rooms/{copy_id}/maps", headers=room.master)).json()
    details = {
        m["name"]: (
            await client.get(f"/rooms/{copy_id}/maps/{m['id']}", headers=room.master)
        ).json()
        for m in maps
    }
    assert details["Linked"]["legend_preset"]["id"] == presets[0]["id"]
    assert details["Linked"]["color_legend"] == {"red": "Adversary"}
    assert details["Own"]["color_legend"] == {"green": "Ally"}


async def test_the_json_export_writes_what_each_map_means(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    linked_map = await _map(client, room, name="Linked")
    await _map(client, room, name="Plain")
    court = await _preset(client, room, "Court", red="Adversary")
    await _legend(client, room, linked_map, room.master, preset_id=court["id"])

    response = await client.get(
        f"/rooms/{room.id}/export", params={"format": "json"}, headers=room.master
    )
    assert response.status_code == 200, response.text
    maps = {m["name"]: m for m in response.json()["maps"]}
    assert maps["Linked"]["color_legend"] == {"red": "Adversary"}
    assert "color_legend" not in maps["Plain"]

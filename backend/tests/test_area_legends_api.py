"""Spec 77b: the area color legend of a geographic map, its own or through
a Room preset of kind `areas`, never telling a viewer what a color only
hidden areas use means."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app

SQUARE = [[10, 10], [110, 10], [110, 110], [10, 110]]


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
    room = (await client.post("/rooms", json={"name": "Tokyo"}, headers=master)).json()
    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations", json={"role": "player"}, headers=master
        )
    ).json()
    player = _headers(make_token)
    await client.post(f"/invitations/{invite['code']}/accept", headers=player)
    return _Room(room["id"], master, player)


async def _map(client: AsyncClient, room: _Room, kind: str = "geographic") -> str:
    response = await client.post(
        f"/rooms/{room.id}/maps", json={"name": "Shibuya", "kind": kind}, headers=room.master
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def _area(color: str, **fields: Any) -> dict[str, Any]:
    return {"id": str(uuid.uuid4()), "name": "Zone", "points": SQUARE, "color": color, **fields}


async def _preset(
    client: AsyncClient, room: _Room, name: str, kind: str | None, **entries: str
) -> Response:
    body: dict[str, Any] = {"name": name, "entries": entries}
    if kind is not None:
        body["kind"] = kind
    return await client.post(room.presets, json=body, headers=room.master)


async def _geo(client: AsyncClient, room: _Room, map_id: str, viewer: dict[str, str]) -> Any:
    response = await client.get(f"{room.map_url(map_id)}/geo", headers=viewer)
    assert response.status_code == 200, response.text
    return response.json()


async def test_the_legend_is_saved_through_the_geographic_map(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    map_id = await _map(client, room)
    saved = await client.put(
        f"{room.map_url(map_id)}/geo",
        json={"areas": [_area("red")], "legend": {"meanings": {"red": " Yakuza ", "blue": ""}}},
        headers=room.master,
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["color_legend"] == {"red": "Yakuza"}
    assert saved.json()["legend_preset"] is None
    # A live save without `legend` keeps it; the map detail shows it too.
    kept = await client.patch(f"{room.map_url(map_id)}/geo", json={}, headers=room.master)
    assert kept.json()["color_legend"] == {"red": "Yakuza"}
    detail = await client.get(room.map_url(map_id), headers=room.player)
    assert detail.json()["color_legend"] == {"red": "Yakuza"}

    too_long = await client.patch(
        f"{room.map_url(map_id)}/geo",
        json={"legend": {"meanings": {"red": "x" * 41}}},
        headers=room.master,
    )
    assert too_long.status_code == 422


async def test_presets_have_a_kind_and_serve_only_maps_of_that_kind(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    relations = await _preset(client, room, "Court", None, red="Rival")
    areas = await _preset(client, room, "Court", "areas", red="Yakuza")
    # The same name in both kinds; not twice in one.
    assert (relations.status_code, areas.status_code) == (201, 201)
    assert (relations.json()["kind"], areas.json()["kind"]) == ("relations", "areas")
    assert (await _preset(client, room, "Court", "areas", blue="Police")).status_code == 409
    renamed = await _preset(client, room, "Turf", "areas", blue="Police")
    clash = await client.patch(
        f"{room.presets}/{renamed.json()['id']}", json={"name": "Court"}, headers=room.master
    )
    assert clash.status_code == 409
    listed = (await client.get(room.presets, headers=room.player)).json()
    assert sorted((p["name"], p["kind"]) for p in listed) == [
        ("Court", "areas"),
        ("Court", "relations"),
        ("Turf", "areas"),
    ]

    geo = await _map(client, room)
    free = await _map(client, room, kind="free")
    wrong_geo = await client.patch(
        f"{room.map_url(geo)}/geo",
        json={"legend": {"preset_id": relations.json()["id"]}},
        headers=room.master,
    )
    wrong_free = await client.patch(
        f"{room.map_url(free)}/board",
        json={"legend": {"preset_id": areas.json()["id"]}},
        headers=room.master,
    )
    assert (wrong_geo.status_code, wrong_free.status_code) == (404, 404)

    linked = await client.patch(
        f"{room.map_url(geo)}/geo",
        json={"areas": [_area("red")], "legend": {"preset_id": areas.json()["id"]}},
        headers=room.master,
    )
    assert linked.status_code == 200, linked.text
    assert linked.json()["color_legend"] == {"red": "Yakuza"}
    assert linked.json()["legend_preset"]["id"] == areas.json()["id"]


async def test_a_player_never_reads_the_meaning_of_a_color_only_hidden_areas_use(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    secret = await client.post(
        f"/rooms/{room.id}/documents",
        json={"name": "Black Lotus", "visibility": "master"},
        headers=room.master,
    )
    map_id = await _map(client, room)
    meanings = {"red": "Yakuza", "blue": "Cult", "green": "Lotus", "gold": "Unused"}
    saved = await client.put(
        f"{room.map_url(map_id)}/geo",
        json={
            "areas": [
                _area("red"),
                _area("blue", master_only=True),
                _area("green", name=None, document_id=secret.json()["id"]),
            ],
            "legend": {"meanings": meanings},
        },
        headers=room.master,
    )
    assert saved.status_code == 200, saved.text
    assert (await _geo(client, room, map_id, room.master))["color_legend"] == meanings

    # Blue only on a Master-only area, green only on a hidden Document's:
    # gone for the Player; an unused color points at nothing and stays.
    for_player = {"red": "Yakuza", "gold": "Unused"}
    assert (await _geo(client, room, map_id, room.player))["color_legend"] == for_player
    detail = await client.get(room.map_url(map_id), headers=room.player)
    assert detail.json()["color_legend"] == for_player
    exported = await client.get(f"{room.map_url(map_id)}/export", headers=room.player)
    assert exported.json()["color_legend"] == for_player
    room_export = await client.get(
        f"/rooms/{room.id}/export", params={"format": "json"}, headers=room.player
    )
    assert room_export.json()["maps"][0]["color_legend"] == for_player

    # A visible blue area makes blue's meaning visible; green, now on no
    # area, points at nothing any more.
    await client.put(
        f"{room.map_url(map_id)}/geo",
        json={
            "areas": [_area("red"), _area("blue")],
            "legend": {"meanings": meanings},
        },
        headers=room.master,
    )
    assert (await _geo(client, room, map_id, room.player))["color_legend"] == {
        "red": "Yakuza",
        "blue": "Cult",
        "green": "Lotus",
        "gold": "Unused",
    }


async def test_a_player_editing_keeps_the_meanings_they_cannot_see(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    map_id = await _map(client, room)
    await client.patch(room.map_url(map_id), json={"players_can_edit": True}, headers=room.master)
    await client.put(
        f"{room.map_url(map_id)}/geo",
        json={
            "areas": [_area("red"), _area("blue", master_only=True)],
            "legend": {"meanings": {"red": "Yakuza", "blue": "Cult"}},
        },
        headers=room.master,
    )
    # The Player sends the legend they see, changed, and even tries blue.
    saved = await client.patch(
        f"{room.map_url(map_id)}/geo",
        json={"legend": {"meanings": {"red": "Gang", "blue": "Guess", "pink": "Clan"}}},
        headers=room.player,
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["color_legend"] == {"red": "Gang", "pink": "Clan"}
    assert (await _geo(client, room, map_id, room.master))["color_legend"] == {
        "red": "Gang",
        "blue": "Cult",
        "pink": "Clan",
    }


async def test_the_map_file_carries_the_legend_both_ways(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    map_id = await _map(client, room)
    await client.put(
        f"{room.map_url(map_id)}/geo",
        json={"areas": [_area("red")], "legend": {"meanings": {"red": "Yakuza"}}},
        headers=room.master,
    )
    exported = (await client.get(f"{room.map_url(map_id)}/export", headers=room.master)).json()
    assert exported["color_legend"] == {"red": "Yakuza"}

    imported = await client.post(
        f"/rooms/{room.id}/maps/import", json={"map": exported}, headers=room.master
    )
    assert imported.status_code == 201, imported.text
    assert imported.json()["color_legend"] == {"red": "Yakuza"}

    # No legend in an older file: none on the map.
    del exported["color_legend"]
    plain = await client.post(
        f"/rooms/{room.id}/maps/import", json={"map": exported}, headers=room.master
    )
    assert plain.json()["color_legend"] == {}
    exported["color_legend"] = {"red": "x" * 41}
    too_long = await client.post(
        f"/rooms/{room.id}/maps/import/preview", json={"map": exported}, headers=room.master
    )
    assert too_long.status_code == 422

"""A geographic map as a JSON file (spec 38_3): the import report, importing
a file as a new map, and exporting a map as each viewer sees it."""

import json
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app

SQUARE = [[10, 10], [110, 10], [110, 110], [10, 110]]
EXAMPLE = (
    Path(__file__).resolve().parents[2]
    / "context"
    / "feature"
    / "38 - Geographic maps - example.json"
)


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


async def _member(make_token: Callable[..., str]) -> _Member:
    user_id = str(uuid.uuid4())
    return _Member(id=user_id, headers={"Authorization": f"Bearer {make_token(user_id)}"})


async def _room(client: AsyncClient, make_token: Callable[..., str]) -> _Room:
    master = await _member(make_token)
    room = (await client.post("/rooms", json={"name": "Tokyo"}, headers=master.headers)).json()
    player = await _member(make_token)
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


def _shibuya(**fields: Any) -> dict[str, Any]:
    """A small file in the format of the spec 38 example."""
    file: dict[str, Any] = {
        "schema_version": 1,
        "kind": "geographic_map",
        "name": "Shibuya di notte",
        "description": "Le zone",
        "plane": {"width": 2000, "height": 1400},
        "areas": [
            {"key": "dogen", "document": "Dōgenzaka", "points": SQUARE, "color": "blue"},
            {"key": "park", "name": "Yoyogi", "points": SQUARE, "dashed": True, "note": "Quiete"},
        ],
        "pins": [
            {"key": "elysium", "document": "elysium", "x": 50, "y": 60, "label_side": "left"},
            {"key": "bar", "document": "Bar Senza Nome", "x": 70, "y": 80},
            {"key": "secret", "name": "Rifugio", "x": 90, "y": 90, "master_only": True},
        ],
        "links": [
            {"from": "bar", "to": "elysium", "label": "la finestra della corte", "bend": -80},
            {
                "from": "park",
                "to": "dogen",
                "direction": "both",
                "label": "a",
                "reverse_label": "b",
            },
        ],
        "extra": "ignored",
    }
    file.update(fields)
    return file


async def _preview(client: AsyncClient, room: _Room, member: _Member, file: Any) -> Any:
    return await client.post(
        f"{room.maps_url}/import/preview", json={"map": file}, headers=member.headers
    )


async def _import(client: AsyncClient, room: _Room, member: _Member, **body: Any) -> Any:
    return await client.post(f"{room.maps_url}/import", json=body, headers=member.headers)


async def test_the_preview_reports_what_the_import_will_create(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    await _document(client, room, "Dōgenzaka")
    await _document(client, room, "Elysium")

    response = await _preview(client, room, room.master, _shibuya())

    assert response.status_code == 200, response.text
    assert response.json() == {
        "name": "Shibuya di notte",
        "description": "Le zone",
        "plane_width": 2000,
        "plane_height": 1400,
        "areas": 2,
        "pins": 3,
        "links": 2,
        "matched": 2,
        "not_found": ["Bar Senza Nome"],
        "ambiguous": [],
        "repeated": [],
    }
    # Nothing is written.
    maps = await client.get(room.maps_url, headers=room.master.headers)
    assert maps.json() == []


async def test_importing_creates_a_new_map_owned_by_the_importer(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    dogen = await _document(client, room, "Dōgenzaka")
    elysium = await _document(client, room, "Elysium")

    response = await _import(client, room, room.master, map=_shibuya(), visibility="master")

    assert response.status_code == 201, response.text
    created = response.json()
    assert created["kind"] == "geographic"
    assert (created["name"], created["description"]) == ("Shibuya di notte", "Le zone")
    assert (created["plane_width"], created["plane_height"]) == (2000, 1400)
    assert created["visibility"] == "master"
    assert created["created_by"] == room.master.id
    assert created["document_count"] == 2
    assert [area["document_id"] for area in created["areas"]] == [dogen, None]
    assert created["areas"][1]["note"] == "Quiete"
    pins = {pin["document_id"] or pin["name"]: pin for pin in created["pins"]}
    assert pins[elysium]["label_side"] == "left"
    assert pins["Bar Senza Nome"]["document_id"] is None
    assert pins["Rifugio"]["master_only"] is True
    first, second = created["links"]
    assert first["from_end"] == {"area_id": None, "pin_id": pins["Bar Senza Nome"]["id"]}
    assert (first["label"], first["bend"]) == ("la finestra della corte", -80)
    assert (second["direction"], second["reverse_label"]) == ("both", "b")

    geo = await client.get(f"{room.maps_url}/{created['id']}/geo", headers=room.master.headers)
    assert geo.json()["pins"] == created["pins"]


async def test_the_new_map_takes_its_own_name_and_description(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    renamed = await _import(
        client, room, room.master, map=_shibuya(), name="Shibuya 2", description=""
    )
    assert (renamed.json()["name"], renamed.json()["description"]) == ("Shibuya 2", "")
    blank = await _import(client, room, room.master, map=_shibuya(description=None), name="  ")
    assert (blank.json()["name"], blank.json()["description"]) == ("Shibuya di notte", "")


async def test_a_name_only_matching_a_hidden_document_is_not_found(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    await _document(client, room, "Elysium", visibility="master")
    file = _shibuya(areas=[], links=[], pins=[{"key": "e", "document": "Elysium", "x": 1, "y": 1}])

    preview = await _preview(client, room, room.player, file)
    assert preview.json()["not_found"] == ["Elysium"]
    assert preview.json()["matched"] == 0
    created = (await _import(client, room, room.player, map=file)).json()
    assert created["pins"][0]["document_id"] is None
    assert created["pins"][0]["name"] == "Elysium"
    master_view = await _preview(client, room, room.master, file)
    assert master_view.json()["matched"] == 1


async def test_who_may_import(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    file = _shibuya(pins=[], links=[])
    outsider = await _member(make_token)
    assert (await _preview(client, room, outsider, file)).status_code == 403
    assert (await _import(client, room, outsider, map=file)).status_code == 403
    assert (await _import(client, room, room.player, map=file)).status_code == 201
    # Master-only content is the Master's.
    secret = _shibuya(areas=[], links=[])
    assert (await _import(client, room, room.player, map=secret)).status_code == 403
    await client.patch(
        f"/rooms/{room.id}",
        json={"players_can_create_documents": False},
        headers=room.master.headers,
    )
    assert (await _preview(client, room, room.player, file)).status_code == 403
    assert (await _import(client, room, room.player, map=file)).status_code == 403


async def test_a_file_that_cant_become_a_map_is_refused_with_a_reason(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    headers = {**room.master.headers, "Accept-Language": "en"}
    master = _Member(room.master.id, headers)

    shape = await _preview(client, room, master, _shibuya(plane={"width": "wide"}))
    assert shape.status_code == 422
    assert "plane.width" in shape.json()["detail"]
    empty = await _preview(client, room, master, {})
    assert empty.status_code == 422
    version = await _preview(client, room, master, _shibuya(schema_version=2))
    assert version.status_code == 422
    assert "version 2" in version.json()["detail"]
    plane = await _preview(client, room, master, _shibuya(plane={"width": 10, "height": 10}))
    assert plane.status_code == 422
    unknown = await _preview(client, room, master, _shibuya(links=[{"from": "bar", "to": "nope"}]))
    assert unknown.status_code == 422
    assert '"nope"' in unknown.json()["detail"]
    too_many = _shibuya(
        areas=[], links=[], pins=[{"key": str(i), "name": "P", "x": 1, "y": 1} for i in range(301)]
    )
    assert (await _preview(client, room, master, too_many)).status_code == 409
    long_name = await _import(client, room, master, map=_shibuya(name="x" * 101))
    assert long_name.status_code == 422


async def test_the_map_cap_applies_to_imports(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    for index in range(100):
        await client.post(room.maps_url, json={"name": f"M{index}"}, headers=room.master.headers)
    response = await _import(client, room, room.master, map=_shibuya(pins=[], links=[]))
    assert response.status_code == 409


async def test_an_export_holds_only_what_the_viewer_sees(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    await _document(client, room, "Dōgenzaka")
    await _document(client, room, "Elysium", visibility="master")
    created = (
        await _import(client, room, room.master, map=_shibuya(), name="Shibuya", description="")
    ).json()
    export_url = f"{room.maps_url}/{created['id']}/export"

    master = (await client.get(export_url, headers=room.master.headers)).json()
    assert [pin["key"] for pin in master["pins"]] == ["elysium", "bar-senza-nome", "rifugio"]
    assert master["pins"][0]["document"] == "Elysium"
    assert len(master["links"]) == 2

    player = (await client.get(export_url, headers=room.player.headers)).json()
    assert player["plane"] == {"width": 2000, "height": 1400}
    assert [pin["key"] for pin in player["pins"]] == ["bar-senza-nome"]
    assert "Elysium" not in str(player)
    assert "Rifugio" not in str(player)
    assert [link["from"] for link in player["links"]] == ["yoyogi"]
    view_as = {**room.master.headers, "X-View-As": room.player.id}
    assert (await client.get(export_url, headers=view_as)).json() == player

    # The export imports back as an equivalent map.
    again = (await _preview(client, room, room.master, master)).json()
    assert (again["areas"], again["pins"], again["links"], again["matched"]) == (2, 3, 2, 2)


async def test_only_a_visible_geographic_map_exports(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    free = (
        await client.post(room.maps_url, json={"name": "Lavagna"}, headers=room.master.headers)
    ).json()
    response = await client.get(f"{room.maps_url}/{free['id']}/export", headers=room.master.headers)
    assert response.status_code == 409
    hidden = (
        await _import(
            client, room, room.master, map=_shibuya(pins=[], links=[]), visibility="master"
        )
    ).json()
    response = await client.get(
        f"{room.maps_url}/{hidden['id']}/export", headers=room.player.headers
    )
    assert response.status_code == 404


async def test_the_example_file_of_the_ticket_imports(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    await _document(client, room, "Dōgenzaka")
    example = json.loads(EXAMPLE.read_text(encoding="utf-8"))

    response = await _import(client, room, room.master, map=example)

    assert response.status_code == 201, response.text
    created = response.json()
    assert (len(created["areas"]), len(created["pins"]), len(created["links"])) == (
        len(example["areas"]),
        len(example["pins"]),
        len(example["links"]),
    )
    assert created["document_count"] == 1

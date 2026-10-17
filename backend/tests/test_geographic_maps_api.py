"""Geographic maps (spec 38_1): creating one, reading and saving its areas,
pins and links as each viewer sees them, its plane and its background."""

import io
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import remote_images, storage_cleanup
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


def _png(size: tuple[int, int] = (800, 600)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color=(30, 40, 60)).save(buffer, format="PNG")
    return buffer.getvalue()


async def _member(client: AsyncClient, make_token: Callable[..., str]) -> _Member:
    user_id = str(uuid.uuid4())
    return _Member(id=user_id, headers={"Authorization": f"Bearer {make_token(user_id)}"})


async def _room(client: AsyncClient, make_token: Callable[..., str]) -> _Room:
    master = await _member(client, make_token)
    room = (await client.post("/rooms", json={"name": "Tokyo"}, headers=master.headers)).json()
    player = await _member(client, make_token)
    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations", json={"role": "player"}, headers=master.headers
        )
    ).json()
    await client.post(f"/invitations/{invite['code']}/accept", headers=player.headers)
    return _Room(id=room["id"], master=master, player=player)


async def _document(client: AsyncClient, room: _Room, name: str, **fields: Any) -> str:
    response = await client.post(
        f"/rooms/{room.id}/documents",
        json={"name": name, "visibility": "room", **fields},
        headers=room.master.headers,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _hide(client: AsyncClient, room: _Room, document_id: str) -> None:
    response = await client.patch(
        f"/rooms/{room.id}/documents/{document_id}",
        json={"visibility": "master"},
        headers=room.master.headers,
    )
    assert response.status_code == 200, response.text


async def _geo_map(client: AsyncClient, room: _Room, **fields: Any) -> dict[str, Any]:
    response = await client.post(
        room.maps_url,
        json={"name": "Shibuya di notte", "kind": "geographic", **fields},
        headers=room.master.headers,
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def _id() -> str:
    return str(uuid.uuid4())


def _area(document_id: str | None = None, **fields: Any) -> dict[str, Any]:
    base: dict[str, Any] = {"id": _id(), "points": SQUARE}
    base.update({"document_id": document_id} if document_id else {"name": "Bosco"})
    return {**base, **fields}


def _pin(document_id: str | None = None, **fields: Any) -> dict[str, Any]:
    base: dict[str, Any] = {"id": _id(), "x": 50, "y": 60}
    base.update({"document_id": document_id} if document_id else {"name": "Shibuya 109"})
    return {**base, **fields}


def _link(from_end: dict[str, str], to_end: dict[str, str], **fields: Any) -> dict[str, Any]:
    return {"id": _id(), "from_end": from_end, "to_end": to_end, **fields}


async def _save(client: AsyncClient, room: _Room, map_id: str, editor: _Member, **map_: Any) -> Any:
    return await client.put(f"{room.map_url(map_id)}/geo", json=map_, headers=editor.headers)


async def _get(client: AsyncClient, room: _Room, map_id: str, viewer: _Member) -> dict[str, Any]:
    response = await client.get(f"{room.map_url(map_id)}/geo", headers=viewer.headers)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_creating_a_geographic_map_sets_its_plane(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    default = await _geo_map(client, room)
    assert (default["kind"], default["plane_width"], default["plane_height"]) == (
        "geographic",
        2000,
        1400,
    )
    custom = await _geo_map(client, room, plane_width=2025, plane_height=1852)
    assert (custom["plane_width"], custom["plane_height"]) == (2025, 1852)

    for body in (
        {"name": "x", "kind": "geographic", "plane_width": 50, "plane_height": 500},
        {"name": "x", "kind": "geographic", "plane_width": 500},
        {"name": "x", "plane_width": 500, "plane_height": 500},
    ):
        response = await client.post(room.maps_url, json=body, headers=room.master.headers)
        assert response.status_code == 422, body

    free = (
        await client.post(room.maps_url, json={"name": "Corte"}, headers=room.master.headers)
    ).json()
    assert (free["kind"], free["plane_width"]) == ("free", None)

    # The free-map detail of a geographic map holds no board.
    detail = (await client.get(room.map_url(custom["id"]), headers=room.master.headers)).json()
    assert (detail["cards"], detail["groups"], detail["arrows"]) == ([], [], [])


async def test_each_kind_refuses_the_other_kinds_content(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    geo = await _geo_map(client, room)
    free = (
        await client.post(room.maps_url, json={"name": "Corte"}, headers=room.master.headers)
    ).json()

    board = await client.put(
        f"{room.map_url(geo['id'])}/board", json={}, headers=room.master.headers
    )
    assert board.status_code == 409
    for method, path in (
        ("GET", "/geo"),
        ("PUT", "/geo"),
        ("DELETE", "/background"),
        ("POST", "/background/from-url"),
    ):
        response = await client.request(
            method,
            f"{room.map_url(free['id'])}{path}",
            json={"url": "https://example.com/a.png"} if method == "POST" else {},
            headers=room.master.headers,
        )
        assert response.status_code == 409, (method, path)
    upload = await client.post(
        f"{room.map_url(free['id'])}/background",
        files={"file": ("map.png", _png(), "image/png")},
        headers=room.master.headers,
    )
    assert upload.status_code == 409
    plane = await client.patch(
        room.map_url(free["id"]), json={"plane_width": 900}, headers=room.master.headers
    )
    assert plane.status_code == 409


async def test_the_master_draws_the_map_and_a_player_sees_only_their_part(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    dogenzaka = await _document(client, room, "Dōgenzaka", subtitle="La collina")
    elysium = await _document(client, room, "Elysium di Shibuya")
    sky = await _document(client, room, "Shibuya Sky")
    upload = await client.post(
        f"/rooms/{room.id}/documents/{sky}/images",
        files={"file": ("sky.png", _png(), "image/png")},
        headers=room.master.headers,
    )
    assert upload.status_code == 201
    geo = await _geo_map(client, room)

    zone = _area(dogenzaka, color="blue", dashed=True)
    forest = _area(name=" Meiji Jingū ", note="Di nessuno", color="emerald")
    sky_pin = _pin(sky, label_side="left")
    elysium_pin = _pin(elysium)
    secret = _pin(name="Rifugio", master_only=True)
    window = _link(
        {"pin_id": sky_pin["id"]},
        {"pin_id": elysium_pin["id"]},
        label="la finestra della corte",
        bend=-80,
        color="red",
    )
    to_zone = _link({"area_id": forest["id"]}, {"area_id": zone["id"]}, direction="none")
    response = await _save(
        client,
        room,
        geo["id"],
        room.master,
        areas=[zone, forest],
        pins=[sky_pin, elysium_pin, secret],
        links=[window, to_zone],
    )
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["document_count"] == 3
    areas = {a["id"]: a for a in saved["areas"]}
    assert areas[zone["id"]]["document"]["subtitle"] == "La collina"
    assert areas[zone["id"]]["dashed"] is True
    assert areas[forest["id"]]["name"] == "Meiji Jingū"
    assert areas[forest["id"]]["document"] is None
    pins = {p["id"]: p for p in saved["pins"]}
    assert pins[sky_pin["id"]]["document"]["image"]["url"].startswith("https://signed.test/")
    assert pins[elysium_pin["id"]]["document"]["image"] is None
    assert {link["bend"] for link in saved["links"]} == {-80, None}

    # The list counts the Documents too.
    listed = (await client.get(room.maps_url, headers=room.player.headers)).json()
    assert [(m["kind"], m["document_count"]) for m in listed] == [("geographic", 3)]

    await _hide(client, room, elysium)
    player = await _get(client, room, geo["id"], room.player)
    assert {p["id"] for p in player["pins"]} == {sky_pin["id"]}
    assert [link["id"] for link in player["links"]] == [to_zone["id"]]
    assert player["document_count"] == 2
    assert player["can_edit"] is False
    assert "Elysium" not in str(player)
    listed = (await client.get(room.maps_url, headers=room.player.headers)).json()
    assert listed[0]["document_count"] == 2

    master = await _get(client, room, geo["id"], room.master)
    assert len(master["pins"]) == 3 and len(master["links"]) == 2


async def test_a_players_save_keeps_what_is_hidden_from_them(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    secret_place = await _document(client, room, "Covo")
    geo = await _geo_map(client, room)
    # The player creates their own map and the master then hides a Document on it.
    own = await client.post(
        room.maps_url,
        json={"name": "Mia", "kind": "geographic"},
        headers=room.player.headers,
    )
    assert own.status_code == 201
    own_id = own.json()["id"]
    hidden_pin = _pin(secret_place)
    plain = _pin()
    response = await _save(
        client,
        room,
        own_id,
        room.player,
        pins=[hidden_pin, plain],
        links=[_link({"pin_id": hidden_pin["id"]}, {"pin_id": plain["id"]})],
    )
    assert response.status_code == 200, response.text
    await _hide(client, room, secret_place)

    moved = {**plain, "x": 300}
    response = await _save(client, room, own_id, room.player, pins=[moved])
    assert response.status_code == 200, response.text
    assert [p["x"] for p in response.json()["pins"]] == [300]
    master = await _get(client, room, own_id, room.master)
    assert len(master["pins"]) == 2 and len(master["links"]) == 1

    # Overwriting the hidden pin by its id is refused; the master's map is not theirs.
    forged = await _save(client, room, own_id, room.player, pins=[{**hidden_pin, "x": 1}])
    assert forged.status_code == 422
    foreign = await _save(client, room, geo["id"], room.player, pins=[_pin()])
    assert foreign.status_code == 403


async def test_a_save_maps_every_refusal_to_its_status(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    other_room = await _room(client, make_token)
    foreign_document = await _document(client, other_room, "Altrove")
    geo = await _geo_map(client, room, plane_width=1000, plane_height=800)
    a, b = _pin(), _pin()
    cases: list[tuple[dict[str, Any], int]] = [
        ({"pins": [_pin(foreign_document)]}, 404),
        ({"pins": [_pin(x=5000)]}, 422),
        ({"pins": [{"id": _id(), "x": 1, "y": 1}]}, 422),
        ({"areas": [_area(name="x" * 81)]}, 422),
        ({"pins": [a, b], "links": [_link({"pin_id": a["id"]}, {})]}, 422),
        ({"pins": [_pin() for _ in range(301)]}, 409),
    ]
    for body, expected in cases:
        response = await _save(client, room, geo["id"], room.master, **body)
        assert response.status_code == expected, (body, response.text)
    player_map = (
        await client.post(
            room.maps_url, json={"name": "Mia", "kind": "geographic"}, headers=room.player.headers
        )
    ).json()
    master_only = await _save(
        client, room, player_map["id"], room.player, pins=[_pin(master_only=True)]
    )
    assert master_only.status_code == 403

    # An id already used on another map can't be taken over.
    pin = _pin()
    assert (await _save(client, room, geo["id"], room.master, pins=[pin])).status_code == 200
    second = await _geo_map(client, room)
    taken = await _save(client, room, second["id"], room.master, pins=[pin])
    assert taken.status_code == 422


async def test_the_plane_can_change_unless_it_would_cut_the_map(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    geo = await _geo_map(client, room)
    await _save(client, room, geo["id"], room.master, pins=[_pin(x=1500, y=100)])
    grown = await client.patch(
        room.map_url(geo["id"]), json={"plane_height": 3000}, headers=room.master.headers
    )
    assert grown.status_code == 200, grown.text
    assert (grown.json()["plane_width"], grown.json()["plane_height"]) == (2000, 3000)
    cut = await client.patch(
        room.map_url(geo["id"]), json={"plane_width": 1000}, headers=room.master.headers
    )
    assert cut.status_code == 422
    too_big = await client.patch(
        room.map_url(geo["id"]), json={"plane_width": 30_000}, headers=room.master.headers
    )
    assert too_big.status_code == 422


async def test_a_background_is_uploaded_replaced_imported_and_removed(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    room = await _room(client, make_token)
    geo = await _geo_map(client, room)
    url = f"{room.map_url(geo['id'])}/background"
    assert (await _get(client, room, geo["id"], room.master))["background_url"] is None

    refused = await client.post(
        url, files={"file": ("map.png", _png(), "image/png")}, headers=room.player.headers
    )
    assert refused.status_code == 403
    response = await client.post(
        url,
        files={"file": ("map.png", _png((5000, 4000)), "image/png")},
        headers=room.master.headers,
    )
    assert response.status_code == 200, response.text
    first_url = response.json()["background_url"]
    assert first_url.startswith("https://signed.test/map-backgrounds/")
    [first_path] = list(fake_storage)
    with Image.open(io.BytesIO(fake_storage[first_path])) as stored:
        assert max(stored.size) == 4096
    assert (await _get(client, room, geo["id"], room.player))["background_url"] == first_url

    async def fake_fetch(remote: str) -> bytes:
        return _png()

    monkeypatch.setattr(remote_images, "fetch_image_bytes", fake_fetch)
    imported = await client.post(
        f"{url}/from-url", json={"url": "https://example.com/map.png"}, headers=room.master.headers
    )
    assert imported.status_code == 200, imported.text
    assert first_path not in fake_storage  # the old one goes after commit
    [second_path] = list(fake_storage)

    removed = await client.delete(url, headers=room.master.headers)
    assert removed.status_code == 200
    assert removed.json()["background_url"] is None
    assert second_path not in fake_storage


async def test_deleting_the_map_or_the_room_removes_the_background(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    for _ in range(2):
        geo = await _geo_map(client, room)
        response = await client.post(
            f"{room.map_url(geo['id'])}/background",
            files={"file": ("map.png", _png(), "image/png")},
            headers=room.master.headers,
        )
        assert response.status_code == 200
    first, second = list(fake_storage)
    maps = (await client.get(room.maps_url, headers=room.master.headers)).json()
    deleted = await client.delete(room.map_url(maps[0]["id"]), headers=room.master.headers)
    assert deleted.status_code == 204
    assert len(fake_storage) == 1

    # A path still referenced by a map is never swept away.
    [kept] = list(fake_storage)
    assert kept in await storage_cleanup._referenced(db_session, [first, second])

    gone = await client.delete(f"/rooms/{room.id}", headers=room.master.headers)
    assert gone.status_code == 204
    assert fake_storage == {}


async def test_a_geographic_map_cant_be_linked_to_a_document_yet(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, "Shibuya")
    geo = await _geo_map(client, room)
    response = await client.put(
        f"/rooms/{room.id}/documents/{document_id}/linked-map",
        json={"map_id": geo["id"]},
        headers=room.master.headers,
    )
    assert response.status_code == 409


async def test_a_hidden_geographic_map_is_not_found(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    geo = await _geo_map(client, room, visibility="master")
    response = await client.get(f"{room.map_url(geo['id'])}/geo", headers=room.player.headers)
    assert response.status_code == 404


async def test_an_empty_save_clears_what_the_editor_sees(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    geo = await _geo_map(client, room)
    area, pin = _area(), _pin()
    response = await _save(
        client,
        room,
        geo["id"],
        room.master,
        areas=[area],
        pins=[pin],
        links=[_link({"area_id": area["id"]}, {"pin_id": pin["id"]})],
    )
    assert response.status_code == 200
    cleared = await _save(client, room, geo["id"], room.master)
    assert cleared.status_code == 200
    body = cleared.json()
    assert (body["areas"], body["pins"], body["links"]) == ([], [], [])

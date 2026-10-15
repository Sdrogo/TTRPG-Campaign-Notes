"""Mention maps (spec 36): a Document's live map, computed from the mentions
each viewer sees (Decision 7), with its depth, saved card places, preview
and copy as a free map."""

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


def _headers(make_token: Callable[..., str], user_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(user_id)}"}


@dataclass
class _Room:
    """A Room with a Master and two Players, and its base URL."""

    url: str
    master: dict[str, str]
    player: dict[str, str]
    player_id: str
    other: dict[str, str]


async def _join(
    client: AsyncClient, room_id: str, master: dict[str, str], member: dict[str, str]
) -> None:
    invite = (
        await client.post(f"/rooms/{room_id}/invitations", json={"role": "player"}, headers=master)
    ).json()
    joined = await client.post(f"/invitations/{invite['code']}/accept", headers=member)
    assert joined.status_code in (200, 201)


async def _room(client: AsyncClient, make_token: Callable[..., str]) -> _Room:
    master_id, player_id = str(uuid.uuid4()), str(uuid.uuid4())
    master = _headers(make_token, master_id)
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master)).json()
    player = _headers(make_token, player_id)
    other = _headers(make_token, str(uuid.uuid4()))
    await _join(client, room["id"], master, player)
    await _join(client, room["id"], master, other)
    return _Room(f"/rooms/{room['id']}", master, player, player_id, other)


async def _document(
    client: AsyncClient,
    room: _Room,
    name: str,
    headers: dict[str, str] | None = None,
    **fields: Any,
) -> dict[str, Any]:
    created = await client.post(
        f"{room.url}/documents",
        json={"name": name, "visibility": "room", **fields},
        headers=headers or room.master,
    )
    assert created.status_code == 201, created.text
    document: dict[str, Any] = created.json()
    return document


async def _describe(client: AsyncClient, room: _Room, document: dict[str, Any], text: str) -> None:
    response = await client.patch(
        f"{room.url}/documents/{document['id']}", json={"description": text}, headers=room.master
    )
    assert response.status_code == 200, response.text


def _doc(*documents: dict[str, Any]) -> str:
    return " ".join(f"#[{d['name']}](doc:{d['id']})" for d in documents)


def _url(room: _Room, document: dict[str, Any], path: str = "") -> str:
    return f"{room.url}/documents/{document['id']}/mention-map{path}"


async def _create(
    client: AsyncClient,
    room: _Room,
    document: dict[str, Any],
    headers: dict[str, str] | None = None,
    depth: int = 0,
) -> dict[str, Any]:
    response = await client.post(
        _url(room, document), json={"depth": depth}, headers=headers or room.master
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def _get(
    client: AsyncClient, room: _Room, document: dict[str, Any], headers: dict[str, str]
) -> dict[str, Any]:
    response = await client.get(_url(room, document), headers=headers)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _names(body: dict[str, Any]) -> set[str]:
    return {card["document"]["name"] for card in body["cards"]}


def _relations(body: dict[str, Any]) -> set[tuple[str, str, str]]:
    names = {card["id"]: card["document"]["name"] for card in body["cards"]}
    return {
        (names[a["from_end"]["card_id"]], a["direction"], names[a["to_end"]["card_id"]])
        for a in body["arrows"]
    }


async def _village(client: AsyncClient, room: _Room) -> dict[str, dict[str, Any]]:
    """Mira mentions Thorn and Aldric, the Tavern mentions Mira, Thorn
    mentions Aldric, and Lyra (two steps away) mentions the Tavern."""
    thorn = await _document(client, room, "Thorn")
    aldric = await _document(client, room, "Aldric")
    mira = await _document(client, room, "Mira", description=_doc(thorn, aldric))
    tavern = await _document(client, room, "Tavern", description=_doc(mira))
    await _describe(client, room, thorn, _doc(aldric))
    lyra = await _document(client, room, "Lyra", description=_doc(tavern))
    return {"thorn": thorn, "aldric": aldric, "mira": mira, "tavern": tavern, "lyra": lyra}


async def test_a_mention_map_draws_the_document_and_its_mentions(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    v = await _village(client, room)

    created = await _create(client, room, v["mira"])
    assert created["depth"] == 0
    assert created["can_manage"] is True
    assert created["documents_left_out"] == 0
    assert _names(created) == {"Mira", "Thorn", "Aldric", "Tavern"}
    assert _relations(created) == {
        ("Mira", "forward", "Thorn"),
        ("Mira", "forward", "Aldric"),
        ("Tavern", "forward", "Mira"),
    }
    # Thorn mentions Aldric too, but only the relations with Mira are drawn.
    center = next(c for c in created["cards"] if c["document_id"] == v["mira"]["id"])
    assert center["color"] == "gold"
    # The Tavern mentions Mira: on the left; Thorn is mentioned: on the right.
    tavern = next(c for c in created["cards"] if c["document_id"] == v["tavern"]["id"])
    thorn = next(c for c in created["cards"] if c["document_id"] == v["thorn"]["id"])
    assert tavern["x"] < center["x"] < thorn["x"]

    # A Player who sees every Document sees the same map, without managing it.
    seen = await _get(client, room, v["mira"], room.player)
    assert _relations(seen) == _relations(created)
    assert seen["can_manage"] is False

    # Depth 1 adds Lyra, two steps away.
    deeper = await client.patch(_url(room, v["mira"]), json={"depth": 1}, headers=room.master)
    assert deeper.status_code == 200, deeper.text
    assert deeper.json()["depth"] == 1
    assert _names(deeper.json()) == {"Mira", "Thorn", "Aldric", "Tavern", "Lyra"}
    # Lyra hangs off the Tavern, the card that brought her in.
    assert _relations(deeper.json()) == {
        ("Mira", "forward", "Thorn"),
        ("Mira", "forward", "Aldric"),
        ("Tavern", "forward", "Mira"),
        ("Lyra", "forward", "Tavern"),
    }


async def test_the_map_follows_the_mentions_as_they_change(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    thorn = await _document(client, room, "Thorn")
    mira = await _document(client, room, "Mira", description=_doc(thorn))
    await _create(client, room, mira)

    lyra = await _document(client, room, "Lyra")
    note = await client.post(
        f"{room.url}/documents/{mira['id']}/notes",
        json={"title": "Friends", "description": _doc(lyra)},
        headers=room.master,
    )
    assert note.status_code == 201, note.text
    assert _names(await _get(client, room, mira, room.master)) == {"Mira", "Thorn", "Lyra"}

    # Thorn answers: one two-way relation, not two arrows.
    await _describe(client, room, thorn, _doc(mira))
    assert ("Mira", "both", "Thorn") in _relations(await _get(client, room, mira, room.master))

    await _describe(client, room, mira, "nobody")
    after = await _get(client, room, mira, room.master)
    assert _relations(after) == {("Thorn", "forward", "Mira"), ("Mira", "forward", "Lyra")}


async def test_hidden_mentions_and_documents_never_show(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    thorn = await _document(client, room, "Thorn", visibility="master")
    aldric = await _document(client, room, "Aldric")
    secret_friend = await _document(client, room, "Vex")
    mira = await _document(client, room, "Mira", description=_doc(thorn))
    # Aldric mentions Mira only in a Master-only Note; Vex is linked to the
    # map only through Aldric's hidden Note.
    hidden = await client.post(
        f"{room.url}/documents/{aldric['id']}/notes",
        json={"title": "Secret", "description": _doc(mira, secret_friend), "visibility": "master"},
        headers=room.master,
    )
    assert hidden.status_code == 201, hidden.text
    await _create(client, room, mira, depth=1)

    master = await _get(client, room, mira, room.master)
    assert _names(master) == {"Mira", "Thorn", "Aldric", "Vex"}
    assert ("Aldric", "forward", "Mira") in _relations(master)

    player = await _get(client, room, mira, room.player)
    assert _names(player) == {"Mira"}
    assert player["arrows"] == []

    preview = await client.get(_url(room, mira, "/preview?depth=1"), headers=room.player)
    assert preview.json() == {"documents": 0, "relations": 0, "documents_left_out": 0}
    master_preview = await client.get(_url(room, mira, "/preview?depth=1"), headers=room.master)
    assert master_preview.json() == {"documents": 3, "relations": 3, "documents_left_out": 0}

    # View As shows the Player's map, and refuses writes.
    view_as = {**room.master, "X-View-As": room.player_id}
    assert _names(await _get(client, room, mira, view_as)) == {"Mira"}
    refused = await client.patch(_url(room, mira), json={"depth": 0}, headers=view_as)
    assert refused.status_code == 403


async def test_creating_needs_something_to_map_and_happens_once(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    alone = await _document(client, room, "Alone")
    nothing = await client.post(_url(room, alone), json={"depth": 0}, headers=room.master)
    assert nothing.status_code == 409
    assert (await client.get(_url(room, alone), headers=room.master)).status_code == 404

    v = await _village(client, room)
    await _create(client, room, v["mira"], headers=room.player)
    again = await client.post(_url(room, v["mira"]), json={"depth": 0}, headers=room.master)
    assert again.status_code == 409

    deep = await client.post(_url(room, v["thorn"]), json={"depth": 4}, headers=room.master)
    assert deep.status_code == 422
    preview = await client.get(_url(room, v["thorn"], "/preview?depth=-1"), headers=room.master)
    assert preview.status_code == 422

    # Mention maps stay out of the Maps list, and of the free-map routes.
    assert (await client.get(f"{room.url}/maps", headers=room.master)).json() == []
    mine = await _get(client, room, v["mira"], room.player)
    assert (
        await client.get(f"{room.url}/maps/{mine['id']}", headers=room.master)
    ).status_code == 404


async def test_who_may_create_and_manage(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    v = await _village(client, room)
    outsider = _headers(make_token, str(uuid.uuid4()))
    assert (await client.get(_url(room, v["mira"]), headers=outsider)).status_code == 403
    hidden = await _document(
        client, room, "Hidden", visibility="master", description=_doc(v["mira"])
    )
    assert (await client.get(_url(room, hidden), headers=room.player)).status_code == 404

    await client.patch(room.url, json={"players_can_create_documents": False}, headers=room.master)
    refused = await client.post(_url(room, v["mira"]), json={"depth": 0}, headers=room.player)
    assert refused.status_code == 403
    await client.patch(room.url, json={"players_can_create_documents": True}, headers=room.master)

    await _create(client, room, v["mira"], headers=room.player)
    for request in (
        client.patch(_url(room, v["mira"]), json={"depth": 1}, headers=room.other),
        client.delete(_url(room, v["mira"]), headers=room.other),
        client.put(_url(room, v["mira"], "/cards"), json={"cards": []}, headers=room.other),
        client.post(_url(room, v["mira"], "/copy"), json={"name": "Copy"}, headers=room.other),
    ):
        assert (await request).status_code == 403

    # The Master manages a Player's map too, and deletes it.
    assert (await client.delete(_url(room, v["mira"]), headers=room.master)).status_code == 204
    assert (await client.get(_url(room, v["mira"]), headers=room.player)).status_code == 404

    # Deleting the Document deletes its map.
    await _create(client, room, v["thorn"])
    deleted = await client.delete(f"{room.url}/documents/{v['thorn']['id']}", headers=room.master)
    assert deleted.status_code == 204
    assert (await client.get(_url(room, v["thorn"]), headers=room.master)).status_code == 404


async def test_moved_and_recolored_cards_are_saved_for_everyone(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    v = await _village(client, room)
    await _create(client, room, v["mira"])

    saved = await client.put(
        _url(room, v["mira"], "/cards"),
        json={
            "cards": [
                {"document_id": v["thorn"]["id"], "x": 900, "y": -40, "color": "red"},
                {"document_id": v["thorn"]["id"], "x": 1000, "y": -50, "color": "red"},
            ]
        },
        headers=room.master,
    )
    assert saved.status_code == 200, saved.text
    seen = await _get(client, room, v["mira"], room.player)
    thorn = next(c for c in seen["cards"] if c["document_id"] == v["thorn"]["id"])
    assert (thorn["x"], thorn["y"], thorn["color"]) == (1000, -50, "red")

    off_map = await client.put(
        _url(room, v["mira"], "/cards"),
        json={"cards": [{"document_id": v["lyra"]["id"], "x": 0, "y": 0}]},
        headers=room.master,
    )
    assert off_map.status_code == 404

    # Thorn leaves the map and comes back to the place it was given.
    await _describe(client, room, v["mira"], _doc(v["aldric"]))
    assert "Thorn" not in _names(await _get(client, room, v["mira"], room.master))
    await _describe(client, room, v["mira"], _doc(v["thorn"], v["aldric"]))
    back = await _get(client, room, v["mira"], room.master)
    thorn = next(c for c in back["cards"] if c["document_id"] == v["thorn"]["id"])
    assert (thorn["x"], thorn["y"]) == (1000, -50)


async def test_a_mention_map_copies_into_a_free_map(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    v = await _village(client, room)
    await _create(client, room, v["mira"])

    copied = await client.post(
        _url(room, v["mira"], "/copy"), json={"name": "Mira's circle"}, headers=room.master
    )
    assert copied.status_code == 201, copied.text
    body = copied.json()
    assert body["name"] == "Mira's circle"
    assert _names(body) == {"Mira", "Thorn", "Aldric", "Tavern"}
    assert len(body["arrows"]) == 3
    listed = (await client.get(f"{room.url}/maps", headers=room.master)).json()
    assert [m["name"] for m in listed] == ["Mira's circle"]

    unnamed = await client.post(
        _url(room, v["mira"], "/copy"), json={"name": "  "}, headers=room.master
    )
    assert unnamed.status_code == 422


async def test_a_document_s_mentions_are_added_to_an_existing_free_map(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    v = await _village(client, room)
    created = await client.post(f"{room.url}/maps", json={"name": "Court"}, headers=room.master)
    court = created.json()
    # The board already holds Thorn, a text card and an arrow Mira → Thorn.
    thorn_card, mira_card, note_card = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    saved = await client.put(
        f"{room.url}/maps/{court['id']}/board",
        json={
            "cards": [
                {"id": str(thorn_card), "document_id": v["thorn"]["id"], "x": 500, "y": 40},
                {"id": str(mira_card), "document_id": v["mira"]["id"], "x": 100, "y": 40},
                {"id": str(note_card), "text": "Old feud", "x": 900, "y": 900},
            ],
            "arrows": [
                {
                    "id": str(uuid.uuid4()),
                    "from_end": {"card_id": str(mira_card)},
                    "to_end": {"card_id": str(thorn_card)},
                    "label": "loves",
                }
            ],
        },
        headers=room.master,
    )
    assert saved.status_code == 200, saved.text
    url = _url(room, v["mira"], "/add-to-map")

    added = await client.post(url, json={"map_id": court["id"]}, headers=room.master)
    assert added.status_code == 200, added.text
    body = added.json()
    # Mira and Thorn keep their cards and places, the text card stays, and
    # Aldric and the Tavern join; the drawn relation isn't drawn twice.
    assert sorted(c["document"]["name"] for c in body["cards"] if c["document"]) == [
        "Aldric",
        "Mira",
        "Tavern",
        "Thorn",
    ]
    by_id = {c["id"]: c for c in body["cards"]}
    assert (by_id[str(thorn_card)]["x"], by_id[str(mira_card)]["x"]) == (500, 100)
    assert by_id[str(note_card)]["text"] == "Old feud"
    assert by_id[str(mira_card)]["color"] == "default"
    assert len(body["arrows"]) == 3
    assert [a["label"] for a in body["arrows"] if a["label"]] == ["loves"]
    # The Tavern mentions Mira: laid out around Mira's card, on its left.
    tavern = next(c for c in body["cards"] if c["document_id"] == v["tavern"]["id"])
    assert tavern["x"] < 100
    # No mention map is created for Mira.
    assert (await client.get(_url(room, v["mira"]), headers=room.master)).status_code == 404

    # Again: nothing new to add.
    again = (await client.post(url, json={"map_id": court["id"]}, headers=room.master)).json()
    assert len(again["cards"]) == 5 and len(again["arrows"]) == 3


async def test_adding_to_a_map_needs_mentions_and_a_map_the_user_manages(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    v = await _village(client, room)
    court = (
        await client.post(f"{room.url}/maps", json={"name": "Court"}, headers=room.master)
    ).json()
    url = _url(room, v["mira"], "/add-to-map")

    # A Player may not change the Master's map.
    refused = await client.post(url, json={"map_id": court["id"]}, headers=room.player)
    assert refused.status_code == 403
    # Another Room's map, or none, is not found.
    missing = await client.post(url, json={"map_id": str(uuid.uuid4())}, headers=room.master)
    assert missing.status_code == 404
    # A mention map is not a free map.
    await _create(client, room, v["tavern"])
    tavern_map = await _get(client, room, v["tavern"], room.master)
    mention = await client.post(url, json={"map_id": tavern_map["id"]}, headers=room.master)
    assert mention.status_code == 404
    # Nothing to draw: nothing added.
    loner = await _document(client, room, "Loner")
    empty = await client.post(
        _url(room, loner, "/add-to-map"), json={"map_id": court["id"]}, headers=room.master
    )
    assert empty.status_code == 409

    # Onto an empty board, the map is laid out as the mention map would be.
    added = await client.post(url, json={"map_id": court["id"], "depth": 1}, headers=room.master)
    assert added.status_code == 200, added.text
    body = added.json()
    assert _names(body) == {"Mira", "Thorn", "Aldric", "Tavern", "Lyra"}
    mira = next(c for c in body["cards"] if c["document_id"] == v["mira"]["id"])
    assert (mira["x"], mira["y"], mira["color"]) == (-80, -120, "gold")


async def test_the_map_added_to_is_linked_to_the_document(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    v = await _village(client, room)
    linked = f"{room.url}/documents/{v['mira']['id']}/linked-map"
    assert (await client.get(linked, headers=room.master)).status_code == 404

    court, inn = [
        (await client.post(f"{room.url}/maps", json={"name": name}, headers=room.master)).json()
        for name in ("Court", "Inn")
    ]
    url = _url(room, v["mira"], "/add-to-map")
    await client.post(url, json={"map_id": court["id"]}, headers=room.master)
    shown = await client.get(linked, headers=room.master)
    assert shown.status_code == 200, shown.text
    assert shown.json()["name"] == "Court"
    assert _names(shown.json()) == {"Mira", "Thorn", "Aldric", "Tavern"}

    # Another map replaces it.
    await client.post(url, json={"map_id": inn["id"]}, headers=room.master)
    assert (await client.get(linked, headers=room.master)).json()["name"] == "Inn"

    # A Player sees it as the map shows to them, but may not unlink it.
    assert (await client.get(linked, headers=room.player)).status_code == 200
    assert (await client.delete(linked, headers=room.player)).status_code == 403
    assert (await client.delete(linked, headers=room.master)).status_code == 204
    assert (await client.get(linked, headers=room.master)).status_code == 404
    assert (await client.delete(linked, headers=room.master)).status_code == 404
    # The map itself stays.
    assert (
        await client.get(f"{room.url}/maps/{inn['id']}", headers=room.master)
    ).status_code == 200

    # Deleting the map takes the link with it.
    await client.post(url, json={"map_id": court["id"]}, headers=room.master)
    await client.delete(f"{room.url}/maps/{court['id']}", headers=room.master)
    assert (await client.get(linked, headers=room.master)).status_code == 404


async def test_a_linked_map_hidden_from_the_viewer_is_not_shown(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    v = await _village(client, room)
    secret = (
        await client.post(
            f"{room.url}/maps", json={"name": "Plots", "visibility": "master"}, headers=room.master
        )
    ).json()
    await client.post(
        _url(room, v["mira"], "/add-to-map"), json={"map_id": secret["id"]}, headers=room.master
    )
    linked = f"{room.url}/documents/{v['mira']['id']}/linked-map"
    assert (await client.get(linked, headers=room.master)).status_code == 200
    assert (await client.get(linked, headers=room.player)).status_code == 404


async def test_only_who_manages_the_linked_map_may_replace_it(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    v = await _village(client, room)
    court = (
        await client.post(f"{room.url}/maps", json={"name": "Court"}, headers=room.master)
    ).json()
    mine = (
        await client.post(f"{room.url}/maps", json={"name": "Mine"}, headers=room.player)
    ).json()
    url = _url(room, v["mira"], "/add-to-map")
    linked = f"{room.url}/documents/{v['mira']['id']}/linked-map"
    await client.post(url, json={"map_id": court["id"]}, headers=room.master)

    # The Player may not replace the Master's map, and nothing is added.
    refused = await client.post(url, json={"map_id": mine["id"]}, headers=room.player)
    assert refused.status_code == 403
    assert (await client.get(linked, headers=room.master)).json()["name"] == "Court"
    board = await client.get(f"{room.url}/maps/{mine['id']}", headers=room.player)
    assert board.json()["cards"] == []

    # Once the Master unlinks it, the Player links their own map.
    await client.delete(linked, headers=room.master)
    assert (
        await client.post(url, json={"map_id": mine["id"]}, headers=room.player)
    ).status_code == 200
    assert (await client.get(linked, headers=room.master)).json()["name"] == "Mine"
    # The Master manages every map, so may replace it.
    assert (
        await client.post(url, json={"map_id": court["id"]}, headers=room.master)
    ).status_code == 200

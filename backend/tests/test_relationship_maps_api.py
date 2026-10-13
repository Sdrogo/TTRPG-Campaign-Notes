import io
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import account_repo, relationship_maps_repo, storage
from app.db.models import (
    AuditLogRow,
    RelationshipMapArrowRow,
    RelationshipMapCardRow,
    RelationshipMapGrantRow,
)
from app.domain.models import DocumentVisibility
from app.domain.relationship_maps import MAX_MAPS_PER_ROOM, RelationshipMap
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
    player: _Member  # a Player who creates maps and Documents
    other: _Member  # another Player

    @property
    def maps_url(self) -> str:
        return f"/rooms/{self.id}/maps"

    def map_url(self, map_id: str) -> str:
        return f"/rooms/{self.id}/maps/{map_id}"


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


async def _room(client: AsyncClient, make_token: Callable[..., str]) -> _Room:
    master = await _member(client, make_token, None, None)
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master.headers)).json()
    return _Room(
        id=room["id"],
        master=master,
        player=await _member(client, make_token, room["id"], master),
        other=await _member(client, make_token, room["id"], master),
    )


async def _document(
    client: AsyncClient, room: _Room, name: str, author: _Member | None = None, **fields: Any
) -> str:
    response = await client.post(
        f"/rooms/{room.id}/documents",
        json={"name": name, "visibility": "room", **fields},
        headers=(author or room.master).headers,
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


async def _map(
    client: AsyncClient, room: _Room, author: _Member | None = None, **fields: Any
) -> dict[str, Any]:
    response = await client.post(
        room.maps_url, json={"name": "The Court", **fields}, headers=(author or room.master).headers
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def _id() -> str:
    return str(uuid.uuid4())


def _doc_card(document_id: str, **fields: Any) -> dict[str, Any]:
    return {"id": _id(), "document_id": document_id, "x": 0, "y": 0, **fields}


def _text_card(text: str = "the night of the fire", **fields: Any) -> dict[str, Any]:
    return {"id": _id(), "text": text, "x": 10, "y": 20, **fields}


def _arrow(
    from_id: str, to_id: str, label: str | None = None, *, to_group: bool = False, **fields: Any
) -> dict[str, Any]:
    return {
        "id": _id(),
        "from_end": {"card_id": from_id},
        "to_end": {"group_id": to_id} if to_group else {"card_id": to_id},
        "label": label,
        **fields,
    }


async def _save(
    client: AsyncClient, room: _Room, map_id: str, editor: _Member, **board: Any
) -> Any:
    return await client.put(f"{room.map_url(map_id)}/board", json=board, headers=editor.headers)


async def _get(client: AsyncClient, room: _Room, map_id: str, viewer: _Member) -> dict[str, Any]:
    response = await client.get(room.map_url(map_id), headers=viewer.headers)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _names(body: dict[str, Any]) -> list[str]:
    return sorted(c["document"]["name"] if c["document"] else c["text"] for c in body["cards"])


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (60, 80), color=(120, 40, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


@dataclass
class _Small:
    """The Definition of Done's smaller map: Aldric, Mira, Thorn and a text
    card, "Mira <-> Thorn: ally of" and "Aldric -> Mira: father of" (Master
    only)."""

    map_id: str
    aldric: str
    mira: str
    thorn: str


async def _small_map(client: AsyncClient, room: _Room) -> _Small:
    aldric = await _document(client, room, "Aldric")
    mira = await _document(client, room, "Mira")
    thorn = await _document(client, room, "Thorn")
    relationship_map = await _map(client, room)
    cards = [_doc_card(aldric), _doc_card(mira), _doc_card(thorn), _text_card()]
    arrows = [
        _arrow(
            cards[1]["id"],
            cards[2]["id"],
            "ally of",
            direction="both",
            reverse_label="ally of",
        ),
        _arrow(cards[0]["id"], cards[1]["id"], "father of", master_only=True),
    ]
    response = await _save(
        client, room, relationship_map["id"], room.master, cards=cards, arrows=arrows
    )
    assert response.status_code == 200, response.text
    return _Small(relationship_map["id"], aldric, mira, thorn)


# --- The list and creation ----------------------------------------------------


async def test_a_member_creates_a_map_and_others_see_it_in_the_list(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)

    created = await _map(client, room, room.player, name="  The   Court ", description=" Who ")

    assert created["name"] == "The Court"
    assert created["description"] == "Who"
    assert created["visibility"] == "room"
    assert created["created_by"] == room.player.id
    assert created["can_edit"] is True
    assert created["selective_user_ids"] == []
    assert created["groups"] == created["cards"] == created["arrows"] == []
    listed = (await client.get(room.maps_url, headers=room.other.headers)).json()
    assert [(m["id"], m["can_edit"], m["selective_user_ids"]) for m in listed] == [
        (created["id"], False, None)
    ]
    master_view = (await client.get(room.maps_url, headers=room.master.headers)).json()
    assert master_view[0]["can_edit"] is True


async def test_the_list_counts_only_the_documents_the_viewer_sees(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    small = await _small_map(client, room)
    await _map(client, room, name="Empty")
    await _hide(client, room, small.thorn)

    player = {
        m["name"]: m["document_count"]
        for m in (await client.get(room.maps_url, headers=room.player.headers)).json()
    }
    master = {
        m["name"]: m["document_count"]
        for m in (await client.get(room.maps_url, headers=room.master.headers)).json()
    }

    assert player == {"The Court": 2, "Empty": 0}
    assert master == {"The Court": 3, "Empty": 0}


async def test_a_player_cannot_create_a_map_when_players_cannot_create_documents(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    await client.patch(
        f"/rooms/{room.id}",
        json={"players_can_create_documents": False},
        headers=room.master.headers,
    )

    response = await client.post(room.maps_url, json={"name": "Mine"}, headers=room.player.headers)

    assert response.status_code == 403
    await _map(client, room)


async def test_creating_a_map_checks_its_name_and_description(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    headers = {**room.master.headers, "Accept-Language": "en"}

    blank = await client.post(room.maps_url, json={"name": "  "}, headers=headers)
    long = await client.post(
        room.maps_url, json={"name": "Court", "description": "x" * 1001}, headers=headers
    )

    assert blank.status_code == 422
    assert long.status_code == 422
    assert long.json()["detail"] == "The description can be at most 1000 characters"


async def test_a_selective_map_names_only_members(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)

    outsider = await client.post(
        room.maps_url,
        json={"name": "Court", "visibility": "selective", "selective_user_ids": [_id()]},
        headers=room.master.headers,
    )
    created = await _map(client, room, visibility="selective", selective_user_ids=[room.other.id])
    ignored = await _map(client, room, visibility="room", selective_user_ids=[room.other.id])

    assert outsider.status_code == 422
    assert created["selective_user_ids"] == [room.other.id]
    assert ignored["selective_user_ids"] == []
    # Last edited first.
    assert [
        m["id"] for m in (await client.get(room.maps_url, headers=room.other.headers)).json()
    ] == [
        ignored["id"],
        created["id"],
    ]
    assert [
        m["id"] for m in (await client.get(room.maps_url, headers=room.player.headers)).json()
    ] == [ignored["id"]]


async def test_a_room_holds_at_most_the_maximum_number_of_maps(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    now = datetime.now(UTC)
    for index in range(MAX_MAPS_PER_ROOM):
        await relationship_maps_repo.insert_map(
            db_session,
            RelationshipMap(
                id=uuid.uuid4(),
                room_id=uuid.UUID(room.id),
                name=f"Map {index}",
                description="",
                # Hidden from the Player: the cap counts these too.
                visibility=DocumentVisibility.MASTER,
                created_by=uuid.UUID(room.master.id),
                created_at=now,
                updated_at=now,
            ),
            [],
        )

    response = await client.post(
        room.maps_url, json={"name": "One more"}, headers=room.player.headers
    )

    assert response.status_code == 409


async def test_only_members_reach_the_maps(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    relationship_map = await _map(client, room)
    stranger = await _member(client, make_token, None, None)

    for response in (
        await client.get(room.maps_url, headers=stranger.headers),
        await client.get(room.map_url(relationship_map["id"]), headers=stranger.headers),
        await client.post(room.maps_url, json={"name": "x"}, headers=stranger.headers),
    ):
        assert response.status_code == 403


# --- Reading a map ------------------------------------------------------------


async def test_a_hidden_map_or_one_of_another_room_is_not_found(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    elsewhere = await _room(client, make_token)
    secret = await _map(client, room, visibility="master")
    foreign = await _map(client, elsewhere)

    assert (
        await client.get(room.map_url(secret["id"]), headers=room.player.headers)
    ).status_code == 404
    assert (
        await client.get(room.map_url(foreign["id"]), headers=room.master.headers)
    ).status_code == 404
    assert (await client.get(room.map_url(_id()), headers=room.master.headers)).status_code == 404
    # Visibility comes before permission: a hidden map is 404, not 403.
    patch = await client.patch(
        room.map_url(secret["id"]), json={"name": "x"}, headers=room.player.headers
    )
    assert patch.status_code == 404
    assert (await client.get(room.maps_url, headers=room.player.headers)).json() == []


async def test_a_player_sees_only_what_they_may_see_on_a_map(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    small = await _small_map(client, room)

    master = await _get(client, room, small.map_id, room.master)
    assert _names(master) == ["Aldric", "Mira", "Thorn", "the night of the fire"]
    assert sorted(a["label"] for a in master["arrows"]) == ["ally of", "father of"]

    player = await _get(client, room, small.map_id, room.player)
    assert _names(player) == ["Aldric", "Mira", "Thorn", "the night of the fire"]
    assert [(a["label"], a["reverse_label"]) for a in player["arrows"]] == [("ally of", "ally of")]
    assert player["can_edit"] is False

    await _hide(client, room, small.thorn)
    without_thorn = await _get(client, room, small.map_id, room.player)
    assert _names(without_thorn) == ["Aldric", "Mira", "the night of the fire"]
    assert without_thorn["arrows"] == []
    assert small.thorn not in str(without_thorn)
    assert without_thorn["document_count"] == 2

    # The Master's "View as" shows the map as that Player sees it.
    view_as = await _get(
        client,
        room,
        small.map_id,
        _Member(room.master.id, {**room.master.headers, "X-View-As": room.player.id}),
    )
    assert _names(view_as) == _names(without_thorn)
    assert view_as["arrows"] == []


async def test_master_only_text_cards_and_groups_follow_the_rules(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    hidden = await _document(client, room, "Hidden", visibility="master")
    relationship_map = await _map(client, room)
    titled: dict[str, Any] = {
        "id": _id(),
        "title": "Adversaries and Enemies",
        "x": 0,
        "y": 0,
        "width": 300,
        "height": 200,
    }
    hiding = {"id": _id(), "x": 0, "y": 300, "width": 300, "height": 200}
    secret = _text_card("Unknown Sire", master_only=True, size="large", color="red")
    in_titled = _doc_card(hidden, group_id=titled["id"])
    in_hiding = _doc_card(
        await _document(client, room, "Also hidden", visibility="master"), group_id=hiding["id"]
    )
    public = _text_card("New Ideas", size="title", struck=True)
    response = await _save(
        client,
        room,
        relationship_map["id"],
        room.master,
        groups=[titled, hiding],
        cards=[secret, in_titled, in_hiding, public],
        arrows=[_arrow(public["id"], titled["id"], "watches", to_group=True)],
    )
    assert response.status_code == 200, response.text

    player = await _get(client, room, relationship_map["id"], room.player)

    assert [g["title"] for g in player["groups"]] == ["Adversaries and Enemies"]
    assert [(c["text"], c["size"], c["struck"]) for c in player["cards"]] == [
        ("New Ideas", "title", True)
    ]
    assert [a["to_end"]["group_id"] for a in player["arrows"]] == [titled["id"]]
    master = await _get(client, room, relationship_map["id"], room.master)
    assert len(master["groups"]) == 2
    assert {c["color"] for c in master["cards"]} == {"red", "default"}


async def test_a_document_card_shows_its_name_subtitle_caption_first_image_and_tags(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    room = await _room(client, make_token)
    tag = (
        await client.post(
            f"/rooms/{room.id}/tags",
            json={"name": "Courtier"},
            headers=room.master.headers,
        )
    ).json()
    hoshino = await _document(
        client, room, "Hoshino Mirai", subtitle="La Idol", tag_ids=[tag["id"]]
    )
    plain = await _document(client, room, "Plain")
    upload = await client.post(
        f"/rooms/{room.id}/documents/{hoshino}/images",
        files={"file": ("portrait.png", _png(), "image/png")},
        headers=room.master.headers,
    )
    assert upload.status_code == 201
    relationship_map = await _map(client, room)
    response = await _save(
        client,
        room,
        relationship_map["id"],
        room.master,
        cards=[_doc_card(hoshino, caption=" Neonate \n Former Baron "), _doc_card(plain)],
    )

    cards = {c["document_id"]: c for c in response.json()["cards"]}
    assert cards[hoshino]["caption"] == "Neonate\nFormer Baron"
    document = cards[hoshino]["document"]
    assert document["name"] == "Hoshino Mirai"
    assert document["subtitle"] == "La Idol"
    assert document["tag_ids"] == [tag["id"]]
    assert document["image"]["url"].startswith("https://signed.test/")
    assert cards[plain]["document"]["image"] is None
    assert cards[plain]["document"]["tag_ids"] == []

    # An image Storage can't sign is left out, like everywhere else.
    fake_storage.clear()
    monkeypatch.setattr(storage, "_signed_cache", {})
    unsigned = await _get(client, room, relationship_map["id"], room.master)
    assert all(c["document"]["image"] is None for c in unsigned["cards"])


async def _upload(client: AsyncClient, room: _Room, document_id: str, name: str) -> None:
    response = await client.post(
        f"/rooms/{room.id}/documents/{document_id}/images",
        files={"file": (name, _png(), "image/png")},
        headers=room.master.headers,
    )
    assert response.status_code == 201, response.text


async def _gallery(client: AsyncClient, room: _Room, document_id: str) -> list[dict[str, Any]]:
    response = await client.get(
        f"/rooms/{room.id}/documents/{document_id}", headers=room.master.headers
    )
    images: list[dict[str, Any]] = response.json()["images"]
    return images


async def test_a_card_shows_the_chosen_image_else_the_favorite(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    hoshino = await _document(client, room, "Hoshino Mirai")
    other = await _document(client, room, "Other")
    await _upload(client, room, hoshino, "one.png")
    await _upload(client, room, hoshino, "two.png")
    await _upload(client, room, other, "three.png")
    relationship_map = await _map(client, room)
    card = _doc_card(hoshino)
    gallery = await _gallery(client, room, hoshino)
    favorite = next(image["id"] for image in gallery if image["is_favorite"])
    second = next(image["id"] for image in gallery if not image["is_favorite"])
    foreign = (await _gallery(client, room, other))[0]["id"]

    # No choice: the Document's favorite, and no image_id echoed.
    response = await _save(client, room, relationship_map["id"], room.master, cards=[card])
    assert response.status_code == 200, response.text
    shown = response.json()["cards"][0]
    assert shown["image_id"] is None
    assert shown["document"]["image"]["id"] == favorite

    # A choice among the Document's images is kept, and sent back.
    chosen = {**card, "image_id": second}
    response = await _save(client, room, relationship_map["id"], room.master, cards=[chosen])
    assert response.status_code == 200, response.text
    shown = response.json()["cards"][0]
    assert shown["image_id"] == second
    assert shown["document"]["image"]["id"] == second
    assert (await _get(client, room, relationship_map["id"], room.player))["cards"][0]["document"][
        "image"
    ]["id"] == second

    # Only an image of that card's Document, and one that exists.
    for bad in (foreign, _id()):
        response = await _save(
            client, room, relationship_map["id"], room.master, cards=[{**card, "image_id": bad}]
        )
        assert response.status_code == 404, response.text
    still = await _get(client, room, relationship_map["id"], room.master)
    assert still["cards"][0]["image_id"] == second

    # Deleting the chosen image puts the card back on the favorite.
    deleted = await client.delete(
        f"/rooms/{room.id}/documents/{hoshino}/images/{second}", headers=room.master.headers
    )
    assert deleted.status_code == 204, deleted.text
    back = await _get(client, room, relationship_map["id"], room.master)
    assert back["cards"][0]["image_id"] is None
    assert back["cards"][0]["document"]["image"]["id"] == favorite


# --- Editing ------------------------------------------------------------------


async def test_the_creator_renames_a_map_and_a_visibility_change_is_audited(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    relationship_map = await _map(client, room, room.player)
    url = room.map_url(relationship_map["id"])

    renamed = await client.patch(
        url, json={"name": " Kindred ", "description": "Who"}, headers=room.player.headers
    )
    assert renamed.status_code == 200
    assert (renamed.json()["name"], renamed.json()["description"]) == ("Kindred", "Who")
    unchanged = await client.patch(url, json={}, headers=room.player.headers)
    assert unchanged.json()["name"] == "Kindred"
    assert await _audit_actions(db_session) == []

    selective = await client.patch(
        url,
        json={"visibility": "selective", "selective_user_ids": [room.other.id]},
        headers=room.player.headers,
    )
    assert selective.json()["selective_user_ids"] == [room.other.id]
    assert (await _get(client, room, relationship_map["id"], room.other))[
        "selective_user_ids"
    ] is None
    entries = await _audit_entries(db_session)
    assert len(entries) == 1
    assert entries[0].details["from"] == "room"
    assert entries[0].details["to"] == "selective"
    assert entries[0].details["selective_user_ids"] == [room.other.id]

    await client.patch(url, json={"visibility": "private"}, headers=room.player.headers)
    assert len(await _audit_entries(db_session)) == 2
    assert (await client.get(url, headers=room.other.headers)).status_code == 404


async def _audit_entries(session: AsyncSession) -> list[AuditLogRow]:
    result = await session.execute(
        select(AuditLogRow)
        .where(AuditLogRow.action == "map_visibility_changed")
        .order_by(AuditLogRow.created_at)
    )
    return list(result.scalars())


async def _audit_actions(session: AsyncSession) -> list[str]:
    return [entry.action for entry in await _audit_entries(session)]


async def test_only_the_creator_and_the_master_change_a_map(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    relationship_map = await _map(client, room, room.player)
    url = room.map_url(relationship_map["id"])

    assert (
        await client.patch(url, json={"name": "x"}, headers=room.other.headers)
    ).status_code == 403
    assert (
        await _save(client, room, relationship_map["id"], room.other, cards=[])
    ).status_code == 403
    assert (await client.delete(url, headers=room.other.headers)).status_code == 403
    assert (
        await client.patch(url, json={"name": "By the Master"}, headers=room.master.headers)
    ).status_code == 200


async def test_editing_a_map_checks_its_fields_and_grants(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    url = room.map_url((await _map(client, room))["id"])

    assert (
        await client.patch(url, json={"name": " "}, headers=room.master.headers)
    ).status_code == 422
    outsider = await client.patch(
        url, json={"selective_user_ids": [_id()]}, headers=room.master.headers
    )
    assert outsider.status_code == 422


async def test_deleting_a_map_removes_its_board_but_not_its_documents(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    small = await _small_map(client, room)

    response = await client.delete(room.map_url(small.map_id), headers=room.master.headers)

    assert response.status_code == 204
    assert (
        await client.get(room.map_url(small.map_id), headers=room.master.headers)
    ).status_code == 404
    cards = await db_session.execute(select(RelationshipMapCardRow))
    assert list(cards.scalars()) == []
    document = await client.get(
        f"/rooms/{room.id}/documents/{small.aldric}", headers=room.master.headers
    )
    assert document.status_code == 200


# --- Saving the board ---------------------------------------------------------


async def test_a_dragged_label_keeps_its_place_and_a_place_outside_the_arrow_is_refused(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    relationship_map = await _map(client, room)
    a, b = _text_card("A"), _text_card("B")
    arrow = _arrow(
        a["id"],
        b["id"],
        "ally of",
        direction="both",
        reverse_label="ally of",
        label_position=0.25,
        reverse_label_position=0.9,
    )
    saved = await _save(
        client, room, relationship_map["id"], room.master, cards=[a, b], arrows=[arrow]
    )
    assert saved.status_code == 200, saved.text

    reloaded = await _get(client, room, relationship_map["id"], room.master)
    assert reloaded["arrows"][0]["label_position"] == 0.25
    assert reloaded["arrows"][0]["reverse_label_position"] == 0.9

    # Without it the label goes back to the automatic place.
    plain = {**arrow, "label_position": None, "reverse_label_position": None}
    again = await _save(
        client, room, relationship_map["id"], room.master, cards=[a, b], arrows=[plain]
    )
    assert again.json()["arrows"][0]["label_position"] is None

    refused = await _save(
        client,
        room,
        relationship_map["id"],
        room.master,
        cards=[a, b],
        arrows=[{**arrow, "label_position": 1.5}],
    )
    assert refused.status_code == 422


async def test_reloading_keeps_every_place_group_and_arrow(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    relationship_map = await _map(client, room)
    group = {
        "id": _id(),
        "title": "Court",
        "color": "purple",
        "struck": True,
        "x": 5.5,
        "y": -3,
        "width": 400,
        "height": 250,
    }
    card = _text_card(
        "Eliza Costa\nAnthony Jones", group_id=group["id"], color="green", x=12.25, y=-40
    )
    other = _text_card("Bodyguard")
    arrow = _arrow(card["id"], other["id"], "serves", direction="none", color="blue")
    first = await _save(
        client,
        room,
        relationship_map["id"],
        room.master,
        groups=[group],
        cards=[card, other],
        arrows=[arrow],
    )
    assert first.status_code == 200, first.text

    reloaded = await _get(client, room, relationship_map["id"], room.master)
    assert reloaded["groups"] == [group]
    saved_card = next(c for c in reloaded["cards"] if c["id"] == card["id"])
    assert (saved_card["group_id"], saved_card["x"], saved_card["y"], saved_card["color"]) == (
        group["id"],
        12.25,
        -40,
        "green",
    )
    assert reloaded["arrows"][0]["direction"] == "none"
    assert reloaded["arrows"][0]["color"] == "blue"
    assert reloaded["updated_at"] > relationship_map["updated_at"]

    # Moving a card and dropping the group: the card leaves it and stays.
    moved = {**card, "group_id": None, "x": 99}
    second = await _save(
        client, room, relationship_map["id"], room.master, cards=[moved, other], arrows=[arrow]
    )
    assert second.status_code == 200
    body = second.json()
    assert body["groups"] == []
    assert next(c for c in body["cards"] if c["id"] == card["id"])["x"] == 99
    assert len(body["arrows"]) == 1

    # Taking a Document off and putting it back in one save.
    aldric = await _document(client, room, "Aldric")
    first_card = _doc_card(aldric)
    await _save(client, room, relationship_map["id"], room.master, cards=[first_card])
    again = await _save(
        client, room, relationship_map["id"], room.master, cards=[_doc_card(aldric)]
    )
    assert again.status_code == 200
    assert [c["document_id"] for c in again.json()["cards"]] == [aldric]


async def test_a_players_edit_keeps_the_cards_hidden_from_them(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    aldric = await _document(client, room, "Aldric", room.player)
    mira = await _document(client, room, "Mira", room.player)
    thorn = await _document(client, room, "Thorn", room.player)
    relationship_map = await _map(client, room, room.player)
    cards = [_doc_card(aldric), _doc_card(mira), _doc_card(thorn)]
    arrows = [_arrow(cards[1]["id"], cards[2]["id"], "ally of")]
    saved = await _save(
        client, room, relationship_map["id"], room.player, cards=cards, arrows=arrows
    )
    assert saved.status_code == 200, saved.text
    await _hide(client, room, thorn)

    seen = (await _get(client, room, relationship_map["id"], room.player))["cards"]
    moved = [
        {key: value for key, value in card.items() if key != "document"} | {"x": 500}
        for card in seen
    ]
    response = await _save(client, room, relationship_map["id"], room.player, cards=moved)

    assert response.status_code == 200, response.text
    assert _names(response.json()) == ["Aldric", "Mira"]
    master = await _get(client, room, relationship_map["id"], room.master)
    assert _names(master) == ["Aldric", "Mira", "Thorn"]
    assert [a["label"] for a in master["arrows"]] == ["ally of"]

    # The Player can't take Thorn's card over by its id, nor add Thorn again.
    thorn_card = next(c for c in master["cards"] if c["document_id"] == thorn)
    taken = await _save(
        client,
        room,
        relationship_map["id"],
        room.player,
        cards=[*moved, _text_card(id=thorn_card["id"])],
    )
    assert taken.status_code == 422
    again = await _save(
        client, room, relationship_map["id"], room.player, cards=[*moved, _doc_card(thorn)]
    )
    assert again.status_code == 404


async def test_a_board_refuses_a_document_of_another_room_and_forged_ids(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    elsewhere = await _room(client, make_token)
    foreign_document = await _document(client, elsewhere, "Strahd")
    foreign_map = await _map(client, elsewhere)
    foreign_card = _text_card("theirs")
    await _save(client, elsewhere, foreign_map["id"], elsewhere.master, cards=[foreign_card])
    relationship_map = await _map(client, room)

    other_room = await _save(
        client, room, relationship_map["id"], room.master, cards=[_doc_card(foreign_document)]
    )
    forged = await _save(
        client, room, relationship_map["id"], room.master, cards=[_text_card(id=foreign_card["id"])]
    )

    assert other_room.status_code == 404
    assert forged.status_code == 422
    theirs = await _get(client, elsewhere, foreign_map["id"], elsewhere.master)
    assert [c["text"] for c in theirs["cards"]] == ["theirs"]


async def test_a_board_save_maps_every_refusal_to_its_status(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    relationship_map = await _map(client, room, room.player)
    map_id = relationship_map["id"]
    a, b = _text_card("a"), _text_card("b")

    both_ends = {
        "id": _id(),
        "from_end": {"card_id": a["id"], "group_id": _id()},
        "to_end": {"card_id": b["id"]},
    }
    no_end = {"id": _id(), "from_end": {}, "to_end": {"card_id": b["id"]}}
    assert (
        await _save(client, room, map_id, room.player, cards=[a, b], arrows=[both_ends])
    ).status_code == 422
    assert (
        await _save(client, room, map_id, room.player, cards=[a, b], arrows=[no_end])
    ).status_code == 422
    assert (
        await _save(client, room, map_id, room.player, cards=[_text_card("x" * 301)])
    ).status_code == 422
    secret = await _save(client, room, map_id, room.player, cards=[_text_card(master_only=True)])
    assert secret.status_code == 403
    many = [_text_card(str(i)) for i in range(151)]
    assert (await _save(client, room, map_id, room.player, cards=many)).status_code == 409
    # View as is read only.
    view_as = {**room.master.headers, "X-View-As": room.player.id}
    assert (
        await client.put(f"{room.map_url(map_id)}/board", json={}, headers=view_as)
    ).status_code == 403


async def test_deleting_a_document_removes_its_cards_and_arrows_from_every_map(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    small = await _small_map(client, room)

    response = await client.delete(
        f"/rooms/{room.id}/documents/{small.mira}", headers=room.master.headers
    )

    assert response.status_code == 204
    master = await _get(client, room, small.map_id, room.master)
    assert _names(master) == ["Aldric", "Thorn", "the night of the fire"]
    assert master["arrows"] == []
    arrows = await db_session.execute(select(RelationshipMapArrowRow))
    assert list(arrows.scalars()) == []


async def test_deleting_an_account_erases_its_map_grants(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    await _map(client, room, visibility="selective", selective_user_ids=[room.other.id])

    await account_repo.erase_personal_rows(db_session, uuid.UUID(room.other.id))

    grants = await db_session.execute(
        select(RelationshipMapGrantRow).where(
            RelationshipMapGrantRow.user_id == uuid.UUID(room.other.id)
        )
    )
    assert list(grants.scalars()) == []


async def test_an_empty_room_and_an_empty_board(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    assert (await client.get(room.maps_url, headers=room.player.headers)).json() == []
    relationship_map = await _map(client, room)
    group = {"id": _id(), "x": 0, "y": 0, "width": 100, "height": 100}

    only_group = await _save(client, room, relationship_map["id"], room.master, groups=[group])
    emptied = await _save(client, room, relationship_map["id"], room.master)

    assert [g["id"] for g in only_group.json()["groups"]] == [group["id"]]
    assert emptied.json()["groups"] == []


async def test_updating_a_map_that_is_gone_raises(db_session: AsyncSession) -> None:
    now = datetime.now(UTC)
    gone = RelationshipMap(
        id=uuid.uuid4(),
        room_id=uuid.uuid4(),
        name="Gone",
        description="",
        visibility=DocumentVisibility.ROOM,
        created_by=uuid.uuid4(),
        created_at=now,
        updated_at=now,
    )
    with pytest.raises(LookupError):
        await relationship_maps_repo.update_map(db_session, gone)

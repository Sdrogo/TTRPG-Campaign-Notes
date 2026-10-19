import io
import uuid
from collections.abc import AsyncIterator, Callable
from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    DocumentFileRow,
    DocumentImageRow,
    DocumentLinkedMapRow,
    DocumentMentionRow,
    DocumentOwnerRow,
    DocumentRow,
    DocumentVersionRow,
    MembershipRow,
    NoteRow,
    PostRow,
    RelationshipMapAreaRow,
    RelationshipMapArrowRow,
    RelationshipMapCardRow,
    RelationshipMapGroupRow,
    RelationshipMapLinkRow,
    RelationshipMapPinRow,
    RelationshipMapRow,
    RevealRow,
    RoomRow,
    TagCombinationRow,
    TagRow,
)
from app.domain.mentions import MentionKind, find_mentions, mention_token
from app.main import app

PDF = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (60, 40), color=(120, 40, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _join(
    client: AsyncClient,
    make_token: Callable[..., str],
    room_id: str,
    admin: dict[str, str],
    role: str = "player",
) -> tuple[dict[str, str], str]:
    """A new member of the Room: their headers and user id."""
    invite = (
        await client.post(f"/rooms/{room_id}/invitations", json={"role": role}, headers=admin)
    ).json()
    user_id = str(uuid.uuid4())
    headers = _headers(make_token(user_id))
    await client.post(f"/invitations/{invite['code']}/accept", headers=headers)
    return headers, user_id


async def _post(client: AsyncClient, url: str, headers: dict[str, str], **body: Any) -> Any:
    response = await client.post(url, json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _count(db_session: AsyncSession, model: Any, column: Any, ids: list[uuid.UUID]) -> int:
    result = await db_session.execute(
        select(func.count()).select_from(model).where(column.in_(ids))
    )
    return int(result.scalar_one())


async def test_the_master_duplicates_a_room_with_its_content(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    """Spec 33: setup, Tags, Documents, Notes and images are copied; the
    duplicator is the only member and Owner; Comments, PDFs, Reveals, grants
    and the Character player stay behind; mentions point inside the copy."""
    master = _headers(make_token(str(uuid.uuid4())))
    room = (
        await client.post(
            "/rooms", json={"name": "Tokyo Playtest", "game_system": "Vampire"}, headers=master
        )
    ).json()
    room_id = room["id"]
    player, player_id = await _join(client, make_token, room_id, master)
    await client.patch(
        f"/rooms/{room_id}", json={"players_can_create_documents": False}, headers=master
    )
    tags = (await client.get(f"/rooms/{room_id}/tags", headers=master)).json()
    npc = next(t for t in tags if t["name"] == "NPC")
    docs = f"/rooms/{room_id}/documents"
    gate = await _post(client, docs, master, name="Il Cancello", subtitle="A door")
    ghost = await _post(
        client,
        docs,
        master,
        name="Ghost",
        tag_ids=[npc["id"]],
        visibility="selective",
        selective_user_ids=[player_id],
        description=(
            f"See {mention_token(MentionKind.DOCUMENT, uuid.UUID(gate['id']), 'Il Cancello')}"
            f" and {mention_token(MentionKind.USER, uuid.UUID(player_id), 'Anna')}"
        ),
    )
    await client.patch(
        f"{docs}/{gate['id']}",
        json={"description": mention_token(MentionKind.DOCUMENT, uuid.UUID(ghost["id"]), "Ghost")},
        headers=master,
    )
    await _post(
        client,
        f"{docs}/{ghost['id']}/notes",
        master,
        title="Secret",
        description=mention_token(MentionKind.TAG, uuid.UUID(npc["id"]), "NPC"),
        visibility="selective",
        selective_user_ids=[player_id],
    )
    await client.post(
        f"{docs}/{ghost['id']}/images",
        files={"file": ("a.png", _png(), "image/png")},
        headers=master,
    )
    await client.post(
        f"{docs}/{ghost['id']}/files",
        files={"file": ("rules.pdf", PDF, "application/pdf")},
        headers=master,
    )
    comment = await _post(client, f"{docs}/{ghost['id']}/comments", player, body="Hello")
    await client.post(
        f"{docs}/{ghost['id']}/comments/{comment['id']}/images",
        files={"file": ("b.png", _png(), "image/png")},
        headers=player,
    )
    await client.put(f"{docs}/{ghost['id']}/character", json={"user_id": player_id}, headers=master)

    response = await client.post(f"/rooms/{room_id}/duplicate", headers=master)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["room"]["name"] == "Tokyo Playtest (Copy)"
    assert body["room"]["game_system"] == "Vampire"
    assert body["room"]["players_can_create_documents"] is False
    assert body["role"] == "master" and body["is_admin"] is True
    copy_id = uuid.UUID(body["room"]["id"])
    assert copy_id != uuid.UUID(room_id)

    members = (
        await db_session.scalars(select(MembershipRow).where(MembershipRow.room_id == copy_id))
    ).all()
    assert [(m.role, m.is_admin) for m in members] == [("master", True)]
    copies = {
        d.name: d
        for d in await db_session.scalars(select(DocumentRow).where(DocumentRow.room_id == copy_id))
    }
    assert set(copies) == {"Il Cancello", "Ghost"}
    new_gate, new_ghost = copies["Il Cancello"], copies["Ghost"]
    assert new_gate.subtitle == "A door"
    assert new_ghost.visibility == "private"
    assert new_ghost.played_by is None
    new_tags = {
        t.name: t for t in await db_session.scalars(select(TagRow).where(TagRow.room_id == copy_id))
    }
    assert set(new_tags) == {"NPC", "PC", "Place", "Event", "Artifact"}
    assert new_tags["NPC"].main_position == 0 and new_tags["NPC"].id != uuid.UUID(npc["id"])

    owners = (
        await db_session.scalars(
            select(DocumentOwnerRow.user_id).where(
                DocumentOwnerRow.document_id.in_([new_gate.id, new_ghost.id])
            )
        )
    ).all()
    assert set(owners) == {members[0].user_id}

    # Mentions point inside the copy; the member is plain text.
    ghost_mentions = {(m.kind, m.target_id) for m in find_mentions(new_ghost.description)}
    assert ghost_mentions == {(MentionKind.DOCUMENT, new_gate.id)}
    assert "@Anna" in new_ghost.description
    assert [(m.kind, m.target_id) for m in find_mentions(new_gate.description)] == [
        (MentionKind.DOCUMENT, new_ghost.id)
    ]
    (note,) = await db_session.scalars(select(NoteRow).where(NoteRow.document_id == new_ghost.id))
    assert note.visibility == "private"
    assert [(m.kind, m.target_id) for m in find_mentions(note.description)] == [
        (MentionKind.TAG, new_tags["NPC"].id)
    ]
    backlinks = await db_session.scalars(
        select(DocumentMentionRow).where(
            DocumentMentionRow.source_document_id.in_([new_gate.id, new_ghost.id])
        )
    )
    assert {(b.source_kind, b.target_document_id, b.target_tag_id) for b in backlinks} == {
        ("description", new_gate.id, None),
        ("description", new_ghost.id, None),
        ("note", None, new_tags["NPC"].id),
    }
    assert (
        await _count(
            db_session,
            DocumentVersionRow,
            DocumentVersionRow.document_id,
            [new_gate.id, new_ghost.id],
        )
        == 2
    )

    # Images share the original's objects; nothing else comes along.
    (image,) = await db_session.scalars(
        select(DocumentImageRow).where(DocumentImageRow.document_id == new_ghost.id)
    )
    original = await db_session.scalar(
        select(DocumentImageRow.storage_path).where(
            DocumentImageRow.document_id == uuid.UUID(ghost["id"]),
            DocumentImageRow.post_id.is_(None),
        )
    )
    assert image.storage_path == original
    ids = [new_gate.id, new_ghost.id]
    assert await _count(db_session, DocumentFileRow, DocumentFileRow.document_id, ids) == 0
    assert await _count(db_session, PostRow, PostRow.document_id, ids) == 0
    assert await _count(db_session, RevealRow, RevealRow.room_id, [copy_id]) == 0
    assert len(fake_storage) == 3  # the gallery image, the PDF, the Comment image: no new object

    # The original is untouched.
    assert await _count(db_session, DocumentRow, DocumentRow.room_id, [uuid.UUID(room_id)]) == 2

    # Deleting the original Room leaves the copy's image in Storage and in the copy.
    assert (await client.delete(f"/rooms/{room_id}", headers=master)).status_code == 204
    assert original in fake_storage
    assert await _count(db_session, DocumentImageRow, DocumentImageRow.document_id, ids) == 1


async def test_the_copy_keeps_the_room_image_and_tag_combinations(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    """Decision 3: the Room image and the Main items' combinations come along."""
    master = _headers(make_token(str(uuid.uuid4())))
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master)).json()
    room_id = room["id"]
    uploaded = await client.post(
        f"/rooms/{room_id}/image", files={"file": ("c.png", _png(), "image/png")}, headers=master
    )
    assert uploaded.status_code == 200, uploaded.text
    tags = (await client.get(f"/rooms/{room_id}/tags", headers=master)).json()
    ids = {t["name"]: t["id"] for t in tags}
    main = await client.put(
        f"/rooms/{room_id}/tags/main",
        json={"items": [{"tag_ids": [ids["NPC"], ids["Place"]]}, {"tag_ids": [ids["PC"]]}]},
        headers=master,
    )
    assert main.status_code == 200, main.text

    response = await client.post(f"/rooms/{room_id}/duplicate", headers=master)

    assert response.status_code == 201, response.text
    assert response.json()["room"]["image_url"] is not None
    copy_id = uuid.UUID(response.json()["room"]["id"])
    original_path = await db_session.scalar(
        select(RoomRow.image_path).where(RoomRow.id == uuid.UUID(room_id))
    )
    assert await db_session.scalar(select(RoomRow.image_path).where(RoomRow.id == copy_id)) == (
        original_path
    )
    assert await _count(db_session, TagCombinationRow, TagCombinationRow.room_id, [copy_id]) == 1


async def test_only_the_master_may_duplicate(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 5: a Player and a non-Master Administrator get 403, as does a
    stranger; nothing is created."""
    master = _headers(make_token(str(uuid.uuid4())))
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master)).json()
    room_id = room["id"]
    player, player_id = await _join(client, make_token, room_id, master)
    admin, admin_id = await _join(client, make_token, room_id, master)
    await client.patch(
        f"/rooms/{room_id}/members/{admin_id}", json={"is_admin": True}, headers=master
    )
    stranger = _headers(make_token(str(uuid.uuid4())))

    for headers in (player, admin, stranger):
        response = await client.post(f"/rooms/{room_id}/duplicate", headers=headers)
        assert response.status_code == 403

    count = await db_session.scalar(select(func.count()).select_from(RoomRow))
    assert count == 1


async def test_the_copy_name_follows_the_language_and_stacks(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    """Decision 7: " (Copia)" for an Italian caller; a copy of a copy adds the
    suffix again."""
    master = _headers(make_token(str(uuid.uuid4())))
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master)).json()

    italian = await client.post(
        f"/rooms/{room['id']}/duplicate", headers={**master, "Accept-Language": "it"}
    )
    twice = await client.post(f"/rooms/{room['id']}/duplicate", headers=master)
    again = await client.post(f"/rooms/{twice.json()['room']['id']}/duplicate", headers=master)

    assert italian.json()["room"]["name"] == "Barovia (Copia)"
    assert twice.json()["room"]["name"] == "Barovia (Copy)"
    assert again.json()["room"]["name"] == "Barovia (Copy) (Copy)"


async def test_the_copy_holds_the_maps_pointing_into_it(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    """Spec 40 Decisions 1 to 4: free, geographic and mention maps come along
    with everything on them, re-pointed at the copied Documents and images,
    created by the duplicator, Selective turned Private; a background shares
    its Storage object and outlives the original Room."""
    master = _headers(make_token(str(uuid.uuid4())))
    room = (await client.post("/rooms", json={"name": "Tokyo"}, headers=master)).json()
    room_id = room["id"]
    _, player_id = await _join(client, make_token, room_id, master)
    docs = f"/rooms/{room_id}/documents"
    gate = await _post(client, docs, master, name="Gate")
    ghost = await _post(
        client,
        docs,
        master,
        name="Ghost",
        description=mention_token(MentionKind.DOCUMENT, uuid.UUID(gate["id"]), "Gate"),
    )
    for _ in range(2):
        await client.post(
            f"{docs}/{ghost['id']}/images",
            files={"file": ("a.png", _png(), "image/png")},
            headers=master,
        )
    chosen = await db_session.scalar(
        select(DocumentImageRow.id)
        .where(DocumentImageRow.document_id == uuid.UUID(ghost["id"]))
        .where(DocumentImageRow.is_favorite.is_(False))
    )
    maps = f"/rooms/{room_id}/maps"
    court = await _post(
        client,
        maps,
        master,
        name="Court",
        visibility="selective",
        selective_user_ids=[player_id],
    )
    group, ghost_card, note_card = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    board = await client.put(
        f"{maps}/{court['id']}/board",
        json={
            "groups": [
                {"id": str(group), "title": "Coterie", "x": 0, "y": 0, "width": 400, "height": 300}
            ],
            "cards": [
                {
                    "id": str(ghost_card),
                    "document_id": ghost["id"],
                    "image_id": str(chosen),
                    "group_id": str(group),
                    "x": 10,
                    "y": 10,
                },
                {"id": str(uuid.uuid4()), "document_id": gate["id"], "x": 500, "y": 0},
                {"id": str(note_card), "text": "Secret", "master_only": True, "x": 0, "y": 500},
            ],
            "arrows": [
                {
                    "id": str(uuid.uuid4()),
                    "from_end": {"card_id": str(ghost_card)},
                    "to_end": {"card_id": str(note_card)},
                    "label": "knows",
                },
                {
                    "id": str(uuid.uuid4()),
                    "from_end": {"group_id": str(group)},
                    "to_end": {"card_id": str(note_card)},
                },
            ],
        },
        headers=master,
    )
    assert board.status_code == 200, board.text
    shibuya = await _post(client, maps, master, name="Shibuya", kind="geographic")
    area, pin = uuid.uuid4(), uuid.uuid4()
    geo = await client.put(
        f"{maps}/{shibuya['id']}/geo",
        json={
            "areas": [
                {
                    "id": str(area),
                    "document_id": gate["id"],
                    "points": [[10, 10], [200, 10], [200, 200]],
                }
            ],
            "pins": [{"id": str(pin), "name": "Crossing", "x": 300, "y": 300}],
            "links": [
                {
                    "id": str(uuid.uuid4()),
                    "from_end": {"area_id": str(area)},
                    "to_end": {"pin_id": str(pin)},
                    "bend": 20,
                }
            ],
        },
        headers=master,
    )
    assert geo.status_code == 200, geo.text
    background = await client.post(
        f"{maps}/{shibuya['id']}/background",
        files={"file": ("bg.png", _png(), "image/png")},
        headers=master,
    )
    assert background.status_code == 200, background.text
    mention = await client.post(
        f"{docs}/{ghost['id']}/mention-map", json={"depth": 1}, headers=master
    )
    assert mention.status_code == 201, mention.text
    moved = await client.put(
        f"{docs}/{ghost['id']}/mention-map/cards",
        json={"cards": [{"document_id": gate["id"], "x": 900, "y": 900, "color": "red"}]},
        headers=master,
    )
    assert moved.status_code == 200, moved.text
    linked = await client.put(
        f"{docs}/{gate['id']}/linked-map", json={"map_id": court["id"]}, headers=master
    )
    assert linked.status_code == 200, linked.text
    objects = len(fake_storage)

    response = await client.post(f"/rooms/{room_id}/duplicate", headers=master)

    assert response.status_code == 201, response.text
    copy_id = uuid.UUID(response.json()["room"]["id"])
    copies = {
        d.name: d.id
        for d in await db_session.scalars(select(DocumentRow).where(DocumentRow.room_id == copy_id))
    }
    new_maps = {
        m.name: m
        for m in await db_session.scalars(
            select(RelationshipMapRow).where(RelationshipMapRow.room_id == copy_id)
        )
    }
    assert len(new_maps) == 3 and {"Court", "Shibuya"} <= set(new_maps)
    new_court, new_shibuya = new_maps["Court"], new_maps["Shibuya"]
    duplicator = new_court.created_by
    assert {m.created_by for m in new_maps.values()} == {duplicator}
    assert new_court.visibility == "private"
    (new_mention,) = [m for m in new_maps.values() if m.source_document_id is not None]
    assert new_mention.source_document_id == copies["Ghost"] and new_mention.mention_depth == 1

    cards = {
        c.document_id or c.text: c
        for c in await db_session.scalars(
            select(RelationshipMapCardRow).where(RelationshipMapCardRow.map_id == new_court.id)
        )
    }
    assert set(cards) == {copies["Ghost"], copies["Gate"], "Secret"}
    new_chosen = await db_session.scalar(
        select(DocumentImageRow.id)
        .where(DocumentImageRow.document_id == copies["Ghost"])
        .where(DocumentImageRow.is_favorite.is_(False))
    )
    assert cards[copies["Ghost"]].image_id == new_chosen != chosen
    assert cards["Secret"].master_only is True
    (new_group,) = await db_session.scalars(
        select(RelationshipMapGroupRow).where(RelationshipMapGroupRow.map_id == new_court.id)
    )
    assert cards[copies["Ghost"]].group_id == new_group.id != group
    arrows = (
        await db_session.scalars(
            select(RelationshipMapArrowRow).where(RelationshipMapArrowRow.map_id == new_court.id)
        )
    ).all()
    assert {(a.from_card_id, a.from_group_id, a.to_card_id, a.label) for a in arrows} == {
        (cards[copies["Ghost"]].id, None, cards["Secret"].id, "knows"),
        (None, new_group.id, cards["Secret"].id, None),
    }
    (mention_card,) = await db_session.scalars(
        select(RelationshipMapCardRow).where(RelationshipMapCardRow.map_id == new_mention.id)
    )
    assert (mention_card.document_id, mention_card.x, mention_card.color) == (
        copies["Gate"],
        900,
        "red",
    )
    assert (
        await db_session.scalar(
            select(DocumentLinkedMapRow.map_id).where(
                DocumentLinkedMapRow.document_id == copies["Gate"]
            )
        )
        == new_court.id
    )

    (new_area,) = await db_session.scalars(
        select(RelationshipMapAreaRow).where(RelationshipMapAreaRow.map_id == new_shibuya.id)
    )
    (new_pin,) = await db_session.scalars(
        select(RelationshipMapPinRow).where(RelationshipMapPinRow.map_id == new_shibuya.id)
    )
    (new_link,) = await db_session.scalars(
        select(RelationshipMapLinkRow).where(RelationshipMapLinkRow.map_id == new_shibuya.id)
    )
    assert new_area.document_id == copies["Gate"] and new_area.id != area
    assert (new_link.from_area_id, new_link.to_pin_id, new_link.bend) == (
        new_area.id,
        new_pin.id,
        20,
    )
    original_background = await db_session.scalar(
        select(RelationshipMapRow.background_path).where(
            RelationshipMapRow.id == uuid.UUID(shibuya["id"])
        )
    )
    assert new_shibuya.background_path == original_background is not None
    assert len(fake_storage) == objects  # nothing uploaded

    # The original Room's maps are untouched, and its deletion keeps the copy's background.
    assert (
        await _count(
            db_session, RelationshipMapRow, RelationshipMapRow.room_id, [uuid.UUID(room_id)]
        )
        == 3
    )
    assert (await client.delete(f"/rooms/{room_id}", headers=master)).status_code == 204
    assert original_background in fake_storage

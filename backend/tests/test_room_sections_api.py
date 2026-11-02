"""The Room's landing page (spec 55): the page cards a Room starts with,
the Master's Sections and blocks, their images, what every member reads,
and how Tag deletion, Room copy and Room deletion carry them."""

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

from app.db import remote_images
from app.domain.room_sections import MAX_SECTIONS
from app.main import app
from app.realtime.broker import LANDING, Event, broker


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
    tags: dict[str, str]

    @property
    def url(self) -> str:
        return f"/rooms/{self.id}/sections"


def _member(make_token: Callable[..., str]) -> _Member:
    user_id = str(uuid.uuid4())
    return _Member(
        user_id, {"Authorization": f"Bearer {make_token(user_id)}", "Accept-Language": "en"}
    )


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (400, 300), color=(10, 80, 160)).save(buffer, format="PNG")
    return buffer.getvalue()


async def _room(client: AsyncClient, make_token: Callable[..., str]) -> _Room:
    master, player = _member(make_token), _member(make_token)
    created = await client.post("/rooms", json={"name": "Tokyo"}, headers=master.headers)
    assert created.status_code == 201, created.text
    room_id = created.json()["id"]
    invite = (
        await client.post(
            f"/rooms/{room_id}/invitations", json={"role": "player"}, headers=master.headers
        )
    ).json()
    joined = await client.post(f"/invitations/{invite['code']}/accept", headers=player.headers)
    assert joined.status_code == 200, joined.text
    tags = (await client.get(f"/rooms/{room_id}/tags", headers=master.headers)).json()
    return _Room(room_id, master, player, {t["name"]: t["id"] for t in tags})


async def _custom(client: AsyncClient, room: _Room, title: str = "Tokyo") -> Any:
    response = await client.post(room.url, json={"title": title}, headers=room.master.headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _blocks(client: AsyncClient, room: _Room, section_id: str, *blocks: Any) -> Any:
    response = await client.put(
        f"{room.url}/{section_id}/blocks",
        json={"blocks": list(blocks)},
        headers=room.master.headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_a_new_room_has_the_three_page_cards(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)

    master_view = (await client.get(room.url, headers=room.master.headers)).json()
    player_view = (await client.get(room.url, headers=room.player.headers)).json()

    assert [s["kind"] for s in master_view] == ["page_documents", "page_maps", "page_session_zero"]
    assert {s["title"] for s in master_view} == {None}
    assert {s["can_edit"] for s in master_view} == {True}
    assert {s["can_edit"] for s in player_view} == {False}
    assert [s["id"] for s in player_view] == [s["id"] for s in master_view]


async def test_only_members_read_and_only_the_master_edits(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    outsider = _member(make_token)
    section = await _custom(client, room)
    one = f"{room.url}/{section['id']}"

    assert (await client.get(room.url, headers=outsider.headers)).status_code == 403
    assert (await client.get(one, headers=outsider.headers)).status_code == 403
    player = room.player.headers
    for response in (
        await client.post(room.url, json={"title": "Mine"}, headers=player),
        await client.patch(one, json={"title": "Mine"}, headers=player),
        await client.delete(one, headers=player),
        await client.put(f"{room.url}/order", json={"ids": []}, headers=player),
        await client.put(f"{one}/blocks", json={"blocks": []}, headers=player),
        await client.delete(f"{one}/image", headers=player),
        await client.post(
            f"{one}/image", files={"file": ("a.png", _png(), "image/png")}, headers=player
        ),
    ):
        assert response.status_code == 403
        assert response.json()["detail"] == "Only the Master can edit the landing page"
    # The player reads it like any member.
    read = await client.get(one, headers=player)
    assert (read.status_code, read.json()["title"]) == (200, "Tokyo")


async def test_the_master_adds_renames_and_deletes_sections(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    headers = room.master.headers

    section = await _custom(client, room, "  Tokyo  ")
    assert (section["title"], section["position"], section["kind"]) == ("Tokyo", 3, "custom")
    missing = await client.post(room.url, json={"title": "  "}, headers=headers)
    assert (missing.status_code, missing.json()["detail"]) == (422, "A Section needs a title")

    one = f"{room.url}/{section['id']}"
    renamed = await client.patch(one, json={"description": " Neon "}, headers=headers)
    assert (renamed.json()["title"], renamed.json()["description"]) == ("Tokyo", "Neon")
    renamed = await client.patch(one, json={"title": "Kyoto"}, headers=headers)
    assert (renamed.json()["title"], renamed.json()["description"]) == ("Kyoto", "Neon")
    blank = await client.patch(one, json={"title": ""}, headers=headers)
    assert blank.status_code == 422
    long = await client.patch(one, json={"description": "x" * 2001}, headers=headers)
    assert long.status_code == 422

    assert (await client.delete(one, headers=headers)).status_code == 204
    assert (await client.get(one, headers=headers)).status_code == 404
    gone = await client.patch(one, json={"title": "Back"}, headers=headers)
    assert (gone.status_code, gone.json()["detail"]) == (404, "Section not found")


async def test_page_cards_rename_delete_and_come_back(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    headers = room.master.headers
    documents, maps, _ = (await client.get(room.url, headers=headers)).json()

    named = await client.patch(f"{room.url}/{maps['id']}", json={"title": "Atlas"}, headers=headers)
    assert named.json()["title"] == "Atlas"
    # A blank title gives the page card its default name back.
    reset = await client.patch(f"{room.url}/{maps['id']}", json={"title": " "}, headers=headers)
    assert reset.json()["title"] is None

    refused = await client.delete(f"{room.url}/{documents['id']}", headers=headers)
    assert (refused.status_code, refused.json()["detail"]) == (
        409,
        "The Documents card can't be deleted",
    )
    no_blocks = await client.put(
        f"{room.url}/{maps['id']}/blocks", json={"blocks": []}, headers=headers
    )
    assert no_blocks.status_code == 409

    twice = await client.post(room.url, json={"kind": "page_maps"}, headers=headers)
    assert twice.status_code == 409
    assert (await client.delete(f"{room.url}/{maps['id']}", headers=headers)).status_code == 204
    back = await client.post(room.url, json={"kind": "page_maps"}, headers=headers)
    assert (back.status_code, back.json()["position"], back.json()["title"]) == (201, 3, None)


async def test_a_room_holds_at_most_so_many_sections(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    for i in range(MAX_SECTIONS - 3):
        await _custom(client, room, f"S{i}")

    response = await client.post(room.url, json={"title": "One more"}, headers=room.master.headers)

    assert response.status_code == 422


async def test_the_master_reorders_the_cards(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    await _custom(client, room)
    ids = [s["id"] for s in (await client.get(room.url, headers=room.master.headers)).json()]

    moved = await client.put(
        f"{room.url}/order", json={"ids": ids[::-1]}, headers=room.master.headers
    )

    assert [s["id"] for s in moved.json()] == ids[::-1]
    listed = (await client.get(room.url, headers=room.player.headers)).json()
    assert [s["id"] for s in listed] == ids[::-1]
    wrong = await client.put(
        f"{room.url}/order", json={"ids": ids[:2]}, headers=room.master.headers
    )
    assert (wrong.status_code, wrong.json()["detail"]) == (
        422,
        "List every Section of the Room exactly once",
    )


async def test_the_master_saves_the_blocks_of_a_section(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    section = await _custom(client, room)
    npc, place = room.tags["NPC"], room.tags["Place"]

    saved = await _blocks(
        client,
        room,
        section["id"],
        {"kind": "documents", "heading": "Who", "tag_ids": [npc], "groups": [[place, npc], [npc]]},
        {"kind": "maps", "map_kind": "geographic"},
        {"kind": "session_zero", "features": ["polls", "sessions"]},
    )

    documents, maps, session_zero = saved["blocks"]
    assert (documents["heading"], documents["tag_ids"]) == ("Who", [npc])
    assert sorted(map(sorted, documents["groups"])) == sorted([sorted([npc, place]), [npc]])
    assert (maps["map_kind"], maps["heading"], maps["tag_ids"]) == ("geographic", None, [])
    assert session_zero["features"] == ["polls", "sessions"]
    # Every member reads the same blocks, in order.
    read = (await client.get(f"{room.url}/{section['id']}", headers=room.player.headers)).json()
    assert [b["kind"] for b in read["blocks"]] == ["documents", "maps", "session_zero"]
    assert read["blocks"][0]["groups"] == documents["groups"]
    listed = (await client.get(room.url, headers=room.player.headers)).json()
    assert listed[-1]["blocks"] == read["blocks"]

    # Saving again replaces the whole list.
    again = await _blocks(client, room, section["id"], {"kind": "maps"})
    assert [b["kind"] for b in again["blocks"]] == ["maps"]


async def test_a_block_breaking_a_rule_is_refused(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    other = await _room(client, make_token)
    section = await _custom(client, room)
    url = f"{room.url}/{section['id']}/blocks"

    for block, detail in (
        ({"kind": "documents"}, "A Documents block needs at least one Tag"),
        ({"kind": "session_zero"}, "A Session 0 block needs at least one feature"),
        (
            {"kind": "maps", "tag_ids": [room.tags["NPC"]]},
            "This setting doesn't belong to this kind of block",
        ),
        (
            {"kind": "documents", "tag_ids": [other.tags["NPC"]]},
            "One of the Tags isn't in this Room",
        ),
    ):
        response = await client.put(url, json={"blocks": [block]}, headers=room.master.headers)
        assert (response.status_code, response.json()["detail"]) == (422, detail)


async def test_a_section_card_image_is_uploaded_imported_and_removed(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch(url: str) -> bytes:
        return _png()

    monkeypatch.setattr(remote_images, "fetch_image_bytes", fake_fetch)
    room = await _room(client, make_token)
    section = await _custom(client, room)
    url = f"{room.url}/{section['id']}/image"
    headers = room.master.headers

    uploaded = await client.post(
        url, files={"file": ("a.png", _png(), "image/png")}, headers=headers
    )

    assert uploaded.status_code == 200, uploaded.text
    (first,) = fake_storage
    assert first.startswith(f"rooms/{room.id}/sections/")
    assert uploaded.json()["image_url"] == f"https://signed.test/{first}?token=t"
    listed = (await client.get(room.url, headers=room.player.headers)).json()
    assert listed[-1]["image_url"] == uploaded.json()["image_url"]

    imported = await client.post(
        f"{url}/from-url", json={"url": "https://example.com/a.png"}, headers=headers
    )
    assert imported.status_code == 200
    (second,) = fake_storage
    assert second != first

    removed = await client.delete(url, headers=headers)
    assert (removed.status_code, removed.json()["image_url"]) == (200, None)
    assert fake_storage == {}

    missing = await client.post(
        f"{room.url}/{uuid.uuid4()}/image",
        files={"file": ("a.png", _png(), "image/png")},
        headers=headers,
    )
    assert missing.status_code == 404
    imported_missing = await client.post(
        f"{room.url}/{uuid.uuid4()}/image/from-url",
        json={"url": "https://example.com/a.png"},
        headers=headers,
    )
    assert imported_missing.status_code == 404


async def test_deleting_a_section_or_its_room_removes_its_image(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    headers = room.master.headers
    first, second = await _custom(client, room, "A"), await _custom(client, room, "B")
    for section in (first, second):
        response = await client.post(
            f"{room.url}/{section['id']}/image",
            files={"file": ("a.png", _png(), "image/png")},
            headers=headers,
        )
        assert response.status_code == 200
    assert len(fake_storage) == 2

    await client.delete(f"{room.url}/{first['id']}", headers=headers)
    assert len(fake_storage) == 1

    deleted = await client.delete(f"/rooms/{room.id}", headers=headers)
    assert deleted.status_code == 204, deleted.text
    assert fake_storage == {}


async def test_deleting_a_tag_prunes_the_blocks(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    section = await _custom(client, room)
    npc, place, pc = room.tags["NPC"], room.tags["Place"], room.tags["PC"]
    await _blocks(
        client,
        room,
        section["id"],
        {"kind": "documents", "tag_ids": [place]},
        {"kind": "documents", "tag_ids": [npc, place], "groups": [[place], [pc]]},
        {"kind": "maps"},
    )
    subscription = broker.subscribe(uuid.UUID(room.id), uuid.UUID(room.player.id))
    try:
        response = await client.delete(
            f"/rooms/{room.id}/tags/{place}", headers=room.master.headers
        )
        assert response.status_code == 204
        assert subscription.queue.get_nowait() == Event(None, "changed", None, LANDING)
        # A Tag the landing doesn't use changes nothing there.
        await client.delete(f"/rooms/{room.id}/tags/{pc}", headers=room.master.headers)
    finally:
        broker.unsubscribe(subscription)

    read = (await client.get(f"{room.url}/{section['id']}", headers=room.master.headers)).json()
    documents, maps = read["blocks"]
    assert (documents["tag_ids"], documents["groups"], maps["kind"]) == ([npc], [], "maps")


async def test_writes_tell_the_room(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    subscription = broker.subscribe(uuid.UUID(room.id), uuid.UUID(room.player.id))
    try:
        section = await _custom(client, room)
        await _blocks(client, room, section["id"], {"kind": "maps"})
        events = [subscription.queue.get_nowait() for _ in range(2)]
    finally:
        broker.unsubscribe(subscription)

    assert events == [Event(None, "changed", uuid.UUID(section["id"]), LANDING)] * 2


async def test_a_copied_room_keeps_its_landing(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    headers = room.master.headers
    section = await _custom(client, room)
    await client.post(
        f"{room.url}/{section['id']}/image",
        files={"file": ("a.png", _png(), "image/png")},
        headers=headers,
    )
    npc = room.tags["NPC"]
    await _blocks(
        client, room, section["id"], {"kind": "documents", "tag_ids": [npc], "groups": [[npc]]}
    )

    copied = await client.post(f"/rooms/{room.id}/duplicate", headers=headers)

    assert copied.status_code == 201, copied.text
    copy_id = copied.json()["room"]["id"]
    sections = (await client.get(f"/rooms/{copy_id}/sections", headers=headers)).json()
    copy_tags = (await client.get(f"/rooms/{copy_id}/tags", headers=headers)).json()
    copy_npc = next(t["id"] for t in copy_tags if t["name"] == "NPC")
    assert [s["kind"] for s in sections][-1] == "custom"
    (block,) = sections[-1]["blocks"]
    assert (block["tag_ids"], block["groups"]) == ([copy_npc], [[copy_npc]])
    assert sections[-1]["image_url"] is not None
    assert sections[-1]["id"] != section["id"]

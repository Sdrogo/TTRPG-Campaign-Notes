"""The Room export (spec 23, FR-G1, UC-17): the same Room as JSON and as
Markdown, scoped to what the requester sees (VR-07, NFR-01, Invariant 1)."""

import io
import json
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from PIL import Image
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.export import ExportJson
from app.main import app

PDF = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _headers(make_token: Callable[..., str], user_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(user_id)}"}


@dataclass
class _Room:
    """A Room with a Master and two Players, and its base URL."""

    id: str
    url: str
    master: dict[str, str]
    player: dict[str, str]
    other: dict[str, str]
    player_id: str
    outsider: dict[str, str]


async def _room(
    client: AsyncClient, make_token: Callable[..., str], name: str = "Barovia"
) -> _Room:
    master_id, player_id, other_id, outsider_id = (str(uuid.uuid4()) for _ in range(4))
    master = _headers(make_token, master_id)
    room = (await client.post("/rooms", json={"name": name}, headers=master)).json()
    joined = []
    for user_id in (player_id, other_id):
        invite = (
            await client.post(
                f"/rooms/{room['id']}/invitations", json={"role": "player"}, headers=master
            )
        ).json()
        headers = _headers(make_token, user_id)
        response = await client.post(f"/invitations/{invite['code']}/accept", headers=headers)
        assert response.status_code in (200, 201)
        joined.append(headers)
    return _Room(
        room["id"],
        f"/rooms/{room['id']}",
        master,
        joined[0],
        joined[1],
        player_id,
        _headers(make_token, outsider_id),
    )


async def _post(client: AsyncClient, url: str, headers: dict[str, str], **body: Any) -> Any:
    response = await client.post(url, json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _document(client: AsyncClient, room: _Room, name: str, **fields: Any) -> Any:
    return await _post(client, f"{room.url}/documents", room.master, name=name, **fields)


async def _note(client: AsyncClient, room: _Room, document: Any, title: str, **fields: Any) -> Any:
    return await _post(
        client, f"{room.url}/documents/{document['id']}/notes", room.master, title=title, **fields
    )


async def _comment(
    client: AsyncClient,
    room: _Room,
    document: Any,
    headers: dict[str, str],
    body: str,
    **fields: Any,
) -> Any:
    url = f"{room.url}/documents/{document['id']}/comments"
    return await _post(client, url, headers, body=body, **fields)


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (60, 40), color=(120, 40, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


async def _export(
    client: AsyncClient,
    room: _Room,
    headers: dict[str, str],
    export_format: str = "json",
    **params: Any,
) -> Response:
    return await client.get(
        f"{room.url}/export", params={"format": export_format, **params}, headers=headers
    )


async def _json(
    client: AsyncClient, room: _Room, headers: dict[str, str], **params: Any
) -> dict[str, Any]:
    response = await _export(client, room, headers, "json", **params)
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()
    ExportJson.model_validate(data)
    return data


def _by_name(data: dict[str, Any]) -> dict[str, Any]:
    return {document["name"]: document for document in data["documents"]}


async def _seed(client: AsyncClient, room: _Room) -> dict[str, Any]:
    """A Room with Room-wide and Master-only content of every kind."""
    tags = {
        t["name"]: t for t in (await client.get(f"{room.url}/tags", headers=room.master)).json()
    }
    npc, place = tags["NPC"], tags["Place"]  # seeded with every Room
    castle = await _document(
        client, room, "Castle", description="A dark keep.", tag_ids=[npc["id"], place["id"]]
    )
    lair = await _document(client, room, "Vampire lair", visibility="master", tag_ids=[place["id"]])
    mention = f"#[Lair](doc:{lair['id']}) and #[Castle](doc:{castle['id']})"
    await client.patch(
        f"{room.url}/documents/{castle['id']}",
        json={"description": f"A dark keep. See {mention}"},
        headers=room.master,
    )
    await _note(client, room, castle, "Rumor", description="Heard in town", visibility="room")
    await _note(client, room, castle, "Real truth", description="Strahd lives", visibility="master")
    greeting = await _comment(client, room, castle, room.player, "Hello there")
    secret = await _comment(client, room, castle, room.master, "Beware", visibility="master")
    reply = await _comment(
        client, room, castle, room.master, "Under the secret", parent_id=secret["id"]
    )
    await _comment(client, room, castle, room.other, "A reply", parent_id=greeting["id"])
    await _comment(client, room, lair, room.master, "Only the Master reads this")
    return {
        "npc": npc,
        "place": place,
        "castle": castle,
        "lair": lair,
        "greeting": greeting,
        "secret": secret,
        "reply": reply,
    }


async def test_a_player_and_the_master_export_the_same_room_in_both_formats(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    seeded = await _seed(client, room)

    # Everything the Master sees is in their export.
    master = await _json(client, room, room.master)
    assert set(_by_name(master)) == {"Castle", "Vampire lair"}
    castle = _by_name(master)["Castle"]
    assert [n["title"] for n in castle["notes"]] == ["Rumor", "Real truth"]
    assert len(castle["comments"]) == 4

    # A Player's holds nothing hidden from them, in either format (VR-07).
    player = await _json(client, room, room.player)
    assert set(_by_name(player)) == {"Castle"}
    seen = _by_name(player)["Castle"]
    assert [n["title"] for n in seen["notes"]] == ["Rumor"]
    assert {c["body"][0]["text"] for c in seen["comments"]} == {"Hello there", "A reply"}
    (reply,) = [c for c in seen["comments"] if c["parent_id"] is not None]
    assert reply["parent_id"] == seeded["greeting"]["id"]

    response = await _export(client, room, room.player, "md")
    assert response.status_code == 200, response.text
    markdown = response.text
    for hidden in (
        "Vampire lair",
        "Real truth",
        "Strahd lives",
        "Beware",
        "Under the secret",
        "Only the Master reads this",
        seeded["lair"]["id"],
    ):
        assert hidden not in markdown
        assert hidden not in json.dumps(player)
    for shown in ("Castle", "Rumor", "Heard in town", "Hello there", "A reply"):
        assert shown in markdown

    master_markdown = (await _export(client, room, room.master, "md")).text
    for everything in ("Vampire lair", "Real truth", "Beware", "Under the secret"):
        assert everything in master_markdown


async def test_a_mention_of_a_hidden_document_is_plain_text_in_a_players_export(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    seeded = await _seed(client, room)

    player = await _json(client, room, room.player)

    description = _by_name(player)["Castle"]["description"]
    assert description[0] == {"type": "text", "text": "A dark keep. See #Lair and "}
    assert description[1] == {
        "type": "mention",
        "kind": "doc",
        "target_id": seeded["castle"]["id"],
        "name": "Castle",
    }
    master = _by_name(await _json(client, room, room.master))["Castle"]["description"]
    assert master[1]["target_id"] == seeded["lair"]["id"]

    markdown = (await _export(client, room, room.player, "md")).text
    assert f"[Castle](#doc-{seeded['castle']['id']})" in markdown
    assert "#Lair" in markdown


async def test_the_json_names_who_is_let_in_only_to_those_who_manage_the_content(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document = await _document(
        client, room, "Shared", visibility="selective", selective_user_ids=[room.player_id]
    )
    await _comment(client, room, document, room.master, "Hi")

    as_master = _by_name(await _json(client, room, room.master))["Shared"]
    as_player = _by_name(await _json(client, room, room.player))["Shared"]

    assert as_master["selective_user_ids"] == [room.player_id]
    assert as_player["visibility"] == "selective"
    assert as_player["selective_user_ids"] is None


async def test_the_tag_filter_keeps_documents_with_all_the_tags(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    seeded = await _seed(client, room)
    npc, place = seeded["npc"]["id"], seeded["place"]["id"]

    both = await _json(client, room, room.master, tag=[npc, place])
    assert set(_by_name(both)) == {"Castle"}
    assert both["tag_filter"] == [npc, place]
    assert both["tags"] and both["members"], "the Room's Tags and members are still listed"

    one = await _json(client, room, room.master, tag=[place])
    assert set(_by_name(one)) == {"Castle", "Vampire lair"}

    # A filter never widens what a Player sees (the lair is Master only).
    as_player = await _json(client, room, room.player, tag=[place])
    assert set(_by_name(as_player)) == {"Castle"}

    markdown = (await _export(client, room, room.master, "md", tag=[npc])).text
    assert "Only Documents tagged: NPC" in markdown
    assert "## NPC" in markdown

    whole = await _json(client, room, room.master)
    assert whole["tag_filter"] is None

    # A mention of a Document the filter left out is plain text in Markdown.
    filtered = (await _export(client, room, room.master, "md", tag=[npc])).text
    assert f"[Castle](#doc-{seeded['castle']['id']})" in filtered
    assert f"(#doc-{seeded['lair']['id']})" not in filtered


async def test_a_tag_of_another_room_is_a_404(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    other = await _room(client, make_token, "Elsewhere")
    foreign = await _post(client, f"{other.url}/tags", other.master, name="Foreign")

    response = await _export(client, room, room.master, tag=[foreign["id"]])

    assert response.status_code == 404


async def test_only_members_export_and_the_format_must_be_known(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)

    assert (await _export(client, room, room.outsider)).status_code == 403
    assert (await _export(client, room, room.player, "pdf")).status_code == 422
    assert (await client.get(f"{room.url}/export")).status_code in (401, 403)


async def test_the_file_is_an_attachment_named_after_the_room_and_the_date(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token, "La Città di Barovia")

    as_json = await _export(client, room, room.master, "json")
    as_markdown = await _export(client, room, room.master, "md")

    assert as_json.headers["content-type"] == "application/json"
    assert as_markdown.headers["content-type"] == "text/markdown; charset=utf-8"
    for response, extension in ((as_json, "json"), (as_markdown, "md")):
        disposition = response.headers["content-disposition"]
        assert disposition.startswith('attachment; filename="la-citta-di-barovia-')
        assert disposition.endswith(f'.{extension}"')
    # The default format is JSON.
    default = await client.get(f"{room.url}/export", headers=room.master)
    assert default.headers["content-type"] == "application/json"


async def test_the_ids_are_the_same_in_two_exports(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    await _seed(client, room)

    first = await _json(client, room, room.player)
    second = await _json(client, room, room.player)

    first.pop("generated_at")
    second.pop("generated_at")
    assert first == second


async def test_images_and_files_are_signed_links_filtered_like_the_api(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document = await _document(client, room, "Gallery")
    upload = await client.post(
        f"{room.url}/documents/{document['id']}/images",
        files={"file": ("a.png", _png(), "image/png")},
        headers=room.master,
    )
    assert upload.status_code == 201, upload.text
    pdf = await client.post(
        f"{room.url}/documents/{document['id']}/files",
        files={"file": ("Sheet.pdf", PDF, "application/pdf")},
        headers=room.master,
    )
    assert pdf.status_code == 201, pdf.text
    public = await _comment(client, room, document, room.master, "Look")
    secret = await _comment(client, room, document, room.master, "Shh", visibility="master")
    for comment in (public, secret):
        attached = await client.post(
            f"{room.url}/documents/{document['id']}/comments/{comment['id']}/images",
            files={"file": ("c.png", _png(), "image/png")},
            headers=room.master,
        )
        assert attached.status_code == 201, attached.text

    as_player = _by_name(await _json(client, room, room.player))["Gallery"]
    as_master = _by_name(await _json(client, room, room.master))["Gallery"]

    (image,) = as_player["images"]
    assert image["url"].startswith("https://signed.test/")
    assert image["is_favorite"] is True
    (file,) = as_player["files"]
    assert file["name"] == "Sheet.pdf"
    assert file["url"].endswith("&download=Sheet.pdf")
    # A Comment's attachment follows the Comment (Invariant 1).
    assert [len(c["images"]) for c in as_player["comments"]] == [1]
    assert [len(c["images"]) for c in as_master["comments"]] == [1, 1]
    assert len(fake_storage) == 4

    markdown = (await _export(client, room, room.player, "md")).text
    assert f"![image]({image['url']})" in markdown
    assert f"[Sheet.pdf]({file['url']})" in markdown
    secret_urls = [c["images"][0]["url"] for c in as_master["comments"] if c["id"] == secret["id"]]
    assert secret_urls[0] not in markdown


async def test_a_comment_written_as_a_character_is_named_only_when_it_is_visible(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    irena = await _document(client, room, "Irena")
    document = await _document(client, room, "Tavern")
    await client.put(
        f"{room.url}/documents/{irena['id']}/player",
        json={"user_id": room.player_id},
        headers=room.master,
    )
    comment = await _comment(
        client, room, document, room.player, "Greetings", as_document_id=irena["id"]
    )

    visible = _by_name(await _json(client, room, room.other))["Tavern"]["comments"][0]
    assert visible["as_character_id"] == irena["id"]
    assert visible["author_id"] == room.player_id
    assert "Irena (played by" in (await _export(client, room, room.other, "md")).text

    # Hide the Character: the Comment is still there, as its real author.
    await client.patch(
        f"{room.url}/documents/{irena['id']}", json={"visibility": "master"}, headers=room.master
    )
    hidden = _by_name(await _json(client, room, room.other))["Tavern"]["comments"][0]
    assert hidden["id"] == comment["id"]
    assert hidden["as_character_id"] is None
    assert "Irena" not in (await _export(client, room, room.other, "md")).text


async def test_the_master_can_export_as_a_player(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    # Spec 22b: the preview follows `X-View-As`, so what the Master exports
    # "as player X" is exactly that Player's export.
    room = await _room(client, make_token)
    await _seed(client, room)

    as_player = await _json(client, room, {**room.master, "X-View-As": room.player_id})

    assert set(_by_name(as_player)) == {"Castle"}
    assert [n["title"] for n in _by_name(as_player)["Castle"]["notes"]] == ["Rumor"]


async def test_no_email_invitation_or_audit_data_is_exported(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    master_id = str(uuid.uuid4())
    master = {"Authorization": f"Bearer {make_token(master_id, email='gm@example.com')}"}
    room = (await client.post("/rooms", json={"name": "Private"}, headers=master)).json()
    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations", json={"role": "player"}, headers=master
        )
    ).json()
    await client.post(
        f"/rooms/{room['id']}/documents",
        json={"name": "Doc", "visibility": "master"},
        headers=master,
    )

    response = await client.get(f"/rooms/{room['id']}/export", headers=master)
    markdown = await client.get(f"/rooms/{room['id']}/export?format=md", headers=master)

    for text in (response.text, markdown.text):
        assert "gm@example.com" not in text
        assert invite["code"] not in text
        assert "audit" not in text.lower()


async def test_the_number_of_queries_does_not_grow_with_the_documents(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)

    async def count_queries() -> int:
        statements: list[str] = []

        def record(*args: Any) -> None:
            statements.append(str(args[2]))

        bind = db_session.sync_session.get_bind()
        event.listen(bind, "before_cursor_execute", record)
        try:
            response = await _export(client, room, room.master)
        finally:
            event.remove(bind, "before_cursor_execute", record)
        assert response.status_code == 200
        return len(statements)

    first = await _document(client, room, "One")
    await _note(client, room, first, "N")
    await _comment(client, room, first, room.player, "c")
    small = await count_queries()

    for index in range(5):
        document = await _document(client, room, f"More {index}")
        await _note(client, room, document, "N")
        top = await _comment(client, room, document, room.player, "c")
        await _comment(client, room, document, room.master, "r", parent_id=top["id"])

    assert await count_queries() == small

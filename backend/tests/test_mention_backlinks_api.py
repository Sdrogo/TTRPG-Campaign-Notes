"""Document and Tag mentions (spec 20): tokens cleaned on save, backlinks
indexed from descriptions, Notes and Comments, and the "Mentioned in" lists
filtered per viewer (VR-07)."""

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
    """A Room with a Master and a Player, and its base URL."""

    url: str
    master: dict[str, str]
    player: dict[str, str]
    player_id: str


async def _room(client: AsyncClient, make_token: Callable[..., str]) -> _Room:
    master_id, player_id = str(uuid.uuid4()), str(uuid.uuid4())
    master = _headers(make_token, master_id)
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master)).json()
    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations", json={"role": "player"}, headers=master
        )
    ).json()
    player = _headers(make_token, player_id)
    joined = await client.post(f"/invitations/{invite['code']}/accept", headers=player)
    assert joined.status_code in (200, 201)
    return _Room(f"/rooms/{room['id']}", master, player, player_id)


async def _document(
    client: AsyncClient, room: _Room, name: str, headers: dict[str, str], **fields: Any
) -> dict[str, Any]:
    created = await client.post(
        f"{room.url}/documents", json={"name": name, **fields}, headers=headers
    )
    assert created.status_code == 201, created.text
    document: dict[str, Any] = created.json()
    return document


def _doc(document: dict[str, Any], name: str | None = None) -> str:
    return f"#[{name or document['name']}](doc:{document['id']})"


async def _backlinks(
    client: AsyncClient, room: _Room, document: dict[str, Any], headers: dict[str, str]
) -> list[dict[str, Any]]:
    response = await client.get(f"{room.url}/documents/{document['id']}/backlinks", headers=headers)
    assert response.status_code == 200, response.text
    groups: list[dict[str, Any]] = response.json()
    return groups


def _kinds(groups: list[dict[str, Any]]) -> list[tuple[str, list[str]]]:
    return [(g["document_name"], [m["kind"] for m in g["mentions"]]) for g in groups]


async def test_a_document_lists_where_it_is_mentioned_and_survives_a_rename(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    tower = await _document(client, room, "Tower", room.master)
    castle = await _document(
        client, room, "Castle", room.master, description=f"North of {_doc(tower)}."
    )
    notes = f"{room.url}/documents/{castle['id']}/notes"
    note = (
        await client.post(
            notes, json={"title": "Rumours", "description": f"{_doc(tower)}!"}, headers=room.master
        )
    ).json()
    comments = f"{room.url}/documents/{castle['id']}/comments"
    comment = (
        await client.post(
            comments, json={"body": f"I saw {_doc(tower, 'the tower')}"}, headers=room.player
        )
    ).json()

    renamed = await client.patch(
        f"{room.url}/documents/{tower['id']}", json={"name": "Spire"}, headers=room.master
    )
    assert renamed.status_code == 200

    groups = await _backlinks(client, room, tower, room.player)
    assert groups == [
        {
            "document_id": castle["id"],
            "document_name": "Castle",
            "mentions": [
                {
                    "kind": "description",
                    "note_id": None,
                    "note_title": None,
                    "comment_id": None,
                    "comment_author_id": None,
                    "excerpt": "North of #Tower.",
                },
                {
                    "kind": "note",
                    "note_id": note["id"],
                    "note_title": "Rumours",
                    "comment_id": None,
                    "comment_author_id": None,
                    "excerpt": "#Tower!",
                },
                {
                    "kind": "comment",
                    "note_id": None,
                    "note_title": None,
                    "comment_id": comment["id"],
                    "comment_author_id": room.player_id,
                    "excerpt": "I saw #the tower",
                },
            ],
        }
    ]


async def test_groups_are_ordered_by_document_and_comments_by_age(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    tower = await _document(client, room, "Tower", room.master)
    await _document(client, room, "Zeta", room.master, description=_doc(tower))
    alpha = await _document(client, room, "alpha", room.master)
    comments = f"{room.url}/documents/{alpha['id']}/comments"
    for body in ("first", "second"):
        await client.post(comments, json={"body": f"{body} {_doc(tower)}"}, headers=room.master)
    # A Document mentioning itself is no backlink.
    await client.patch(
        f"{room.url}/documents/{tower['id']}",
        json={"description": f"I am {_doc(tower)}"},
        headers=room.master,
    )

    groups = await _backlinks(client, room, tower, room.master)

    assert _kinds(groups) == [("alpha", ["comment", "comment"]), ("Zeta", ["description"])]
    assert [m["excerpt"] for m in groups[0]["mentions"]] == ["first #Tower", "second #Tower"]


async def test_a_player_sees_only_the_backlinks_they_could_read(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    tower = await _document(client, room, "Tower", room.master)
    castle = await _document(client, room, "Castle", room.master, description=_doc(tower))
    await _document(
        client, room, "Secret", room.master, description=_doc(tower), visibility="private"
    )
    await client.post(
        f"{room.url}/documents/{castle['id']}/notes",
        json={"title": "Hidden", "description": _doc(tower), "visibility": "private"},
        headers=room.master,
    )
    comments = f"{room.url}/documents/{castle['id']}/comments"
    parent = (await client.post(comments, json={"body": _doc(tower)}, headers=room.master)).json()
    await client.post(
        comments, json={"body": _doc(tower), "parent_id": parent["id"]}, headers=room.master
    )
    # Narrowed after the reply: the reply, open to the Room on its own, is
    # hidden with its parent.
    narrowed = await client.patch(
        f"{comments}/{parent['id']}", json={"visibility": "master"}, headers=room.master
    )
    assert narrowed.status_code == 200, narrowed.text

    assert _kinds(await _backlinks(client, room, tower, room.player)) == [
        ("Castle", ["description"])
    ]
    assert _kinds(await _backlinks(client, room, tower, room.master)) == [
        ("Castle", ["description", "note", "comment", "comment"]),
        ("Secret", ["description"]),
    ]


async def test_a_hidden_document_has_no_backlinks_to_show(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    secret = await _document(client, room, "Secret", room.master, visibility="private")

    response = await client.get(
        f"{room.url}/documents/{secret['id']}/backlinks", headers=room.player
    )

    assert response.status_code == 404


async def test_forged_and_foreign_ids_are_saved_as_plain_text(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    other = await _room(client, make_token)
    foreign = await _document(client, other, "Elsewhere", other.master)
    foreign_tag = (
        await client.post(f"{other.url}/tags", json={"name": "Far"}, headers=other.master)
    ).json()
    ghost = uuid.uuid4()
    text = (
        f"{_doc(foreign)} #[Ghost](doc:{ghost}) #[Far](tag:{foreign_tag['id']}) "
        f"#[Nope](tag:{ghost}) plain #Text"
    )

    created = await _document(client, room, "Castle", room.master, description=text)

    assert created["description"] == "#Elsewhere #Ghost #Far #Nope plain #Text"


async def test_a_writer_cannot_link_what_they_cannot_see_but_keeps_existing_links(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    secret = await _document(client, room, "Secret", room.master, visibility="private")
    mine = await _document(client, room, "Mine", room.player)
    url = f"{room.url}/documents/{mine['id']}"

    # The Master may link it in the Player's Document...
    linked = await client.patch(
        url, json={"description": f"See {_doc(secret)}"}, headers=room.master
    )
    assert linked.json()["description"] == f"See {_doc(secret)}"
    # ...and the Player's edit keeps that link, though they can't see it.
    kept = await client.patch(
        url, json={"description": f"See {_doc(secret)} again"}, headers=room.player
    )
    assert kept.json()["description"] == f"See {_doc(secret)} again"
    # A new link to it from the Player is only text.
    other = await _document(client, room, "Other", room.player, description=_doc(secret))
    assert other["description"] == "#Secret"
    assert _kinds(await _backlinks(client, room, secret, room.master)) == [
        ("Mine", ["description"])
    ]


async def test_saving_a_source_rewrites_its_backlinks(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    tower = await _document(client, room, "Tower", room.master)
    castle = await _document(client, room, "Castle", room.master, description=_doc(tower))
    doc_url = f"{room.url}/documents/{castle['id']}"
    note = (
        await client.post(
            f"{doc_url}/notes", json={"title": "N", "description": _doc(tower)}, headers=room.master
        )
    ).json()
    comment = (
        await client.post(f"{doc_url}/comments", json={"body": _doc(tower)}, headers=room.master)
    ).json()

    # Edits that leave the text alone keep the rows.
    await client.patch(doc_url, json={"name": "Keep"}, headers=room.master)
    await client.patch(f"{doc_url}/notes/{note['id']}", json={"title": "M"}, headers=room.master)
    await client.patch(
        f"{doc_url}/comments/{comment['id']}", json={"visibility": "room"}, headers=room.master
    )
    assert _kinds(await _backlinks(client, room, tower, room.master)) == [
        ("Keep", ["description", "note", "comment"])
    ]

    await client.patch(doc_url, json={"description": "gone"}, headers=room.master)
    await client.patch(
        f"{doc_url}/notes/{note['id']}", json={"description": "gone"}, headers=room.master
    )
    await client.patch(
        f"{doc_url}/comments/{comment['id']}", json={"body": "gone"}, headers=room.master
    )
    assert await _backlinks(client, room, tower, room.master) == []


async def test_deleting_a_source_removes_its_backlinks(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    tower = await _document(client, room, "Tower", room.master)
    castle = await _document(client, room, "Castle", room.master)
    doc_url = f"{room.url}/documents/{castle['id']}"
    note = (
        await client.post(
            f"{doc_url}/notes", json={"title": "N", "description": _doc(tower)}, headers=room.master
        )
    ).json()
    comment = (
        await client.post(f"{doc_url}/comments", json={"body": _doc(tower)}, headers=room.master)
    ).json()
    village = await _document(client, room, "Village", room.master, description=_doc(tower))

    await client.delete(f"{doc_url}/notes/{note['id']}", headers=room.master)
    await client.delete(f"{doc_url}/comments/{comment['id']}", headers=room.master)
    assert _kinds(await _backlinks(client, room, tower, room.master)) == [
        ("Village", ["description"])
    ]
    await client.delete(f"{room.url}/documents/{village['id']}", headers=room.master)
    assert await _backlinks(client, room, tower, room.master) == []


async def test_a_tag_lists_where_it_is_mentioned_until_it_is_deleted(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    tag = (
        await client.post(f"{room.url}/tags", json={"name": "Faction"}, headers=room.master)
    ).json()
    mention = f"#[Faction](tag:{tag['id']})"
    await _document(client, room, "Open", room.master, description=f"An {mention}")
    await _document(client, room, "Secret", room.master, description=mention, visibility="private")
    url = f"{room.url}/tags/{tag['id']}/backlinks"

    as_player = await client.get(url, headers=room.player)
    as_master = await client.get(url, headers=room.master)

    assert _kinds(as_player.json()) == [("Open", ["description"])]
    assert as_player.json()[0]["mentions"][0]["excerpt"] == "An #Faction"
    assert _kinds(as_master.json()) == [("Open", ["description"]), ("Secret", ["description"])]
    deleted = await client.delete(f"{room.url}/tags/{tag['id']}", headers=room.master)
    assert deleted.status_code == 204
    assert (await client.get(url, headers=room.master)).status_code == 404


async def test_backlinks_are_for_members_only(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    tower = await _document(client, room, "Tower", room.master)
    stranger = _headers(make_token, str(uuid.uuid4()))

    document = await client.get(f"{room.url}/documents/{tower['id']}/backlinks", headers=stranger)
    tag = await client.get(f"{room.url}/tags/{uuid.uuid4()}/backlinks", headers=stranger)

    assert document.status_code == 403
    assert tag.status_code == 403

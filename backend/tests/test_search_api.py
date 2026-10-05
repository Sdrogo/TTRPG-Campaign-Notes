"""Full-text search in a Room (spec 21, FR-N5): accent- and case-insensitive
prefix matching over Documents, Notes, Comments and Tags, filtered per viewer
so hidden content is never found, counted or quoted (VR-07, NFR-01)."""

import json
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
    other: dict[str, str]
    player_id: str


async def _room(
    client: AsyncClient, make_token: Callable[..., str], name: str = "Barovia"
) -> _Room:
    master_id, player_id, other_id = (str(uuid.uuid4()) for _ in range(3))
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
    return _Room(f"/rooms/{room['id']}", master, joined[0], joined[1], player_id)


async def _post(client: AsyncClient, url: str, headers: dict[str, str], **body: Any) -> Any:
    response = await client.post(url, json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _document(client: AsyncClient, room: _Room, name: str, **fields: Any) -> Any:
    return await _post(client, f"{room.url}/documents", room.master, name=name, **fields)


async def _note(client: AsyncClient, room: _Room, document: Any, title: str, **fields: Any) -> Any:
    url = f"{room.url}/documents/{document['id']}/notes"
    return await _post(client, url, room.master, title=title, **fields)


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


async def _search(
    client: AsyncClient, room: _Room, headers: dict[str, str], q: str, **params: Any
) -> Any:
    response = await client.get(f"{room.url}/search", params={"q": q, **params}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _ids(results: Any, group: str) -> list[str]:
    return [item["id"] for item in results[group]["items"]]


def _marked(highlighted: Any) -> list[str]:
    """The words a highlighted text marks."""
    return [highlighted["text"][start:end] for start, end in highlighted["highlights"]]


async def test_matching_ignores_accents_and_case_and_takes_prefixes(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    city = await _document(client, room, "La Città", description="Capital of the north.")
    dragon = await _document(client, room, "Il DRAGO rosso")
    tag = await _post(client, f"{room.url}/tags", room.master, name="Cittadini")

    found = await _search(client, room, room.player, "citta")
    assert _ids(found, "documents") == [city["id"]]
    assert _ids(found, "tags") == [tag["id"]]
    hit = found["documents"]["items"][0]
    assert hit["kind"] == "document"
    assert hit["document_id"] == city["id"]
    assert hit["document_name"] == "La Città"
    assert _marked(hit["title"]) == ["Città"]
    assert hit["excerpt"] == {"text": "Capital of the north.", "highlights": []}
    assert _marked(found["tags"]["items"][0]["title"]) == ["Cittadini"]
    assert found["tags"]["items"][0]["document_id"] is None

    found = await _search(client, room, room.player, "dra")
    assert _ids(found, "documents") == [dragon["id"]]
    assert found["documents"]["items"][0]["excerpt"] is None
    # Every word is required.
    found = await _search(client, room, room.player, "drago citta")
    assert _ids(found, "documents") == []


async def test_notes_and_comments_are_found_with_an_excerpt(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    castle = await _document(client, room, "Castle")
    note = await _note(
        client,
        room,
        castle,
        "Rumours",
        description=" ".join(["filler"] * 40) + " the vampire sleeps " + " ".join(["end"] * 40),
    )
    comment = await _comment(client, room, castle, room.player, "A vampire, surely!")

    found = await _search(client, room, room.other, "vampir")
    assert _ids(found, "notes") == [note["id"]]
    note_hit = found["notes"]["items"][0]
    assert note_hit["document_id"] == castle["id"]
    assert note_hit["document_name"] == "Castle"
    assert note_hit["title"] == {"text": "Rumours", "highlights": []}
    assert note_hit["excerpt"]["text"].startswith("… ")
    assert note_hit["excerpt"]["text"].endswith(" …")
    assert _marked(note_hit["excerpt"]) == ["vampire"]
    assert _ids(found, "comments") == [comment["id"]]
    comment_hit = found["comments"]["items"][0]
    assert comment_hit["title"] is None
    assert comment_hit["document_name"] == "Castle"
    assert comment_hit["excerpt"] == {"text": "A vampire, surely!", "highlights": [[2, 9]]}


async def test_mention_tokens_are_found_by_name_not_syntax(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    dragon = await _document(client, room, "Smaug")
    lair = await _document(
        client, room, "Lair", description=f"Home of #[Smaug](doc:{dragon['id']})."
    )

    assert _ids(await _search(client, room, room.player, "doc"), "documents") == []
    found = await _search(client, room, room.player, "smau")
    assert _ids(found, "documents") == [dragon["id"], lair["id"]]
    assert found["documents"]["items"][1]["excerpt"] == {
        "text": "Home of #Smaug.",
        "highlights": [[9, 14]],
    }


async def test_a_player_never_finds_or_counts_hidden_content(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    public = await _document(client, room, "Secret door")
    hidden = await _document(client, room, "Secret lair", visibility="master")
    hidden_note = await _note(client, room, public, "Secret code", visibility="master")
    # Room-level content of a hidden Document is hidden with it.
    await _note(client, room, hidden, "Secret scribbles")
    await _comment(client, room, hidden, room.master, "Secret plans")
    hidden_comment = await _comment(client, room, public, room.master, "Secret twist")
    # A reply the Player could read on its own, under a Comment narrowed
    # afterwards: hidden with its branch (spec 19).
    reply = await _comment(
        client, room, public, room.master, "Secret reply", parent_id=hidden_comment["id"]
    )
    narrowed = await client.patch(
        f"{room.url}/documents/{public['id']}/comments/{hidden_comment['id']}",
        json={"visibility": "master"},
        headers=room.master,
    )
    assert narrowed.status_code == 200, narrowed.text
    own = await _comment(client, room, public, room.player, "Secret of mine", visibility="master")

    found = await _search(client, room, room.player, "secret", limit=1)
    assert _ids(found, "documents") == [public["id"]]
    assert found["documents"]["has_more"] is False
    assert _ids(found, "notes") == []
    assert found["notes"]["has_more"] is False
    # The author always finds their own Comment (VR-02).
    assert _ids(found, "comments") == [own["id"]]
    assert found["comments"]["has_more"] is False
    for word in ("lair", "code", "scribbles", "plans", "twist", "reply"):
        assert word not in json.dumps(found)

    found = await _search(client, room, room.other, "secret")
    assert _ids(found, "comments") == []

    found = await _search(client, room, room.master, "secret")
    assert set(_ids(found, "documents")) == {public["id"], hidden["id"]}
    assert hidden_note["id"] in _ids(found, "notes")
    assert len(found["notes"]["items"]) == 2
    assert {hidden_comment["id"], reply["id"], own["id"]} <= set(_ids(found, "comments"))
    assert len(found["comments"]["items"]) == 4
    limited = await _search(client, room, room.master, "secret", limit=1)
    assert limited["documents"]["has_more"] is True


async def test_view_as_finds_what_the_member_sees(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    await _document(client, room, "Hidden keep", visibility="master")
    headers = {**room.master, "X-View-As": room.player_id}
    assert _ids(await _search(client, room, headers, "keep"), "documents") == []


async def test_a_deleted_comment_is_never_found(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    castle = await _document(client, room, "Castle")
    comment = await _comment(client, room, castle, room.player, "Ravenloft forever")
    deleted = await client.delete(
        f"{room.url}/documents/{castle['id']}/comments/{comment['id']}", headers=room.player
    )
    assert deleted.status_code == 204
    assert _ids(await _search(client, room, room.master, "ravenloft"), "comments") == []


async def test_filters_by_tag_and_kind(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    npc = await _post(client, f"{room.url}/tags", room.master, name="Villain")
    place = await _post(client, f"{room.url}/tags", room.master, name="Wolf places")
    wolf = await _document(client, room, "Wolf lord", tag_ids=[npc["id"]])
    both = await _document(client, room, "Wolf den", tag_ids=[npc["id"], place["id"]])
    untagged = await _document(client, room, "Wolf pack")
    note = await _note(client, room, wolf, "Wolf bane")
    await _note(client, room, untagged, "Wolf howl")
    comment = await _comment(client, room, both, room.player, "Wolfish howls here")
    await _comment(client, room, untagged, room.player, "Wolfish howls there")

    found = await _search(client, room, room.player, "wolf", tag=[npc["id"]])
    assert set(_ids(found, "documents")) == {wolf["id"], both["id"]}
    assert _ids(found, "notes") == [note["id"]]
    assert _ids(found, "comments") == [comment["id"]]
    assert _ids(found, "tags") == []

    found = await _search(client, room, room.player, "wolf", tag=[npc["id"], place["id"]])
    assert _ids(found, "documents") == [both["id"]]
    assert _ids(found, "notes") == []

    found = await _search(client, room, room.player, "wolf", kind="note")
    assert len(found["notes"]["items"]) == 2
    assert found["documents"]["items"] == found["comments"]["items"] == []
    assert found["tags"]["items"] == []

    found = await _search(client, room, room.player, "wolf", kind="tag")
    assert _ids(found, "tags") == [place["id"]]
    assert found["documents"]["items"] == []

    found = await _search(client, room, room.player, "wolf", kind="tag", tag=[npc["id"]])
    assert all(found[group]["items"] == [] for group in found)


async def test_another_rooms_content_and_tags_are_out_of_reach(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    elsewhere = await _room(client, make_token, "Elsewhere")
    await _document(client, elsewhere, "Mordor")
    foreign_tag = await _post(client, f"{elsewhere.url}/tags", elsewhere.master, name="Mordor tag")
    await _document(client, room, "Shire")

    found = await _search(client, room, room.master, "mordor")
    assert all(found[group]["items"] == [] for group in found)

    response = await client.get(
        f"{room.url}/search",
        params={"q": "shire", "tag": foreign_tag["id"]},
        headers=room.master,
    )
    assert response.status_code == 404


async def test_short_queries_and_outsiders(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    await _document(client, room, "A")
    found = await _search(client, room, room.player, "a")
    assert all(found[group] == {"items": [], "has_more": False} for group in found)
    assert set(found) == {"documents", "notes", "comments", "tags"}

    outsider = _headers(make_token, str(uuid.uuid4()))
    response = await client.get(f"{room.url}/search", params={"q": "abc"}, headers=outsider)
    assert response.status_code == 403
    response = await client.get(
        f"{room.url}/search", params={"q": "abc", "limit": 51}, headers=room.master
    )
    assert response.status_code == 422

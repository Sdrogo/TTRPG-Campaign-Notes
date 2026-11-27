"""The Room's Glossary (spec 79): who manages entries, the words that stay
unique, and visibility at every exit (VR-07, VR-10)."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import glossary_repo
from app.domain.glossary import (
    MAX_ALIASES,
    MAX_TERM_LENGTH,
    GlossaryEntry,
    plan_entry_edit,
    term_key,
)
from app.domain.models import DocumentVisibility
from app.main import app


@pytest.fixture(autouse=True)
def _rolled_back(db_session: AsyncSession) -> None:
    """Every test runs in the savepoint `db_session` rolls back, so the Rooms
    they create never reach the shared database."""


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
    friend: _Member

    @property
    def url(self) -> str:
        return f"/rooms/{self.id}/glossary"


async def _room(client: AsyncClient, make_token: Callable[..., str]) -> _Room:
    def member() -> _Member:
        user_id = str(uuid.uuid4())
        return _Member(user_id, {"Authorization": f"Bearer {make_token(user_id)}"})

    master, player, friend = member(), member(), member()
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master.headers)).json()
    for other in (player, friend):
        invite = (
            await client.post(
                f"/rooms/{room['id']}/invitations", json={"role": "player"}, headers=master.headers
            )
        ).json()
        await client.post(f"/invitations/{invite['code']}/accept", headers=other.headers)
    return _Room(room["id"], master, player, friend)


async def _define(
    client: AsyncClient, room: _Room, term: str = "Mist", **fields: object
) -> dict[str, Any]:
    response = await client.post(
        room.url, json={"term": term, **fields}, headers=room.master.headers
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


def test_term_key_ignores_case_accents_and_spaces() -> None:
    assert term_key("  Bärovia  Mist ") == term_key("barovia mist")


def test_audit_records_no_grants_once_the_entry_leaves_selective() -> None:
    friend = uuid.uuid4()
    now = datetime.now(UTC)
    entry = GlossaryEntry(
        uuid.uuid4(), uuid.uuid4(), "Mist", (), "", DocumentVisibility.SELECTIVE,
        True, uuid.uuid4(), now, now,
    )  # fmt: skip
    plan = plan_entry_edit(
        entry,
        uuid.uuid4(),
        now,
        visibility=DocumentVisibility.ROOM,
        current_selective_ids=[friend],
        new_selective_ids=[friend],
    )
    assert plan.audit_entry is not None
    assert plan.audit_entry.details["selective_user_ids"] == []


async def test_master_defines_and_members_read(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    room = await _room(client, make_token)
    entry = await _define(
        client,
        room,
        "Mist",
        aliases=["The Fog"],
        definition="A deadly **haze**.",
        visibility="room",
    )
    assert entry["term"] == "Mist"
    assert entry["aliases"] == ["The Fog"]
    assert entry["can_edit"] is True

    listed = (await client.get(room.url, headers=room.player.headers)).json()
    assert [e["term"] for e in listed] == ["Mist"]
    assert listed[0]["can_edit"] is False
    assert listed[0]["selective_user_ids"] == []


async def test_player_and_outsider(client: AsyncClient, make_token: Callable[..., str]) -> None:
    room = await _room(client, make_token)
    entry = await _define(client, room, visibility="room")
    denied = await client.post(room.url, json={"term": "X"}, headers=room.player.headers)
    assert denied.status_code == 403
    patched = await client.patch(
        f"{room.url}/{entry['id']}", json={"term": "Y"}, headers=room.player.headers
    )
    assert patched.status_code == 403
    deleted = await client.delete(f"{room.url}/{entry['id']}", headers=room.player.headers)
    assert deleted.status_code == 403
    stranger = {"Authorization": f"Bearer {make_token(str(uuid.uuid4()))}"}
    assert (await client.get(room.url, headers=stranger)).status_code == 403


async def test_hidden_entries_are_absent(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    room = await _room(client, make_token)
    secret = await _define(client, room, "Strahd", visibility="master")
    shared = await _define(
        client, room, "Vallaki", visibility="selective", selective_user_ids=[room.friend.id]
    )
    await _define(client, room, "Mist", visibility="room")

    seen_by_player = (await client.get(room.url, headers=room.player.headers)).json()
    assert [e["term"] for e in seen_by_player] == ["Mist"]
    seen_by_friend = (await client.get(room.url, headers=room.friend.headers)).json()
    assert [e["term"] for e in seen_by_friend] == ["Mist", "Vallaki"]
    seen_by_master = (await client.get(room.url, headers=room.master.headers)).json()
    assert len(seen_by_master) == 3

    # A hidden entry is a 404 on every route, never a 403.
    for method in ("patch", "delete"):
        response = await client.request(
            method, f"{room.url}/{secret['id']}", json={}, headers=room.player.headers
        )
        assert response.status_code == 404
    assert shared["selective_user_ids"] == [room.friend.id]


async def test_words_are_unique_even_when_hidden(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    room = await _room(client, make_token)
    await _define(client, room, "Strahd", aliases=["The Devil"], visibility="master")
    for fields in (
        {"term": "strahd"},
        {"term": "Count", "aliases": ["the  devil"]},
        {"term": "Dup", "aliases": ["Dup"]},
    ):
        response = await client.post(room.url, json=fields, headers=room.master.headers)
        assert response.status_code == 409, fields
    # Another Room may define it.
    other = await _room(client, make_token)
    await _define(client, other, "Strahd")


async def test_edit_keeps_own_words_and_audits_visibility(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    room = await _room(client, make_token)
    entry = await _define(client, room, "Mist", visibility="room")
    renamed = await client.patch(
        f"{room.url}/{entry['id']}",
        json={"term": "Mist", "aliases": ["Fog"], "definition": "Thick."},
        headers=room.master.headers,
    )
    assert renamed.status_code == 200
    assert renamed.json()["aliases"] == ["Fog"]

    hidden = await client.patch(
        f"{room.url}/{entry['id']}", json={"visibility": "master"}, headers=room.master.headers
    )
    assert hidden.status_code == 200
    assert (await client.get(room.url, headers=room.player.headers)).json() == []


async def test_field_limits(client: AsyncClient, make_token: Callable[..., str]) -> None:
    room = await _room(client, make_token)
    for fields in (
        {"term": "   "},
        {"term": "x" * (MAX_TERM_LENGTH + 1)},
        {"term": "A", "aliases": [f"a{i}" for i in range(MAX_ALIASES + 1)]},
        {"term": "A", "definition": "x" * 10_001},
        {"term": "A", "tag_ids": [str(uuid.uuid4())]},
        {"term": "A", "document_ids": [str(uuid.uuid4())]},
        {"term": "A", "visibility": "selective", "selective_user_ids": [str(uuid.uuid4())]},
    ):
        response = await client.post(room.url, json=fields, headers=room.master.headers)
        assert response.status_code == 422, fields


async def test_tags_and_documents_links_hide_unseen_documents(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    room = await _room(client, make_token)
    tag = (
        await client.post(
            f"/rooms/{room.id}/tags", json={"name": "Rule"}, headers=room.master.headers
        )
    ).json()
    visible = (
        await client.post(
            f"/rooms/{room.id}/documents",
            json={"name": "Castle", "visibility": "room"},
            headers=room.master.headers,
        )
    ).json()
    hidden = (
        await client.post(
            f"/rooms/{room.id}/documents",
            json={"name": "Crypt", "visibility": "master"},
            headers=room.master.headers,
        )
    ).json()
    entry = await _define(
        client,
        room,
        "Mist",
        visibility="room",
        tag_ids=[tag["id"]],
        document_ids=[visible["id"], hidden["id"]],
    )
    assert [d["name"] for d in entry["documents"]] == ["Castle", "Crypt"]
    assert entry["tag_ids"] == [tag["id"]]

    by_player = (await client.get(room.url, headers=room.player.headers)).json()
    assert [d["name"] for d in by_player[0]["documents"]] == ["Castle"]

    # Deleting the hidden Document, or the Tag, leaves the entry.
    await client.delete(f"/rooms/{room.id}/tags/{tag['id']}", headers=room.master.headers)
    again = (await client.get(room.url, headers=room.master.headers)).json()
    assert again[0]["tag_ids"] == []


async def test_delete_entry(client: AsyncClient, make_token: Callable[..., str]) -> None:
    room = await _room(client, make_token)
    entry = await _define(client, room)
    deleted = await client.delete(f"{room.url}/{entry['id']}", headers=room.master.headers)
    assert deleted.status_code == 204
    assert (await client.get(room.url, headers=room.master.headers)).json() == []


async def test_search_finds_visible_entries_only(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    room = await _room(client, make_token)
    await _define(
        client, room, "Mist", aliases=["Fog"], definition="A deadly haze.", visibility="room"
    )
    await _define(client, room, "Mystery", definition="Hidden.", visibility="master")

    async def search(who: _Member, query: str) -> dict[str, Any]:
        response = await client.get(
            f"/rooms/{room.id}/search", params={"q": query}, headers=who.headers
        )
        return dict(response.json())

    # By alias and by definition text; a prefix finds the visible one only.
    for query in ("fog", "haze", "mis"):
        found = await search(room.player, query)
        assert [h["title"]["text"] for h in found["glossary"]["items"]] == ["Mist"], query
    by_master = await search(room.master, "my")
    assert [h["title"]["text"] for h in by_master["glossary"]["items"]] == ["Mystery"]
    by_player = await search(room.player, "my")
    assert by_player["glossary"]["items"] == []


async def test_duplicating_a_room_copies_the_glossary_onto_the_copy(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    """Spec 79 Decision 8: entries follow the copy's Tags and Documents, the
    Master is their author, Selective turns Private, mentions point inside."""
    room = await _room(client, make_token)
    tag = (
        await client.post(
            f"/rooms/{room.id}/tags", json={"name": "Rule"}, headers=room.master.headers
        )
    ).json()
    castle = (
        await client.post(
            f"/rooms/{room.id}/documents", json={"name": "Castle"}, headers=room.master.headers
        )
    ).json()
    await _define(
        client,
        room,
        "Mist",
        aliases=["Fog"],
        definition=f"See #[Castle](doc:{castle['id']}).",
        tag_ids=[tag["id"]],
        document_ids=[castle["id"]],
        visibility="selective",
        selective_user_ids=[room.player.id],
    )

    response = await client.post(
        f"/rooms/{room.id}/duplicate", json={}, headers=room.master.headers
    )
    assert response.status_code == 201, response.text
    copy_id = response.json()["room"]["id"]

    copied = (await client.get(f"/rooms/{copy_id}/glossary", headers=room.master.headers)).json()
    assert [(e["term"], e["aliases"], e["visibility"]) for e in copied] == [
        ("Mist", ["Fog"], "private")
    ]
    copy_docs = (
        await client.get(f"/rooms/{copy_id}/documents", headers=room.master.headers)
    ).json()
    copy_tags = (await client.get(f"/rooms/{copy_id}/tags", headers=room.master.headers)).json()
    assert copied[0]["documents"] == [{"id": copy_docs[0]["id"], "name": "Castle"}]
    assert copy_docs[0]["id"] != castle["id"]
    assert copied[0]["tag_ids"] == [next(t["id"] for t in copy_tags if t["name"] == "Rule")]
    assert copy_docs[0]["id"] in copied[0]["definition"]
    assert castle["id"] not in copied[0]["definition"]


async def test_the_room_export_carries_only_the_visible_glossary(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    """Spec 79 Decision 7 and VR-10: the JSON and Markdown exports hold the
    entries the requester sees, with mentions by id and Documents by id."""
    room = await _room(client, make_token)
    castle = (
        await client.post(
            f"/rooms/{room.id}/documents", json={"name": "Castle"}, headers=room.master.headers
        )
    ).json()
    rule = (
        await client.post(
            f"/rooms/{room.id}/tags", json={"name": "Rule"}, headers=room.master.headers
        )
    ).json()
    await _define(
        client,
        room,
        "Mist",
        aliases=["Fog"],
        definition=f"Around #[Castle](doc:{castle['id']}).",
        document_ids=[castle["id"]],
        tag_ids=[rule["id"]],
        visibility="room",
    )
    await _define(client, room, "Strahd", visibility="master")

    as_player = (await client.get(f"/rooms/{room.id}/export", headers=room.player.headers)).json()
    assert as_player["schema_version"] == 7
    assert [e["term"] for e in as_player["glossary"]] == ["Mist"]
    entry = as_player["glossary"][0]
    assert entry["aliases"] == ["Fog"]
    assert entry["document_ids"] == [castle["id"]]
    assert entry["definition"][1]["type"] == "mention"
    assert entry["definition"][1]["target_id"] == castle["id"]

    as_master = (await client.get(f"/rooms/{room.id}/export", headers=room.master.headers)).json()
    assert [e["term"] for e in as_master["glossary"]] == ["Mist", "Strahd"]

    markdown = await client.get(
        f"/rooms/{room.id}/export", params={"format": "md"}, headers=room.player.headers
    )
    assert "## Glossary" in markdown.text
    assert "**Mist** (Fog)" in markdown.text
    assert "Tags: Rule" in markdown.text
    assert "Strahd" not in markdown.text


async def test_an_administrator_who_hides_an_entry_from_themselves_gets_nothing_back(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    room = await _room(client, make_token)
    promoted = await client.patch(
        f"/rooms/{room.id}/members/{room.player.id}",
        json={"is_admin": True},
        headers=room.master.headers,
    )
    assert promoted.status_code == 200

    made = await client.post(
        room.url, json={"term": "Crypt", "visibility": "master"}, headers=room.player.headers
    )
    assert made.status_code == 201
    assert made.json() is None
    shown = await _define(client, room, "Mist", visibility="room")
    hidden = await client.patch(
        f"{room.url}/{shown['id']}", json={"visibility": "master"}, headers=room.player.headers
    )
    assert hidden.status_code == 200
    assert hidden.json() is None


async def test_edit_checks_what_it_links_and_its_limits(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    room = await _room(client, make_token)
    entry = await _define(client, room, "Mist", visibility="room")
    url = f"{room.url}/{entry['id']}"
    for fields in (
        {"tag_ids": [str(uuid.uuid4())]},
        {"document_ids": [str(uuid.uuid4())]},
        {"document_ids": [str(uuid.uuid4()) for _ in range(21)]},
        {"visibility": "selective", "selective_user_ids": [str(uuid.uuid4())]},
        {"term": "   "},
        {"aliases": ["x" * (MAX_TERM_LENGTH + 1)]},
    ):
        response = await client.patch(url, json=fields, headers=room.master.headers)
        assert response.status_code == 422, fields

    tag = (
        await client.post(
            f"/rooms/{room.id}/tags", json={"name": "Rule"}, headers=room.master.headers
        )
    ).json()
    document = (
        await client.post(
            f"/rooms/{room.id}/documents",
            json={"name": "Castle", "visibility": "room"},
            headers=room.master.headers,
        )
    ).json()
    linked = await client.patch(
        url,
        json={"tag_ids": [tag["id"]], "document_ids": [document["id"]]},
        headers=room.master.headers,
    )
    assert linked.status_code == 200
    assert linked.json()["tag_ids"] == [tag["id"]]
    assert [d["id"] for d in linked.json()["documents"]] == [document["id"]]


async def test_a_room_holds_a_limited_number_of_entries(
    client: AsyncClient,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.domain.glossary.MAX_ENTRIES_PER_ROOM", 1)
    room = await _room(client, make_token)
    await _define(client, room, "Mist")

    response = await client.post(room.url, json={"term": "Fog"}, headers=room.master.headers)

    assert response.status_code == 409


async def test_a_vanished_entry_cannot_be_updated(db_session: AsyncSession) -> None:
    now = datetime.now(UTC)
    ghost = GlossaryEntry(
        uuid.uuid4(), uuid.uuid4(), "Mist", (), "", DocumentVisibility.ROOM,
        True, uuid.uuid4(), now, now,
    )  # fmt: skip
    with pytest.raises(LookupError):
        await glossary_repo.update_entry(db_session, ghost)


async def test_no_ids_find_no_entries(db_session: AsyncSession) -> None:
    assert await glossary_repo.list_entries_by_ids(db_session, []) == []

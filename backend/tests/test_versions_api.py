"""Whole-Document history routes (spec 24b, after spec 24): what each save of
the Document or its Notes leaves in the history, who may read and restore it,
and that Notes hidden from the requester stay hidden in it (VR-07)."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import versions_repo
from app.db.models import DocumentVersionRow
from app.domain.versions import DocumentState, Version
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
    owner: _Member  # a Player who creates, and so owns, the Document
    reader: _Member  # a Player with no say over the Document

    def document_url(self, document_id: str) -> str:
        return f"/rooms/{self.id}/documents/{document_id}"

    def versions_url(self, document_id: str) -> str:
        return f"{self.document_url(document_id)}/versions"


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
        owner=await _member(client, make_token, room["id"], master),
        reader=await _member(client, make_token, room["id"], master),
    )


async def _document(client: AsyncClient, room: _Room, visibility: str = "room") -> str:
    """A Document owned by `room.owner`, with the description "A vampire."."""
    response = await client.post(
        f"/rooms/{room.id}/documents",
        json={"name": "Strahd", "description": "A vampire.", "visibility": visibility},
        headers=room.owner.headers,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _note(
    client: AsyncClient, room: _Room, document_id: str, author: _Member, **fields: object
) -> str:
    response = await client.post(
        f"{room.document_url(document_id)}/notes",
        json={"title": "Secret door", "description": "Behind the bookcase.", **fields},
        headers=author.headers,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _edit(
    client: AsyncClient, room: _Room, document_id: str, editor: _Member, **fields: object
) -> None:
    response = await client.patch(
        room.document_url(document_id), json=fields, headers=editor.headers
    )
    assert response.status_code == 200, response.text


async def _versions(
    client: AsyncClient, room: _Room, document_id: str, viewer: _Member
) -> list[dict[str, object]]:
    response = await client.get(room.versions_url(document_id), headers=viewer.headers)
    assert response.status_code == 200, response.text
    body: list[dict[str, object]] = response.json()
    return body


async def _age_document_versions(db_session: AsyncSession, document_id: str, minutes: int) -> None:
    """Moves every version of the Document `minutes` into the past, so the
    next save falls outside the merge window."""
    delta = timedelta(minutes=minutes)
    await db_session.execute(
        update(DocumentVersionRow)
        .where(DocumentVersionRow.document_id == uuid.UUID(document_id))
        .values(
            created_at=DocumentVersionRow.created_at - delta,
            updated_at=DocumentVersionRow.updated_at - delta,
        )
    )


# --- Documents: what a save leaves ------------------------------------------


async def test_creating_a_document_writes_its_first_version(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)

    versions = await _versions(client, room, document_id, room.owner)

    assert len(versions) == 1
    assert versions[0]["title"] == "Strahd"
    assert versions[0]["edited_by"] == room.owner.id
    assert versions[0]["words_added"] is None
    assert versions[0]["words_removed"] is None
    assert "description" not in versions[0]


async def test_three_quick_saves_by_one_owner_are_one_version(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)

    for text in ("A vampire lord.", "A vampire lord of Barovia.", "A vampire count of Barovia."):
        await _edit(client, room, document_id, room.owner, description=text)

    versions = await _versions(client, room, document_id, room.owner)
    assert len(versions) == 1
    detail = await client.get(
        f"{room.versions_url(document_id)}/{versions[0]['id']}", headers=room.owner.headers
    )
    assert detail.json()["description"] == "A vampire count of Barovia."


async def test_another_editor_adds_a_version_with_its_change_size(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)

    await _edit(client, room, document_id, room.master, description="A vampire lord of Barovia.")

    versions = await _versions(client, room, document_id, room.owner)
    assert [v["edited_by"] for v in versions] == [room.master.id, room.owner.id]
    assert versions[0]["words_added"] == 4
    assert versions[0]["words_removed"] == 1
    assert versions[1]["words_added"] is None


async def test_the_same_editor_after_the_window_adds_a_version(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    await _age_document_versions(db_session, document_id, 11)

    await _edit(client, room, document_id, room.owner, description="A vampire lord.")

    assert len(await _versions(client, room, document_id, room.owner)) == 2


async def test_a_save_that_changes_no_text_writes_nothing(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    await _age_document_versions(db_session, document_id, 60)

    await _edit(client, room, document_id, room.master, visibility="master")
    await _edit(client, room, document_id, room.master, description="A vampire.", name="Strahd")

    assert len(await _versions(client, room, document_id, room.master)) == 1


# --- Documents: restore (Decision 3) ----------------------------------------


async def test_restoring_the_first_version_adds_a_third_with_the_old_text(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    await _edit(client, room, document_id, room.owner, description="A tall vampire.")
    await _edit(client, room, document_id, room.master, name="Count Strahd", description="Lord.")
    first = (await _versions(client, room, document_id, room.owner))[-1]

    response = await client.post(
        f"{room.versions_url(document_id)}/{first['id']}/restore", headers=room.owner.headers
    )

    assert response.status_code == 200, response.text
    assert response.json()["title"] == "Strahd"
    assert response.json()["description"] == "A tall vampire."
    versions = await _versions(client, room, document_id, room.owner)
    assert len(versions) == 3
    assert versions[0]["edited_by"] == room.owner.id
    document = (await client.get(room.document_url(document_id), headers=room.owner.headers)).json()
    assert (document["name"], document["description"]) == ("Strahd", "A tall vampire.")


async def test_a_restore_never_merges_into_the_previous_version(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    await _edit(client, room, document_id, room.owner, description="A tall vampire.")
    first = (await _versions(client, room, document_id, room.owner))[-1]
    await _age_document_versions(db_session, document_id, 11)
    await _edit(client, room, document_id, room.owner, description="Changed.")

    # Same editor, inside the window of the "Changed." version.
    await client.post(
        f"{room.versions_url(document_id)}/{first['id']}/restore", headers=room.owner.headers
    )

    versions = await _versions(client, room, document_id, room.owner)
    assert len(versions) == 3
    kept = await client.get(
        f"{room.versions_url(document_id)}/{versions[1]['id']}", headers=room.owner.headers
    )
    assert kept.json()["description"] == "Changed."


async def test_restoring_the_current_text_changes_nothing(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    current = (await _versions(client, room, document_id, room.owner))[0]

    response = await client.post(
        f"{room.versions_url(document_id)}/{current['id']}/restore", headers=room.owner.headers
    )

    assert response.status_code == 200
    assert response.json()["id"] == current["id"]
    assert len(await _versions(client, room, document_id, room.owner)) == 1


async def test_a_restore_rewrites_the_description_mentions(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    other = await _document(client, room)
    token = f"#[Strahd](doc:{other})"
    await _edit(client, room, document_id, room.owner, description=f"See {token}.")
    await _age_document_versions(db_session, document_id, 11)
    await _edit(client, room, document_id, room.owner, description="Nothing.")
    mentioning = (await _versions(client, room, document_id, room.owner))[1]

    await client.post(
        f"{room.versions_url(document_id)}/{mentioning['id']}/restore",
        headers=room.owner.headers,
    )

    backlinks = await client.get(
        f"{room.document_url(other)}/backlinks", headers=room.owner.headers
    )
    assert [b["document_id"] for b in backlinks.json()] == [document_id]


# --- Documents: who may see it (Decision 3, D-12, VR-07) --------------------


async def test_a_reader_who_is_not_an_owner_is_refused_every_route(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    version = (await _versions(client, room, document_id, room.owner))[0]
    url = room.versions_url(document_id)

    assert (await client.get(url, headers=room.reader.headers)).status_code == 403
    assert (
        await client.get(f"{url}/{version['id']}", headers=room.reader.headers)
    ).status_code == 403
    assert (
        await client.post(f"{url}/{version['id']}/restore", headers=room.reader.headers)
    ).status_code == 403


async def test_a_document_the_requester_cannot_see_has_no_history_for_them(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, visibility="master")

    response = await client.get(room.versions_url(document_id), headers=room.reader.headers)

    assert response.status_code == 404


async def test_a_member_of_no_such_room_is_refused(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    stranger = await _member(client, make_token, None, None)

    response = await client.get(room.versions_url(document_id), headers=stranger.headers)

    assert response.status_code in (403, 404)


async def test_the_master_reads_the_history_of_any_document(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)

    assert len(await _versions(client, room, document_id, room.master)) == 1


async def test_an_unknown_version_and_one_of_another_document_are_404(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    other_id = await _document(client, room)
    elsewhere = (await _versions(client, room, other_id, room.owner))[0]
    url = room.versions_url(document_id)

    for version_id in (str(uuid.uuid4()), elsewhere["id"]):
        assert (
            await client.get(f"{url}/{version_id}", headers=room.owner.headers)
        ).status_code == 404
        assert (
            await client.post(f"{url}/{version_id}/restore", headers=room.owner.headers)
        ).status_code == 404


async def test_deleting_a_document_deletes_its_history(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)

    await client.delete(room.document_url(document_id), headers=room.owner.headers)

    count = await db_session.scalar(
        select(func.count())
        .select_from(DocumentVersionRow)
        .where(DocumentVersionRow.document_id == uuid.UUID(document_id))
    )
    assert count == 0


# --- Notes are part of the Document's history (spec 24b) --------------------


def _notes_url(room: _Room, document_id: str) -> str:
    return f"{room.document_url(document_id)}/notes"


async def _edit_note(
    client: AsyncClient,
    room: _Room,
    document_id: str,
    note_id: str,
    editor: _Member,
    **fields: object,
) -> None:
    response = await client.patch(
        f"{_notes_url(room, document_id)}/{note_id}", json=fields, headers=editor.headers
    )
    assert response.status_code == 200, response.text


async def _delete_note(
    client: AsyncClient, room: _Room, document_id: str, note_id: str, editor: _Member
) -> None:
    response = await client.delete(
        f"{_notes_url(room, document_id)}/{note_id}", headers=editor.headers
    )
    assert response.status_code == 204, response.text


async def _full(
    client: AsyncClient, room: _Room, document_id: str, version_id: object, viewer: _Member
) -> dict[str, Any]:
    response = await client.get(
        f"{room.versions_url(document_id)}/{version_id}", headers=viewer.headers
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def _restore(
    client: AsyncClient, room: _Room, document_id: str, version_id: object, viewer: _Member
) -> dict[str, Any]:
    response = await client.post(
        f"{room.versions_url(document_id)}/{version_id}/restore", headers=viewer.headers
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def _notes(
    client: AsyncClient, room: _Room, document_id: str, viewer: _Member
) -> list[dict[str, object]]:
    body: list[dict[str, object]] = (
        await client.get(_notes_url(room, document_id), headers=viewer.headers)
    ).json()
    return body


async def test_note_saves_are_revisions_of_the_document(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    # The same Owner inside the window: merged into the Document's first one.
    note_id = await _note(client, room, document_id, room.owner)
    await _edit_note(client, room, document_id, note_id, room.master, description="Two words")

    versions = await _versions(client, room, document_id, room.owner)

    assert [v["edited_by"] for v in versions] == [room.master.id, room.owner.id]
    assert (versions[0]["words_added"], versions[0]["words_removed"]) == (2, 3)
    assert (versions[0]["notes_added"], versions[0]["notes_removed"]) == (0, 0)
    first = await _full(client, room, document_id, versions[1]["id"], room.owner)
    assert first["notes"] == [
        {"id": note_id, "title": "Secret door", "description": "Behind the bookcase."}
    ]
    newest = await _full(client, room, document_id, versions[0]["id"], room.owner)
    assert newest["words_added"] == 2


async def test_a_deleted_note_comes_back_with_its_place_and_visibility(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    first_id = await _note(client, room, document_id, room.owner, title="First")
    note_id = await _note(
        client,
        room,
        document_id,
        room.owner,
        visibility="selective",
        selective_user_ids=[room.reader.id],
    )
    await _note(client, room, document_id, room.owner, title="Last")
    before = (await _versions(client, room, document_id, room.owner))[0]

    # Same Owner, inside the window: still a revision of its own.
    await _delete_note(client, room, document_id, note_id, room.owner)
    versions = await _versions(client, room, document_id, room.owner)
    assert len(versions) == 2
    assert versions[0]["notes_removed"] == 1

    restored = await _restore(client, room, document_id, before["id"], room.owner)

    assert [note["id"] for note in restored["notes"]] == [
        first_id,
        note_id,
        restored["notes"][2]["id"],
    ]
    notes = await _notes(client, room, document_id, room.owner)
    assert [note["title"] for note in notes] == ["First", "Secret door", "Last"]
    assert notes[1]["visibility"] == "selective"
    assert notes[1]["selective_user_ids"] == [room.reader.id]
    reader_notes = await _notes(client, room, document_id, room.reader)
    assert note_id in [note["id"] for note in reader_notes]
    assert len(await _versions(client, room, document_id, room.owner)) == 3


async def test_a_restore_removes_notes_added_since_and_puts_the_order_back(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    one = await _note(client, room, document_id, room.owner, title="One")
    two = await _note(client, room, document_id, room.owner, title="Two")
    before = (await _versions(client, room, document_id, room.owner))[0]
    await _age_document_versions(db_session, document_id, 11)
    response = await client.put(
        f"{_notes_url(room, document_id)}/order",
        json={"note_ids": [two, one]},
        headers=room.owner.headers,
    )
    assert response.status_code == 200
    await _note(client, room, document_id, room.owner, title="Three")
    await _edit_note(client, room, document_id, one, room.owner, description="Changed.")
    assert len(await _versions(client, room, document_id, room.owner)) == 2

    await _restore(client, room, document_id, before["id"], room.owner)

    notes = await _notes(client, room, document_id, room.owner)
    assert [(n["title"], n["description"]) for n in notes] == [
        ("One", "Behind the bookcase."),
        ("Two", "Behind the bookcase."),
    ]


async def test_notes_hidden_from_an_owner_stay_out_of_their_history(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    secret = await _note(
        client, room, document_id, room.master, title="Vault", visibility="master"
    )
    await _edit_note(client, room, document_id, secret, room.master, description="Gold.")

    owner_versions = await _versions(client, room, document_id, room.owner)
    master_versions = await _versions(client, room, document_id, room.master)

    # The Master's two saves merged into one revision, which only touched the
    # hidden Note: the Owner doesn't see it, or its id.
    assert len(master_versions) == 2
    assert len(owner_versions) == 1
    assert (
        await client.get(
            f"{room.versions_url(document_id)}/{master_versions[0]['id']}",
            headers=room.owner.headers,
        )
    ).status_code == 404
    full = await _full(client, room, document_id, owner_versions[0]["id"], room.owner)
    assert full["notes"] == []

    # A restore by the Owner leaves the hidden Note as it is.
    await _edit(client, room, document_id, room.owner, description="Changed.")
    await _restore(client, room, document_id, owner_versions[0]["id"], room.owner)
    master_notes = await _notes(client, room, document_id, room.master)
    assert [(n["id"], n["description"]) for n in master_notes] == [(secret, "Gold.")]


async def test_a_note_narrowed_before_its_deletion_stays_hidden(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note_id = await _note(client, room, document_id, room.owner, title="Plans")
    await _age_document_versions(db_session, document_id, 60)
    # Only its visibility changes: no new revision, but the latest learns it.
    await _edit_note(client, room, document_id, note_id, room.master, visibility="master")
    assert len(await _versions(client, room, document_id, room.master)) == 1
    await _delete_note(client, room, document_id, note_id, room.master)

    owner_versions = await _versions(client, room, document_id, room.owner)
    master_versions = await _versions(client, room, document_id, room.master)

    assert len(owner_versions) == 1
    assert (await _full(client, room, document_id, owner_versions[0]["id"], room.owner))[
        "notes"
    ] == []
    assert len(master_versions) == 2
    older = await _full(client, room, document_id, master_versions[1]["id"], room.master)
    assert [note["title"] for note in older["notes"]] == ["Plans"]


async def test_a_reveal_keeps_the_history_in_step(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note_id = await _note(client, room, document_id, room.master, visibility="master")
    assert len(await _versions(client, room, document_id, room.owner)) == 1

    response = await client.post(
        f"{_notes_url(room, document_id)}/{note_id}/reveal",
        json={"to_room": True},
        headers=room.master.headers,
    )
    assert response.status_code == 200, response.text

    full = await _full(
        client,
        room,
        document_id,
        (await _versions(client, room, document_id, room.owner))[0]["id"],
        room.owner,
    )
    assert [note["id"] for note in full["notes"]] == [note_id]


async def test_a_restore_past_the_note_cap_is_409(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note_id = await _note(client, room, document_id, room.owner)
    before = (await _versions(client, room, document_id, room.owner))[0]
    await _delete_note(client, room, document_id, note_id, room.owner)
    await _note(client, room, document_id, room.master, title="Hidden", visibility="master")
    monkeypatch.setattr("app.domain.versions.MAX_NOTES_PER_DOCUMENT", 1)

    response = await client.post(
        f"{room.versions_url(document_id)}/{before['id']}/restore", headers=room.owner.headers
    )

    assert response.status_code == 409


async def test_updating_a_version_that_is_gone_raises(db_session: AsyncSession) -> None:
    now = datetime.now(UTC)
    gone = Version(uuid.uuid4(), DocumentState("T", "D"), uuid.uuid4(), now, now)

    with pytest.raises(LookupError):
        await versions_repo.update_version(db_session, gone)

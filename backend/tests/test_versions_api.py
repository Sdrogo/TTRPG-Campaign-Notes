"""Version history routes (spec 24): what each save leaves in the history,
who may read and restore it, and that a hidden Note's history stays hidden
(VR-07)."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import versions_repo
from app.db.models import DocumentVersionRow, NoteVersionRow
from app.domain.versions import Version
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

    def note_versions_url(self, document_id: str, note_id: str) -> str:
        return f"{self.document_url(document_id)}/notes/{note_id}/versions"


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


async def _age_note_versions(db_session: AsyncSession, note_id: str, minutes: int) -> None:
    """`_age_document_versions` for a Note."""
    delta = timedelta(minutes=minutes)
    await db_session.execute(
        update(NoteVersionRow)
        .where(NoteVersionRow.note_id == uuid.UUID(note_id))
        .values(
            created_at=NoteVersionRow.created_at - delta,
            updated_at=NoteVersionRow.updated_at - delta,
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


# --- Notes ------------------------------------------------------------------


async def _edit_note(
    client: AsyncClient,
    room: _Room,
    document_id: str,
    note_id: str,
    editor: _Member,
    **fields: object,
) -> None:
    response = await client.patch(
        f"{room.document_url(document_id)}/notes/{note_id}", json=fields, headers=editor.headers
    )
    assert response.status_code == 200, response.text


async def test_a_note_has_its_own_history_that_merges_like_a_document(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note_id = await _note(client, room, document_id, room.owner)

    await _edit_note(client, room, document_id, note_id, room.owner, description="Two.")
    await _edit_note(client, room, document_id, note_id, room.owner, description="Three.")
    await _edit_note(client, room, document_id, note_id, room.master, title="Hidden door")

    response = await client.get(
        room.note_versions_url(document_id, note_id), headers=room.owner.headers
    )
    versions = response.json()
    assert [v["title"] for v in versions] == ["Hidden door", "Secret door"]
    assert [v["edited_by"] for v in versions] == [room.master.id, room.owner.id]
    # The Document's own history is untouched by a Note's saves.
    assert len(await _versions(client, room, document_id, room.owner)) == 1


async def test_a_note_save_that_changes_only_its_visibility_writes_nothing(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note_id = await _note(client, room, document_id, room.owner)
    await _age_note_versions(db_session, note_id, 60)

    await _edit_note(client, room, document_id, note_id, room.master, visibility="master")

    response = await client.get(
        room.note_versions_url(document_id, note_id), headers=room.master.headers
    )
    assert len(response.json()) == 1


async def test_restoring_a_note_version_adds_a_version_and_keeps_the_rest(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note_id = await _note(client, room, document_id, room.owner, visibility="selective")
    await _edit_note(client, room, document_id, note_id, room.master, description="Rewritten.")
    url = room.note_versions_url(document_id, note_id)
    first = (await client.get(url, headers=room.owner.headers)).json()[-1]

    response = await client.post(f"{url}/{first['id']}/restore", headers=room.owner.headers)

    assert response.status_code == 200, response.text
    assert response.json()["description"] == "Behind the bookcase."
    assert len((await client.get(url, headers=room.owner.headers)).json()) == 3
    notes = (
        await client.get(f"{room.document_url(document_id)}/notes", headers=room.owner.headers)
    ).json()
    assert notes[0]["description"] == "Behind the bookcase."
    assert notes[0]["visibility"] == "selective"


async def test_a_reader_is_refused_a_notes_history(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note_id = await _note(client, room, document_id, room.owner)
    url = room.note_versions_url(document_id, note_id)

    assert (await client.get(url, headers=room.reader.headers)).status_code == 403


async def test_an_owner_cannot_read_the_history_of_a_note_hidden_from_them(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note_id = await _note(client, room, document_id, room.master, visibility="master")
    url = room.note_versions_url(document_id, note_id)
    version = (await client.get(url, headers=room.master.headers)).json()[0]

    assert (await client.get(url, headers=room.owner.headers)).status_code == 404
    assert (
        await client.get(f"{url}/{version['id']}", headers=room.owner.headers)
    ).status_code == 404
    assert (
        await client.post(f"{url}/{version['id']}/restore", headers=room.owner.headers)
    ).status_code == 404
    assert (await client.get(url, headers=room.master.headers)).status_code == 200


async def test_a_note_version_of_another_note_is_404_and_a_deleted_note_takes_its_history(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note_id = await _note(client, room, document_id, room.owner)
    other_id = await _note(client, room, document_id, room.owner, title="Other")
    elsewhere = (
        await client.get(room.note_versions_url(document_id, other_id), headers=room.owner.headers)
    ).json()[0]
    url = room.note_versions_url(document_id, note_id)

    assert (
        await client.get(f"{url}/{elsewhere['id']}", headers=room.owner.headers)
    ).status_code == 404
    assert (
        await client.get(f"{url}/{uuid.uuid4()}", headers=room.owner.headers)
    ).status_code == 404
    assert (
        await client.post(f"{url}/{uuid.uuid4()}/restore", headers=room.owner.headers)
    ).status_code == 404

    await client.delete(
        f"{room.document_url(document_id)}/notes/{note_id}", headers=room.owner.headers
    )
    count = await db_session.scalar(
        select(func.count())
        .select_from(NoteVersionRow)
        .where(NoteVersionRow.note_id == uuid.UUID(note_id))
    )
    assert count == 0


async def test_an_owner_reads_one_note_version_in_full(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note_id = await _note(client, room, document_id, room.owner)
    url = room.note_versions_url(document_id, note_id)
    listed = (await client.get(url, headers=room.owner.headers)).json()[0]

    response = await client.get(f"{url}/{listed['id']}", headers=room.owner.headers)

    assert response.status_code == 200
    assert response.json()["title"] == "Secret door"
    assert response.json()["description"] == "Behind the bookcase."


async def test_updating_a_version_that_is_gone_raises(db_session: AsyncSession) -> None:
    gone = Version(uuid.uuid4(), "T", "D", uuid.uuid4(), datetime.now(UTC), datetime.now(UTC))

    for subject in ("document", "note"):
        with pytest.raises(LookupError):
            await versions_repo.update_version(db_session, subject, gone)

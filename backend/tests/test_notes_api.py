import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import UTC, datetime

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import notes_repo
from app.db.models import AuditLogRow, NoteRow, NoteVisibilityGrantRow
from app.domain.models import DocumentVisibility
from app.domain.notes import MAX_NOTE_TITLE_LENGTH, MAX_NOTES_PER_DOCUMENT, plan_new_note
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
    friend: _Member  # another Player, used for Selective grants

    def notes_url(self, document_id: str) -> str:
        return f"/rooms/{self.id}/documents/{document_id}/notes"

    def document_url(self, document_id: str) -> str:
        return f"/rooms/{self.id}/documents/{document_id}"


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
        friend=await _member(client, make_token, room["id"], master),
    )


async def _document(client: AsyncClient, room: _Room, visibility: str = "room") -> str:
    """A Document owned by `room.owner` (the Master owns it implicitly too)."""
    response = await client.post(
        f"/rooms/{room.id}/documents",
        json={"name": "Castle Ravenloft", "visibility": visibility},
        headers=room.owner.headers,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _note(
    client: AsyncClient, room: _Room, document_id: str, author: _Member, **fields: object
) -> dict[str, object]:
    response = await client.post(
        room.notes_url(document_id),
        json={"title": "Secret door", "description": "Behind the bookcase.", **fields},
        headers=author.headers,
    )
    assert response.status_code == 201, response.text
    body: dict[str, object] = response.json()
    assert isinstance(body, dict)
    return body


async def _titles(client: AsyncClient, room: _Room, document_id: str, viewer: _Member) -> list[str]:
    response = await client.get(room.notes_url(document_id), headers=viewer.headers)
    assert response.status_code == 200, response.text
    return [n["title"] for n in response.json()]


async def test_owner_creates_a_note_and_everyone_sees_it_in_order(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)

    first = await _note(client, room, document_id, room.owner, title="  First  ")
    await _note(client, room, document_id, room.master, title="Second")

    assert first["title"] == "First"
    assert first["description"] == "Behind the bookcase."
    assert first["visibility"] == "room"
    assert first["document_id"] == document_id
    assert first["position"] == 0
    assert first["can_edit"] is True
    assert first["can_delete"] is True
    assert await _titles(client, room, document_id, room.reader) == ["First", "Second"]


async def test_a_document_with_no_notes_lists_none(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)

    response = await client.get(room.notes_url(document_id), headers=room.reader.headers)

    assert response.status_code == 200
    assert response.json() == []


async def test_a_reader_sees_the_note_but_cannot_change_it(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note = await _note(client, room, document_id, room.owner)

    listed = (await client.get(room.notes_url(document_id), headers=room.reader.headers)).json()
    url = f"{room.notes_url(document_id)}/{note['id']}"

    assert listed[0]["can_edit"] is False
    assert listed[0]["can_delete"] is False
    assert (
        await client.patch(url, json={"title": "Mine now"}, headers=room.reader.headers)
    ).status_code == 403
    assert (await client.delete(url, headers=room.reader.headers)).status_code == 403
    assert (
        await client.post(
            room.notes_url(document_id), json={"title": "Hi"}, headers=room.reader.headers
        )
    ).status_code == 403
    assert (
        await client.put(
            f"{room.notes_url(document_id)}/order",
            json={"note_ids": [note["id"]]},
            headers=room.reader.headers,
        )
    ).status_code == 403
    assert await _titles(client, room, document_id, room.owner) == ["Secret door"]


async def test_notes_are_filtered_per_viewer_at_every_level(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    await _note(client, room, document_id, room.owner, title="Room")
    await _note(client, room, document_id, room.owner, title="Private", visibility="private")
    await _note(
        client,
        room,
        document_id,
        room.owner,
        title="Shared",
        visibility="selective",
        selective_user_ids=[room.friend.id],
    )
    created = await client.post(
        room.notes_url(document_id),
        json={"title": "GM only", "visibility": "master"},
        headers=room.owner.headers,
    )

    assert created.status_code == 201
    assert created.json() is None

    assert await _titles(client, room, document_id, room.master) == [
        "Room",
        "Private",
        "Shared",
        "GM only",
    ]
    # The Owner loses sight of a Note they set to "Master", like a Document.
    assert await _titles(client, room, document_id, room.owner) == ["Room", "Private", "Shared"]
    assert await _titles(client, room, document_id, room.friend) == ["Room", "Shared"]
    assert await _titles(client, room, document_id, room.reader) == ["Room"]


async def test_a_hidden_note_is_absent_from_the_document_response(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    await _note(client, room, document_id, room.owner, title="Visible")
    await _note(client, room, document_id, room.master, title="Hidden", visibility="master")

    reader = await client.get(room.document_url(document_id), headers=room.reader.headers)
    master = await client.get(room.document_url(document_id), headers=room.master.headers)

    assert [n["title"] for n in reader.json()["notes"]] == ["Visible"]
    assert [n["title"] for n in master.json()["notes"]] == ["Visible", "Hidden"]
    assert "Hidden" not in reader.text


async def test_a_document_with_only_hidden_notes_looks_like_one_with_none(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    with_hidden = await _document(client, room)
    without = await _document(client, room)
    await _note(client, room, with_hidden, room.master, visibility="master")

    hidden = (await client.get(room.document_url(with_hidden), headers=room.reader.headers)).json()
    empty = (await client.get(room.document_url(without), headers=room.reader.headers)).json()

    assert hidden["notes"] == empty["notes"] == []


async def test_every_single_document_route_carries_its_notes_and_the_list_does_not(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    await _note(client, room, document_id, room.owner, title="Kept")

    patched = await client.patch(
        room.document_url(document_id), json={"name": "Renamed"}, headers=room.owner.headers
    )
    listed = await client.get(f"/rooms/{room.id}/documents", headers=room.owner.headers)

    assert [n["title"] for n in patched.json()["notes"]] == ["Kept"]
    assert "notes" not in listed.json()[0]


async def test_a_new_document_starts_with_no_notes(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    created = await client.post(
        f"/rooms/{room.id}/documents", json={"name": "Fresh"}, headers=room.owner.headers
    )
    assert created.json()["notes"] == []


async def test_notes_of_a_hidden_document_are_unreachable(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, visibility="master")
    note = await _note(client, room, document_id, room.master)
    url = f"{room.notes_url(document_id)}/{note['id']}"

    for response in (
        await client.get(room.notes_url(document_id), headers=room.reader.headers),
        await client.post(
            room.notes_url(document_id), json={"title": "Hi"}, headers=room.reader.headers
        ),
        await client.patch(url, json={"title": "Hi"}, headers=room.reader.headers),
        await client.delete(url, headers=room.reader.headers),
        await client.put(
            f"{room.notes_url(document_id)}/order",
            json={"note_ids": []},
            headers=room.reader.headers,
        ),
    ):
        assert response.status_code == 404


async def test_non_member_cannot_reach_notes(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    outsider = await _member(client, make_token, None, None)

    response = await client.get(room.notes_url(document_id), headers=outsider.headers)

    assert response.status_code == 403


async def test_a_hidden_note_is_a_404_not_a_403_for_a_reader_who_tries_it(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    await client.post(
        room.notes_url(document_id),
        json={"title": "Secret door", "visibility": "master"},
        headers=room.owner.headers,
    )
    hidden = (await client.get(room.notes_url(document_id), headers=room.master.headers)).json()[0]
    url = f"{room.notes_url(document_id)}/{hidden['id']}"
    missing = f"{room.notes_url(document_id)}/{uuid.uuid4()}"

    # A reader can't tell a hidden Note from one that doesn't exist.
    for target in (url, missing):
        patched = await client.patch(target, json={"title": "X"}, headers=room.reader.headers)
        deleted = await client.delete(target, headers=room.reader.headers)
        assert patched.status_code == 404
        assert deleted.status_code == 404
        assert (
            patched.json()
            == (
                await client.patch(missing, json={"title": "X"}, headers=room.reader.headers)
            ).json()
        )
    # The Owner, who set it to "Master", can't reach it either.
    assert (await client.delete(url, headers=room.owner.headers)).status_code == 404


async def test_a_note_of_another_document_is_not_found(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    first = await _document(client, room)
    second = await _document(client, room)
    note = await _note(client, room, first, room.owner)

    response = await client.patch(
        f"{room.notes_url(second)}/{note['id']}", json={"title": "X"}, headers=room.owner.headers
    )

    assert response.status_code == 404


async def test_a_master_who_does_not_own_the_document_still_manages_its_notes(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note = await _note(client, room, document_id, room.owner)

    response = await client.patch(
        f"{room.notes_url(document_id)}/{note['id']}",
        json={"title": "GM edit"},
        headers=room.master.headers,
    )

    assert response.status_code == 200
    assert response.json()["title"] == "GM edit"


async def test_note_input_is_validated(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note = await _note(client, room, document_id, room.owner)
    url = f"{room.notes_url(document_id)}/{note['id']}"
    stranger = str(uuid.uuid4())

    async def create(**fields: object) -> int:
        response = await client.post(
            room.notes_url(document_id), json=fields, headers=room.owner.headers
        )
        return response.status_code

    assert await create(title="   ") == 422
    assert await create(title="x" * (MAX_NOTE_TITLE_LENGTH + 1)) == 422
    assert await create(title="Ok", visibility="selective", selective_user_ids=[stranger]) == 422
    assert await create() == 422
    for body in ({"title": " "}, {"title": "x" * (MAX_NOTE_TITLE_LENGTH + 1)}):
        assert (await client.patch(url, json=body, headers=room.owner.headers)).status_code == 422
    assert (
        await client.patch(url, json={"selective_user_ids": [stranger]}, headers=room.owner.headers)
    ).status_code == 422
    assert await _titles(client, room, document_id, room.owner) == ["Secret door"]


async def test_editing_the_text_is_not_audited(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note = await _note(client, room, document_id, room.owner)

    response = await client.patch(
        f"{room.notes_url(document_id)}/{note['id']}",
        json={"title": "Renamed", "description": "New text with #Strahd"},
        headers=room.owner.headers,
    )

    body = response.json()
    assert body["title"] == "Renamed"
    assert body["description"] == "New text with #Strahd"
    assert body["visibility"] == "room"
    assert (await client.get(room.notes_url(document_id), headers=room.reader.headers)).json()[0][
        "description"
    ] == "New text with #Strahd"
    assert await _audit_actions(db_session) == []


async def _audit_actions(db_session: AsyncSession) -> list[str]:
    result = await db_session.execute(
        select(AuditLogRow.action).where(AuditLogRow.action == "note_visibility_changed")
    )
    return list(result.scalars())


async def test_changing_a_notes_visibility_is_audited_in_the_same_transaction(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note = await _note(client, room, document_id, room.owner)

    response = await client.patch(
        f"{room.notes_url(document_id)}/{note['id']}",
        json={"visibility": "selective", "selective_user_ids": [room.friend.id]},
        headers=room.owner.headers,
    )

    assert response.status_code == 200
    assert response.json()["visibility"] == "selective"
    assert response.json()["selective_user_ids"] == [room.friend.id]
    entries = list(
        (
            await db_session.execute(
                select(AuditLogRow).where(AuditLogRow.action == "note_visibility_changed")
            )
        ).scalars()
    )
    assert len(entries) == 1
    assert str(entries[0].room_id) == room.id
    assert str(entries[0].actor_user_id) == room.owner.id
    assert entries[0].details["note_id"] == note["id"]
    assert entries[0].details["from"] == "room"
    assert entries[0].details["to"] == "selective"
    assert entries[0].details["selective_user_ids"] == [room.friend.id]
    assert await _titles(client, room, document_id, room.friend) == ["Secret door"]
    assert await _titles(client, room, document_id, room.reader) == []


async def test_changing_a_note_to_master_hides_it_from_its_owner(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note = await _note(client, room, document_id, room.owner)

    response = await client.patch(
        f"{room.notes_url(document_id)}/{note['id']}",
        json={"visibility": "master"},
        headers=room.owner.headers,
    )

    assert response.status_code == 200
    assert response.json() is None
    for viewer in (room.owner, room.reader):
        assert await _titles(client, room, document_id, viewer) == []
        document = await client.get(room.document_url(document_id), headers=viewer.headers)
        assert document.status_code == 200
        assert document.json()["notes"] == []
    assert await _titles(client, room, document_id, room.master) == ["Secret door"]
    assert await _audit_actions(db_session) == ["note_visibility_changed"]


async def test_changing_only_the_grants_is_audited_and_resending_them_is_not(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note = await _note(
        client,
        room,
        document_id,
        room.owner,
        visibility="selective",
        selective_user_ids=[room.friend.id],
    )
    url = f"{room.notes_url(document_id)}/{note['id']}"

    same = await client.patch(
        url, json={"selective_user_ids": [room.friend.id]}, headers=room.owner.headers
    )
    assert same.status_code == 200
    assert await _audit_actions(db_session) == []

    swapped = await client.patch(
        url, json={"selective_user_ids": [room.reader.id]}, headers=room.owner.headers
    )
    assert swapped.json()["selective_user_ids"] == [room.reader.id]
    assert await _audit_actions(db_session) == ["note_visibility_changed"]
    assert await _titles(client, room, document_id, room.friend) == []
    assert await _titles(client, room, document_id, room.reader) == ["Secret door"]
    grants = (await db_session.execute(select(NoteVisibilityGrantRow.user_id))).scalars()
    assert {str(user_id) for user_id in grants} >= {room.reader.id}


async def test_who_a_selective_note_is_shared_with_is_shown_only_to_its_managers(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    await _note(
        client,
        room,
        document_id,
        room.owner,
        visibility="selective",
        selective_user_ids=[room.friend.id],
    )

    as_owner = (await client.get(room.notes_url(document_id), headers=room.owner.headers)).json()
    as_friend = (await client.get(room.notes_url(document_id), headers=room.friend.headers)).json()

    assert as_owner[0]["selective_user_ids"] == [room.friend.id]
    assert as_friend[0]["selective_user_ids"] == []
    assert as_friend[0]["visibility"] == "selective"


async def test_deleting_a_note_removes_it_and_its_grants(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    keep = await _note(client, room, document_id, room.owner, title="Keep")
    gone = await _note(
        client,
        room,
        document_id,
        room.owner,
        title="Gone",
        visibility="selective",
        selective_user_ids=[room.friend.id],
    )

    response = await client.delete(
        f"{room.notes_url(document_id)}/{gone['id']}", headers=room.owner.headers
    )

    assert response.status_code == 204
    assert await _titles(client, room, document_id, room.owner) == ["Keep"]
    assert await db_session.get(NoteRow, uuid.UUID(str(keep["id"]))) is not None
    leftover = await db_session.execute(
        select(NoteVisibilityGrantRow).where(
            NoteVisibilityGrantRow.note_id == uuid.UUID(str(gone["id"]))
        )
    )
    assert leftover.first() is None


async def test_deleting_the_document_deletes_its_notes(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note = await _note(
        client,
        room,
        document_id,
        room.owner,
        visibility="selective",
        selective_user_ids=[room.friend.id],
    )
    note_id = uuid.UUID(str(note["id"]))

    response = await client.delete(room.document_url(document_id), headers=room.owner.headers)

    assert response.status_code == 204
    db_session.expire_all()
    assert await db_session.get(NoteRow, note_id) is None
    grants = await db_session.execute(
        select(NoteVisibilityGrantRow).where(NoteVisibilityGrantRow.note_id == note_id)
    )
    assert grants.first() is None


async def test_a_new_note_goes_last_even_after_a_deletion(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    await _note(client, room, document_id, room.owner, title="A")
    middle = await _note(client, room, document_id, room.owner, title="B")
    await _note(client, room, document_id, room.owner, title="C")
    await client.delete(f"{room.notes_url(document_id)}/{middle['id']}", headers=room.owner.headers)

    created = await _note(client, room, document_id, room.owner, title="D")

    assert created["position"] == 3
    assert await _titles(client, room, document_id, room.owner) == ["A", "C", "D"]


async def test_a_document_cannot_have_more_than_the_note_limit(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    existing: list[object] = []
    for _ in range(MAX_NOTES_PER_DOCUMENT):
        note = plan_new_note(
            uuid.UUID(document_id),
            uuid.UUID(room.owner.id),
            "Filler",
            "",
            DocumentVisibility.MASTER,  # hidden from the Owner: the cap counts these too
            existing,  # type: ignore[arg-type]
            datetime.now(UTC),
        )
        await notes_repo.insert_note(db_session, note, [])
        existing.append(note)

    response = await client.post(
        room.notes_url(document_id), json={"title": "One too many"}, headers=room.owner.headers
    )

    assert response.status_code == 409


async def test_reordering_notes(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    a = await _note(client, room, document_id, room.owner, title="A")
    b = await _note(client, room, document_id, room.owner, title="B")
    c = await _note(client, room, document_id, room.owner, title="C")

    response = await client.put(
        f"{room.notes_url(document_id)}/order",
        json={"note_ids": [c["id"], a["id"], b["id"]]},
        headers=room.owner.headers,
    )

    assert response.status_code == 200
    assert [n["title"] for n in response.json()] == ["C", "A", "B"]
    assert [n["position"] for n in response.json()] == [0, 1, 2]
    assert await _titles(client, room, document_id, room.reader) == ["C", "A", "B"]


async def test_a_note_hidden_from_the_reorderer_keeps_its_place(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    a = await _note(client, room, document_id, room.owner, title="A")
    await _note(client, room, document_id, room.master, title="GM", visibility="master")
    b = await _note(client, room, document_id, room.owner, title="B")

    # The Owner sees A and B only, and doesn't know about "GM".
    response = await client.put(
        f"{room.notes_url(document_id)}/order",
        json={"note_ids": [b["id"], a["id"]]},
        headers=room.owner.headers,
    )

    assert [n["title"] for n in response.json()] == ["B", "A"]
    assert await _titles(client, room, document_id, room.master) == ["B", "GM", "A"]


async def test_the_order_must_be_exactly_the_notes_the_requester_sees(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    a = await _note(client, room, document_id, room.owner, title="A")
    await _note(client, room, document_id, room.owner, title="B")
    hidden = await _note(client, room, document_id, room.master, title="GM", visibility="master")
    url = f"{room.notes_url(document_id)}/order"

    for ids in ([a["id"]], [a["id"], a["id"]], [a["id"], hidden["id"]], [str(uuid.uuid4())]):
        response = await client.put(url, json={"note_ids": ids}, headers=room.owner.headers)
        assert response.status_code == 422, ids
    assert await _titles(client, room, document_id, room.master) == ["A", "B", "GM"]


async def test_selective_grantee_must_be_a_room_member_on_creation_too(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)

    response = await client.post(
        room.notes_url(document_id),
        json={
            "title": "Hi",
            "visibility": "selective",
            "selective_user_ids": [room.friend.id, room.friend.id],
        },
        headers=room.owner.headers,
    )

    # Repeated ids are harmless (dropped), not a 500.
    assert response.status_code == 201
    assert response.json()["selective_user_ids"] == [room.friend.id]

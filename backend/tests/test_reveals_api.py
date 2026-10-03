"""Reveal (spec 22, FR-V2, VR-06, UC-13), the "Revealed" badge, the visibility
history (FR-V5, VR-08) and the Room default visibility (VR-05), through the
API."""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import history as history_api
from app.db.models import AuditLogRow, MembershipRow, RevealRecipientRow
from app.main import app


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
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
    owner: _Member  # a Player who owns Documents they create
    alice: _Member
    bob: _Member

    @property
    def documents(self) -> str:
        return f"/rooms/{self.id}/documents"

    def document(self, document_id: str) -> str:
        return f"{self.documents}/{document_id}"


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
        alice=await _member(client, make_token, room["id"], master),
        bob=await _member(client, make_token, room["id"], master),
    )


async def _post(client: AsyncClient, url: str, by: _Member, **body: Any) -> dict[str, Any]:
    response = await client.post(url, json=body, headers=by.headers)
    assert response.status_code in (200, 201), response.text
    result: dict[str, Any] = response.json()
    return result


async def _document(
    client: AsyncClient, room: _Room, visibility: str = "master", by: _Member | None = None
) -> str:
    created = await _post(
        client, room.documents, by or room.master, name="Strahd", visibility=visibility
    )
    return str(created["id"])


async def _note(
    client: AsyncClient, room: _Room, document_id: str, visibility: str = "master"
) -> str:
    created = await _post(
        client,
        f"{room.document(document_id)}/notes",
        room.master,
        title="Secret",
        visibility=visibility,
    )
    return str(created["id"])


async def _mine(client: AsyncClient, member: _Member) -> list[dict[str, Any]]:
    response = await client.get("/reveals/mine", headers=member.headers)
    assert response.status_code == 200
    result: list[dict[str, Any]] = response.json()
    return result


async def _audit_actions(db_session: AsyncSession, room: _Room) -> list[str]:
    rows = await db_session.execute(
        select(AuditLogRow.action).where(AuditLogRow.room_id == uuid.UUID(room.id))
    )
    return sorted(rows.scalars())


async def test_revealing_a_document_with_one_of_its_notes(
    client: AsyncClient, make_token: Callable[..., str], db_session: AsyncSession
) -> None:
    """Definition of Done 1: Players see both marked "Revealed" and a count,
    which drops once they open the Document."""
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    carried = await _note(client, room, document_id)
    left_behind = await _note(client, room, document_id)

    revealed = await _post(
        client,
        f"{room.document(document_id)}/reveal",
        room.master,
        to_room=True,
        note_ids=[carried],
    )
    assert revealed["visibility"] == "room"
    assert {note["id"]: note["visibility"] for note in revealed["notes"]} == {
        carried: "room",
        left_behind: "master",
    }

    mine = await _mine(client, room.alice)
    assert {(r["kind"], r["note_id"]) for r in mine} == {("document", None), ("note", carried)}
    assert all(r["document_id"] == document_id and r["room_id"] == room.id for r in mine)
    # Nothing is revealed to the Master, who always saw it.
    assert await _mine(client, room.master) == []

    alice_view = (await client.get(room.document(document_id), headers=room.alice.headers)).json()
    assert [note["id"] for note in alice_view["notes"]] == [carried]

    visit = await _post(client, f"{room.document(document_id)}/read", room.alice)
    assert visit["revealed"] == {"document": True, "note_ids": [carried], "comment_ids": []}
    assert await _mine(client, room.alice) == []
    # Bob hasn't opened it yet; a second visit marks nothing again.
    assert len(await _mine(client, room.bob)) == 2
    again = await _post(client, f"{room.document(document_id)}/read", room.alice)
    assert again["revealed"] == {"document": False, "note_ids": [], "comment_ids": []}

    assert await _audit_actions(db_session, room) == ["document_revealed", "note_revealed"]


async def test_revealing_one_note_to_one_player(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    """Definition of Done 2: only that Player gets it."""
    room = await _room(client, make_token)
    document_id = await _document(client, room, visibility="room")
    note_id = await _note(client, room, document_id)

    response = await client.post(
        f"{room.document(document_id)}/notes/{note_id}/reveal",
        json={"user_ids": [room.alice.id]},
        headers=room.master.headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["visibility"] == "selective"
    assert response.json()["selective_user_ids"] == [room.alice.id]

    assert [r["note_id"] for r in await _mine(client, room.alice)] == [note_id]
    assert await _mine(client, room.bob) == []
    assert await _mine(client, room.owner) == []


async def test_a_note_on_a_hidden_document_reaches_nobody(
    client: AsyncClient, make_token: Callable[..., str], db_session: AsyncSession
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note_id = await _note(client, room, document_id)

    response = await client.post(
        f"{room.document(document_id)}/notes/{note_id}/reveal",
        json={"to_room": True},
        headers=room.master.headers,
    )
    assert response.status_code == 200
    rows = await db_session.execute(select(RevealRecipientRow))
    assert list(rows.scalars()) == []


async def test_only_the_master_reveals(client: AsyncClient, make_token: Callable[..., str]) -> None:
    room = await _room(client, make_token)
    shared = await _document(client, room, visibility="room")
    hidden = await _document(client, room)
    note_id = await _note(client, room, shared)
    comment = await _post(
        client, f"{room.document(shared)}/comments", room.alice, body="Hi", visibility="master"
    )

    async def status(url: str) -> int:
        response = await client.post(url, json={"to_room": True}, headers=room.owner.headers)
        return response.status_code

    assert await status(f"{room.document(shared)}/reveal") == 403
    assert await status(f"{room.document(shared)}/notes/{note_id}/reveal") == 404
    assert await status(f"{room.document(hidden)}/reveal") == 404
    assert await status(f"{room.document(shared)}/comments/{comment['id']}/reveal") == 404
    # Alice sees her own Comment, but isn't the Master.
    response = await client.post(
        f"{room.document(shared)}/comments/{comment['id']}/reveal",
        json={"to_room": True},
        headers=room.alice.headers,
    )
    assert response.status_code == 403
    room_note = await _note(client, room, shared, visibility="room")
    assert await status(f"{room.document(shared)}/notes/{room_note}/reveal") == 403
    assert await status(f"{room.document(str(uuid.uuid4()))}/reveal") == 404


async def test_a_reveal_only_widens(client: AsyncClient, make_token: Callable[..., str]) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    room_document = await _document(client, room, visibility="room")
    other_note = await _note(client, room, room_document)
    room_note = await _note(client, room, document_id, visibility="room")
    url = f"{room.document(document_id)}/reveal"

    async def status(target: str, **body: Any) -> int:
        response = await client.post(target, json=body, headers=room.master.headers)
        return response.status_code

    assert await status(f"{room.document(room_document)}/reveal", to_room=True) == 422
    assert await status(url) == 422
    assert await status(url, user_ids=[str(uuid.uuid4())]) == 422
    assert await status(url, to_room=True, note_ids=[other_note]) == 422
    assert await status(url, to_room=True, note_ids=[room_note]) == 422
    assert await status(f"{room.document(room_document)}/notes/{other_note}/reveal") == 422
    response = await client.post(
        f"{room.document(room_document)}/notes/{other_note}/reveal",
        json={"to_room": True},
        headers={**room.master.headers, "Accept-Language": "it"},
    )
    assert response.status_code == 200
    again = await client.post(
        f"{room.document(room_document)}/notes/{other_note}/reveal",
        json={"to_room": True},
        headers={**room.master.headers, "Accept-Language": "it"},
    )
    assert again.status_code == 422
    assert again.json()["detail"].startswith("Nessuno otterrebbe")


async def test_revealing_a_comment(
    client: AsyncClient, make_token: Callable[..., str], db_session: AsyncSession
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, visibility="room")
    comments = f"{room.document(document_id)}/comments"
    secret = await _post(client, comments, room.alice, body="I am a vampire", visibility="master")

    revealed = await _post(
        client, f"{comments}/{secret['id']}/reveal", room.master, user_ids=[room.bob.id]
    )
    assert revealed["visibility"] == "selective"
    assert revealed["selective_user_ids"] == [room.bob.id]
    assert [r["comment_id"] for r in await _mine(client, room.bob)] == [secret["id"]]
    # Alice wrote it: she always saw it.
    assert await _mine(client, room.alice) == []

    again = await client.post(
        f"{comments}/{secret['id']}/reveal",
        json={"user_ids": [room.bob.id]},
        headers=room.master.headers,
    )
    assert again.status_code == 422

    visit = await _post(client, f"{room.document(document_id)}/read", room.bob)
    assert visit["revealed"] == {"document": False, "note_ids": [], "comment_ids": [secret["id"]]}

    rows = await db_session.execute(
        select(AuditLogRow).where(AuditLogRow.action == "comment_revealed")
    )
    entry = rows.scalar_one()
    assert entry.target_user_id == uuid.UUID(room.alice.id)
    assert entry.details["recipient_ids"] == [room.bob.id]


async def test_a_deleted_comment_cant_be_revealed(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, visibility="room")
    comments = f"{room.document(document_id)}/comments"
    comment = await _post(client, comments, room.alice, body="Oops", visibility="master")
    await client.delete(f"{comments}/{comment['id']}", headers=room.alice.headers)

    response = await client.post(
        f"{comments}/{comment['id']}/reveal", json={"to_room": True}, headers=room.master.headers
    )
    assert response.status_code == 409


async def test_a_reply_cant_be_revealed_wider_than_its_parent(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, visibility="room")
    comments = f"{room.document(document_id)}/comments"
    parent = await _post(
        client,
        comments,
        room.alice,
        body="Bob?",
        visibility="selective",
        selective_user_ids=[room.bob.id],
    )
    reply = await _post(
        client, comments, room.bob, body="Yes", visibility="master", parent_id=parent["id"]
    )

    response = await client.post(
        f"{comments}/{reply['id']}/reveal", json={"to_room": True}, headers=room.master.headers
    )
    assert response.status_code == 422

    await _post(client, f"{comments}/{parent['id']}/reveal", room.master, to_room=True)
    await _post(client, f"{comments}/{reply['id']}/reveal", room.master, to_room=True)
    owner_view = (await client.get(comments, headers=room.owner.headers)).json()
    assert {c["id"] for c in owner_view} == {parent["id"], reply["id"]}


async def test_revealing_a_comment_restores_its_replies(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, visibility="room")
    comments = f"{room.document(document_id)}/comments"
    parent = await _post(client, comments, room.alice, body="Look", visibility="room")
    reply = await _post(client, comments, room.bob, body="Wow", parent_id=parent["id"])
    assert reply["visibility"] == "room"
    narrowed = await client.patch(
        f"{comments}/{parent['id']}", json={"visibility": "master"}, headers=room.alice.headers
    )
    assert narrowed.status_code == 200
    assert (await client.get(comments, headers=room.owner.headers)).json() == []

    await _post(client, f"{comments}/{parent['id']}/reveal", room.master, to_room=True)
    owner_view = (await client.get(comments, headers=room.owner.headers)).json()
    assert {c["id"] for c in owner_view} == {parent["id"], reply["id"]}
    # The owner is told about the Comment that was revealed, not the reply.
    assert [r["comment_id"] for r in await _mine(client, room.owner)] == [parent["id"]]


async def test_the_badge_drops_content_hidden_again(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    await _post(client, f"{room.document(document_id)}/reveal", room.master, to_room=True)
    assert len(await _mine(client, room.alice)) == 1

    hidden = await client.patch(
        room.document(document_id), json={"visibility": "master"}, headers=room.master.headers
    )
    assert hidden.status_code == 200
    assert await _mine(client, room.alice) == []

    # Revealed once more, it counts once.
    await _post(client, f"{room.document(document_id)}/reveal", room.master, to_room=True)
    assert len(await _mine(client, room.alice)) == 1


async def test_leaving_the_room_drops_unopened_reveals(
    client: AsyncClient, make_token: Callable[..., str], db_session: AsyncSession
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    await _post(client, f"{room.document(document_id)}/reveal", room.master, to_room=True)

    left = await client.delete(
        f"/rooms/{room.id}/members/{room.alice.id}", headers=room.alice.headers
    )
    assert left.status_code == 204
    rows = await db_session.execute(
        select(RevealRecipientRow).where(RevealRecipientRow.user_id == uuid.UUID(room.alice.id))
    )
    assert list(rows.scalars()) == []
    assert len(await _mine(client, room.bob)) == 1


async def test_reveals_of_a_room_left_since_are_not_listed(
    client: AsyncClient, make_token: Callable[..., str], db_session: AsyncSession
) -> None:
    # A recipient row that outlived the membership (written before this
    # cleanup existed) is ignored.
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    await _post(client, f"{room.document(document_id)}/reveal", room.master, to_room=True)
    await db_session.execute(
        delete(MembershipRow).where(MembershipRow.user_id == uuid.UUID(room.alice.id))
    )
    assert await _mine(client, room.alice) == []


async def test_a_document_visibility_change_is_audited(
    client: AsyncClient, make_token: Callable[..., str], db_session: AsyncSession
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, visibility="room", by=room.owner)
    await client.patch(
        room.document(document_id), json={"name": "Renamed"}, headers=room.owner.headers
    )
    assert await _audit_actions(db_session, room) == []

    response = await client.patch(
        room.document(document_id),
        json={"visibility": "selective", "selective_user_ids": [room.alice.id]},
        headers=room.owner.headers,
    )
    assert response.status_code == 200
    assert await _audit_actions(db_session, room) == ["document_visibility_changed"]


async def _history(
    client: AsyncClient, room: _Room, by: _Member, **params: str
) -> tuple[int, dict[str, Any]]:
    response = await client.get(f"/rooms/{room.id}/audit-log", params=params, headers=by.headers)
    return response.status_code, response.json()


async def test_the_history_lists_reveals_and_changes_newest_first(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    """Definition of Done 3, for the Master."""
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    note_id = await _note(client, room, document_id)
    await _post(
        client,
        f"{room.document(document_id)}/reveal",
        room.master,
        to_room=True,
        note_ids=[note_id],
    )
    await client.patch(
        f"{room.document(document_id)}/notes/{note_id}",
        json={"visibility": "private"},
        headers=room.master.headers,
    )

    status, page = await _history(client, room, room.master)
    assert status == 200
    assert page["next_before"] is None
    entries = page["entries"]
    assert [(e["kind"], e["is_reveal"]) for e in entries][0] == ("note", False)
    assert {(e["kind"], e["is_reveal"]) for e in entries[1:]} == {
        ("document", True),
        ("note", True),
    }
    document_entry = next(e for e in entries if e["kind"] == "document")
    assert document_entry["state"] == "visible"
    assert document_entry["document_name"] == "Strahd"
    assert document_entry["from_visibility"] == "master"
    assert document_entry["to_visibility"] == "room"
    assert document_entry["actor_id"] == room.master.id
    assert set(document_entry["recipient_ids"]) == {room.owner.id, room.alice.id, room.bob.id}
    note_entry = entries[0]
    assert note_entry["note_title"] == "Secret"
    assert note_entry["from_visibility"] == "room"
    assert note_entry["to_visibility"] == "private"

    status, documents_only = await _history(client, room, room.master, kind="document")
    assert [e["kind"] for e in documents_only["entries"]] == ["document"]


async def test_an_administrator_sees_hidden_content_unnamed(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    """Definition of Done 3, for an Administrator who isn't the Master
    (VR-07)."""
    room = await _room(client, make_token)
    promoted = await client.patch(
        f"/rooms/{room.id}/members/{room.alice.id}",
        json={"is_admin": True},
        headers=room.master.headers,
    )
    assert promoted.status_code == 200
    document_id = await _document(client, room)
    note_id = await _note(client, room, document_id)
    await _post(
        client,
        f"{room.document(document_id)}/notes/{note_id}/reveal",
        room.master,
        user_ids=[room.bob.id],
    )
    shown_id = await _document(client, room)
    await _post(client, f"{room.document(shown_id)}/reveal", room.master, user_ids=[room.alice.id])
    gone_id = await _document(client, room, visibility="room")
    await client.patch(
        room.document(gone_id), json={"visibility": "master"}, headers=room.master.headers
    )
    await client.delete(room.document(gone_id), headers=room.master.headers)

    status, page = await _history(client, room, room.alice)
    assert status == 200
    by_state = {e["state"]: e for e in page["entries"]}
    hidden = by_state["hidden"]
    assert hidden["kind"] == "note"
    assert hidden["document_id"] is None and hidden["document_name"] is None
    assert hidden["note_id"] is None and hidden["note_title"] is None
    assert hidden["recipient_ids"] == [] and hidden["selective_user_ids"] == []
    assert by_state["visible"]["document_name"] == "Strahd"
    assert by_state["deleted"]["document_name"] is None

    # The Master sees the Note's name.
    _, master_page = await _history(client, room, room.master, kind="note")
    assert master_page["entries"][0]["note_title"] == "Secret"


async def test_only_the_master_and_administrators_read_the_history(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    room = await _room(client, make_token)
    assert (await _history(client, room, room.bob))[0] == 403
    outsider = await _member(client, make_token, None, None)
    assert (await _history(client, room, outsider))[0] == 403


async def test_the_history_pages(
    client: AsyncClient, make_token: Callable[..., str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(history_api, "HISTORY_PAGE_SIZE", 2)
    room = await _room(client, make_token)
    for _ in range(3):
        document_id = await _document(client, room)
        await _post(client, f"{room.document(document_id)}/reveal", room.master, to_room=True)

    _, first = await _history(client, room, room.master)
    assert len(first["entries"]) == 2
    _, second = await _history(client, room, room.master, before=first["next_before"])
    assert len(second["entries"]) == 1
    assert second["next_before"] is None
    seen = {e["id"] for e in first["entries"]} | {e["id"] for e in second["entries"]}
    assert len(seen) == 3

    status, _ = await _history(client, room, room.master, before=str(uuid.uuid4()))
    assert status == 422


async def test_the_room_default_visibility(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    """Definition of Done 4: with the default at "Master only", a new
    Document, Note and Comment all start there; a reply keeps its parent's."""
    room = await _room(client, make_token)
    settings = await client.patch(
        f"/rooms/{room.id}", json={"default_visibility": "master"}, headers=room.master.headers
    )
    assert settings.status_code == 200
    assert settings.json()["default_visibility"] == "master"
    assert settings.json()["players_can_create_documents"] is True
    fetched = (await client.get(f"/rooms/{room.id}", headers=room.alice.headers)).json()
    assert fetched["default_visibility"] == "master"

    document = await _post(client, room.documents, room.master, name="Fresh")
    assert document["visibility"] == "master"
    note = await _post(client, f"{room.document(document['id'])}/notes", room.master, title="N")
    assert note["visibility"] == "master"
    shared = await _document(client, room, visibility="room")
    comments = f"{room.document(shared)}/comments"
    comment = await _post(client, comments, room.alice, body="Hi")
    assert comment["visibility"] == "master"
    explicit = await _post(client, comments, room.alice, body="Hey", visibility="room")
    reply = await _post(client, comments, room.bob, body="Ho", parent_id=explicit["id"])
    assert reply["visibility"] == "room"

    selective = await _post(
        client,
        comments,
        room.alice,
        body="Psst",
        visibility="selective",
        selective_user_ids=[room.bob.id],
    )
    inherited = await _post(client, comments, room.bob, body="Ok", parent_id=selective["id"])
    assert inherited["visibility"] == "selective"
    assert inherited["selective_user_ids"] == [room.bob.id]
    own_grants = await _post(
        client, comments, room.bob, body="Ok", parent_id=selective["id"], selective_user_ids=[]
    )
    assert own_grants["selective_user_ids"] == []


async def test_who_may_change_the_room_settings(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    room = await _room(client, make_token)
    url = f"/rooms/{room.id}"

    async def status(by: _Member, **body: Any) -> int:
        return (await client.patch(url, json=body, headers=by.headers)).status_code

    assert await status(room.alice, default_visibility="private") == 403
    assert await status(room.master, default_visibility="selective") == 422
    outsider = await _member(client, make_token, None, None)
    assert await status(outsider, default_visibility="private") == 403
    await client.patch(
        f"/rooms/{room.id}/members/{room.alice.id}",
        json={"is_admin": True},
        headers=room.master.headers,
    )
    assert await status(room.alice, default_visibility="private") == 200
    assert await status(room.alice, players_can_create_documents=False) == 403


async def test_history_of_a_deleted_documents_comment(
    client: AsyncClient, make_token: Callable[..., str]
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, visibility="room")
    comments = f"{room.document(document_id)}/comments"
    comment = await _post(client, comments, room.alice, body="Bye", visibility="master")
    await _post(client, f"{comments}/{comment['id']}/reveal", room.master, to_room=True)
    await client.delete(room.document(document_id), headers=room.master.headers)

    _, page = await _history(client, room, room.master, kind="comment")
    assert [(e["state"], e["comment_id"]) for e in page["entries"]] == [("deleted", None)]

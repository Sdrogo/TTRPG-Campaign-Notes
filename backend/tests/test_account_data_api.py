"""Spec 31: `GET /account/export` (the caller's personal data) and
`DELETE /account` (the account deletion)."""

import io
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import auth_admin
from app.db.models import (
    AuditLogRow,
    CommentReactionRow,
    DocumentOwnerRow,
    FriendCodeRow,
    FriendshipRow,
    MembershipRow,
    PostRow,
    RoomRow,
    UserRow,
)
from app.main import app


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture
def deleted_auth_users(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Stands in for Supabase Auth's admin API: records who was deleted."""
    deleted: list[str] = []

    async def fake_delete(user_id: str) -> None:
        deleted.append(user_id)

    monkeypatch.setattr(auth_admin, "delete_auth_user", fake_delete)
    return deleted


@dataclass
class _User:
    id: str
    headers: dict[str, str]


def _user(make_token: Callable[..., str], email: str | None = None) -> _User:
    user_id = str(uuid.uuid4())
    return _User(user_id, {"Authorization": f"Bearer {make_token(user_id, email=email)}"})


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (60, 40), color=(10, 200, 90)).save(buffer, format="PNG")
    return buffer.getvalue()


async def _room(client: AsyncClient, owner: _User, name: str) -> str:
    response = await client.post("/rooms", json={"name": name}, headers=owner.headers)
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _join(client: AsyncClient, room_id: str, admin: _User, member: _User) -> None:
    invite = (
        await client.post(
            f"/rooms/{room_id}/invitations", json={"role": "player"}, headers=admin.headers
        )
    ).json()
    response = await client.post(f"/invitations/{invite['code']}/accept", headers=member.headers)
    assert response.status_code in (200, 201), response.text


async def _document(client: AsyncClient, room_id: str, author: _User, name: str) -> str:
    response = await client.post(
        f"/rooms/{room_id}/documents", json={"name": name}, headers=author.headers
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _comment(
    client: AsyncClient, room_id: str, document_id: str, author: _User, body: str
) -> str:
    response = await client.post(
        f"/rooms/{room_id}/documents/{document_id}/comments",
        json={"body": body},
        headers=author.headers,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _befriend(client: AsyncClient, alice: _User, bob: _User) -> None:
    asked = await client.post("/friends/requests", json={"user_id": bob.id}, headers=alice.headers)
    assert asked.status_code == 201, asked.text
    friendship_id = asked.json()["friendship_id"]
    accepted = await client.post(f"/friends/requests/{friendship_id}/accept", headers=bob.headers)
    assert accepted.status_code == 200, accepted.text


async def _count(db_session: AsyncSession, model: type, *where: ColumnElement[bool]) -> int:
    result = await db_session.execute(select(func.count()).select_from(model).where(*where))
    return int(result.scalar_one())


_DELETE = {"confirmation": "DELETE"}


async def _delete_account(client: AsyncClient, user: _User, **headers: str) -> int:
    response = await client.request(
        "DELETE", "/account", json=_DELETE, headers={**user.headers, **headers}
    )
    return response.status_code


async def test_deletion_needs_the_confirmation_word(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    deleted_auth_users: list[str],
) -> None:
    user = _user(make_token)
    await _room(client, user, "Mine")
    response = await client.request(
        "DELETE", "/account", json={"confirmation": "delete"}, headers=user.headers
    )
    assert response.status_code == 422
    assert await _count(db_session, MembershipRow, MembershipRow.user_id == uuid.UUID(user.id))
    assert deleted_auth_users == []


async def test_deleting_erases_the_person_and_keeps_shared_content(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    deleted_auth_users: list[str],
) -> None:
    """Spec 31_1: the solo Room goes, the shared one is left (audited), what
    they wrote there stays, and every personal row and the avatar go."""
    master = _user(make_token)
    player = _user(make_token, email="player@example.com")
    player_id = uuid.UUID(player.id)
    shared = await _room(client, master, "Barovia")
    await _join(client, shared, master, player)
    solo = await _room(client, player, "Notes to self")
    await _document(client, solo, player, "Diary")

    document = await _document(client, shared, player, "Strahd")
    comment = await _comment(client, shared, document, player, "He watches.")
    master_comment = await _comment(client, shared, document, master, "Indeed.")
    reacted = await client.put(
        f"/rooms/{shared}/documents/{document}/comments/{master_comment}/reactions/%F0%9F%91%8D",
        headers=player.headers,
    )
    assert reacted.status_code in (200, 201, 204), reacted.text
    await _befriend(client, player, master)
    await client.post("/account/friend-code", headers=player.headers)
    avatar = await client.post(
        "/account/avatar", files={"file": ("me.png", _png(), "image/png")}, headers=player.headers
    )
    assert avatar.status_code == 200, avatar.text
    assert any(path.startswith("avatars/") for path in fake_storage)

    assert await _delete_account(client, player) == 204

    assert deleted_auth_users == [player.id]
    assert await db_session.get(RoomRow, uuid.UUID(solo)) is None
    assert await db_session.get(RoomRow, uuid.UUID(shared)) is not None
    assert not await _count(db_session, MembershipRow, MembershipRow.user_id == player_id)
    assert await _count(
        db_session,
        AuditLogRow,
        AuditLogRow.room_id == uuid.UUID(shared),
        AuditLogRow.action == "member_left",
        AuditLogRow.target_user_id == player_id,
    )
    kept = await db_session.get(PostRow, uuid.UUID(comment))
    assert kept is not None and kept.body == "He watches."
    assert await db_session.get(UserRow, player_id) is None
    for model, column in (
        (CommentReactionRow, CommentReactionRow.user_id),
        (DocumentOwnerRow, DocumentOwnerRow.user_id),
        (FriendCodeRow, FriendCodeRow.user_id),
    ):
        assert not await _count(db_session, model, column == player_id)
    assert not await _count(
        db_session,
        FriendshipRow,
        (FriendshipRow.user_low == player_id) | (FriendshipRow.user_high == player_id),
    )
    assert not any(path.startswith("avatars/") for path in fake_storage)

    # The others now see an unknown user where the player was.
    members = (await client.get(f"/rooms/{shared}/members", headers=master.headers)).json()
    assert player.id not in [member["user_id"] for member in members]


async def test_the_last_master_of_a_shared_room_must_hand_over_first(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    deleted_auth_users: list[str],
) -> None:
    """D-16: 409 naming the Room, and nothing is deleted."""
    master = _user(make_token)
    player = _user(make_token)
    shared = await _room(client, master, "Barovia")
    await _join(client, shared, master, player)
    solo = await _room(client, master, "Solo")

    response = await client.request(
        "DELETE", "/account", json=_DELETE, headers={**master.headers, "Accept-Language": "en"}
    )

    assert response.status_code == 409
    assert response.json()["detail"].endswith("in: Barovia")
    assert await db_session.get(RoomRow, uuid.UUID(solo)) is not None
    assert await db_session.get(UserRow, uuid.UUID(master.id)) is not None
    assert deleted_auth_users == []


async def test_a_failed_sign_in_deletion_is_reported_and_can_be_retried(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user(make_token)
    room = await _room(client, user, "Mine")
    calls: list[str] = []

    async def failing_delete(user_id: str) -> None:
        calls.append(user_id)
        if len(calls) == 1:
            raise auth_admin.AuthAdminError("down")

    monkeypatch.setattr(auth_admin, "delete_auth_user", failing_delete)

    assert await _delete_account(client, user) == 502
    # The data went anyway (committed before Auth was called).
    assert await db_session.get(RoomRow, uuid.UUID(room)) is None
    assert await _delete_account(client, user) == 204
    assert calls == [user.id, user.id]


async def test_export_holds_the_callers_data_and_nothing_hidden_from_them(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    """Spec 31_2: own Comments are always there; a Document's name only while
    the caller still sees it (Invariant 1)."""
    master = _user(make_token)
    player = _user(make_token, email="player@example.com")
    room = await _room(client, master, "Barovia")
    await _join(client, room, master, player)
    await client.patch("/account", json={"display_name": "Ireena"}, headers=player.headers)
    await client.patch("/account", json={"display_name": "The DM"}, headers=master.headers)

    open_doc = await _document(client, room, master, "Village")
    secret_doc = await _document(client, room, master, "Strahd's plan")
    mine = await _document(client, room, player, "My journal")
    await _comment(client, room, open_doc, player, "Hello")
    await _comment(client, room, secret_doc, player, "What is this?")
    hidden = await client.patch(
        f"/rooms/{room}/documents/{secret_doc}",
        json={"visibility": "master"},
        headers=master.headers,
    )
    assert hidden.status_code == 200, hidden.text
    await _befriend(client, player, master)

    response = await client.get("/account/export", headers=player.headers)

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["format_version"] == 1
    assert data["profile"]["email"] == "player@example.com"
    assert data["profile"]["display_name"] == "Ireena"
    assert [(r["name"], r["role"]) for r in data["rooms"]] == [("Barovia", "player")]
    assert [(d["name"], d["owner"], d["created_by_you"]) for d in data["documents"]] == [
        ("My journal", True, True)
    ]
    assert mine == data["documents"][0]["document_id"]
    by_body = {c["body"]: c for c in data["comments"]}
    assert by_body["Hello"]["document_name"] == "Village"
    assert by_body["What is this?"]["document_name"] is None
    assert "Strahd's plan" not in response.text
    assert [(f["display_name"], f["status"]) for f in data["friends"]] == [("The DM", "friend")]
    assert data["friend_code"] is None


async def test_export_of_a_user_with_nothing_yet(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    user = _user(make_token, email="new@example.com")
    data = (await client.get("/account/export", headers=user.headers)).json()
    assert data["profile"]["email"] == "new@example.com"
    assert data["profile"]["created_at"] is None
    assert data["rooms"] == data["comments"] == data["uploads"] == []

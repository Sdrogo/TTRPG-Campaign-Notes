import io
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import remote_images
from app.db.models import AuditLogRow
from app.domain.comments import MAX_IMAGES_PER_COMMENT
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
    player: _Member
    other_player: _Member

    def comments_url(self, document_id: str) -> str:
        return f"/rooms/{self.id}/documents/{document_id}/comments"


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
    player = await _member(client, make_token, room["id"], master)
    other_player = await _member(client, make_token, room["id"], master)
    return _Room(id=room["id"], master=master, player=player, other_player=other_player)


async def _document(client: AsyncClient, room: _Room, visibility: str = "room") -> str:
    response = await client.post(
        f"/rooms/{room.id}/documents",
        json={"name": "Castle Ravenloft", "visibility": visibility},
        headers=room.master.headers,
    )
    assert response.status_code == 201
    return str(response.json()["id"])


async def _comment(
    client: AsyncClient, room: _Room, document_id: str, author: _Member, **fields: object
) -> dict[str, object]:
    response = await client.post(
        room.comments_url(document_id),
        json={"body": "A cold wind blows.", **fields},
        headers=author.headers,
    )
    assert response.status_code == 201, response.text
    body: dict[str, object] = response.json()
    return body


async def test_member_comments_and_everyone_sees_it_in_order(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)

    first = await _comment(client, room, document_id, room.player, body="First!")
    await _comment(client, room, document_id, room.other_player, body="Second.")
    assert first["author_id"] == room.player.id
    assert first["visibility"] == "room"
    assert first["can_edit"] is True
    assert first["deleted"] is False

    listed = (
        await client.get(room.comments_url(document_id), headers=room.other_player.headers)
    ).json()
    assert [c["body"] for c in listed] == ["First!", "Second."]
    # The other Player sees the first Comment but can't edit or delete it.
    assert listed[0]["can_edit"] is False
    assert listed[0]["can_delete"] is False


async def test_blank_comment_is_rejected(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    response = await client.post(
        room.comments_url(document_id), json={"body": "   "}, headers=room.player.headers
    )
    assert response.status_code == 422


async def test_comments_on_a_hidden_document_are_unreachable(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, visibility="master")
    await _comment(client, room, document_id, room.master)

    listed = await client.get(room.comments_url(document_id), headers=room.player.headers)
    assert listed.status_code == 404
    posted = await client.post(
        room.comments_url(document_id), json={"body": "Hi"}, headers=room.player.headers
    )
    assert posted.status_code == 404


async def test_non_member_cannot_read_comments(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    outsider = await _member(client, make_token, None, None)
    response = await client.get(room.comments_url(document_id), headers=outsider.headers)
    assert response.status_code == 403


async def test_private_and_selective_comments_are_filtered_per_viewer(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    await _comment(client, room, document_id, room.player, body="Private", visibility="private")
    await _comment(
        client,
        room,
        document_id,
        room.player,
        body="Shared",
        visibility="selective",
        selective_user_ids=[room.other_player.id],
    )
    await _comment(client, room, document_id, room.player, body="GM only", visibility="master")

    async def bodies(member: _Member) -> list[str]:
        response = await client.get(room.comments_url(document_id), headers=member.headers)
        return [c["body"] for c in response.json()]

    assert await bodies(room.player) == ["Private", "Shared", "GM only"]
    assert await bodies(room.master) == ["Private", "Shared", "GM only"]
    assert await bodies(room.other_player) == ["Shared"]


async def test_selective_grant_to_non_member_is_rejected(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    response = await client.post(
        room.comments_url(document_id),
        json={"body": "Hi", "visibility": "selective", "selective_user_ids": [str(uuid.uuid4())]},
        headers=room.player.headers,
    )
    assert response.status_code == 422


async def test_only_author_can_edit_even_the_master_cannot(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment = await _comment(client, room, document_id, room.player)
    url = f"{room.comments_url(document_id)}/{comment['id']}"

    for intruder in (room.other_player, room.master):
        forbidden = await client.patch(url, json={"body": "Edited"}, headers=intruder.headers)
        assert forbidden.status_code == 403

    edited = await client.patch(url, json={"body": "Edited by me"}, headers=room.player.headers)
    assert edited.status_code == 200
    assert edited.json()["body"] == "Edited by me"
    assert edited.json()["updated_at"] > edited.json()["created_at"]


async def test_visibility_change_is_audited_in_the_same_transaction(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment = await _comment(client, room, document_id, room.player)
    url = f"{room.comments_url(document_id)}/{comment['id']}"

    await client.patch(url, json={"body": "Only the text"}, headers=room.player.headers)
    edited = await client.patch(url, json={"visibility": "private"}, headers=room.player.headers)
    assert edited.status_code == 200

    entries = (
        (
            await db_session.execute(
                select(AuditLogRow).where(
                    AuditLogRow.room_id == uuid.UUID(room.id),
                    AuditLogRow.action == "comment_visibility_changed",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(entries) == 1
    assert entries[0].details["from"] == "room"
    assert entries[0].details["to"] == "private"

    # ... and the Comment is now gone for the other Player.
    listed = (
        await client.get(room.comments_url(document_id), headers=room.other_player.headers)
    ).json()
    assert listed == []
    hidden = await client.patch(url, json={"body": "x"}, headers=room.other_player.headers)
    assert hidden.status_code == 404


async def test_master_can_delete_any_comment_leaving_a_placeholder(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment = await _comment(client, room, document_id, room.player, body="Spoiler!")
    url = f"{room.comments_url(document_id)}/{comment['id']}"

    forbidden = await client.delete(url, headers=room.other_player.headers)
    assert forbidden.status_code == 403

    deleted = await client.delete(url, headers=room.master.headers)
    assert deleted.status_code == 204

    listed = (await client.get(room.comments_url(document_id), headers=room.player.headers)).json()
    assert len(listed) == 1
    assert listed[0]["deleted"] is True
    assert listed[0]["body"] == ""
    assert listed[0]["can_edit"] is False

    again = await client.delete(url, headers=room.player.headers)
    assert again.status_code == 409


async def test_author_can_delete_own_comment(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment = await _comment(client, room, document_id, room.player)
    response = await client.delete(
        f"{room.comments_url(document_id)}/{comment['id']}", headers=room.player.headers
    )
    assert response.status_code == 204


async def test_comment_from_another_document_is_not_found(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    other_document_id = await _document(client, room)
    comment = await _comment(client, room, document_id, room.player)
    response = await client.patch(
        f"{room.comments_url(other_document_id)}/{comment['id']}",
        json={"body": "x"},
        headers=room.player.headers,
    )
    assert response.status_code == 404


# --- Comment images (feature 04) -----------------------------------------


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (60, 40), color=(120, 40, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


async def _attach(
    client: AsyncClient, room: _Room, document_id: str, comment_id: object, member: _Member
) -> Response:
    return await client.post(
        f"{room.comments_url(document_id)}/{comment_id}/images",
        files={"file": ("sketch.png", _png(), "image/png")},
        headers=member.headers,
    )


async def _attached_image_id(
    client: AsyncClient, room: _Room, document_id: str, comment_id: object, member: _Member
) -> str:
    response = await _attach(client, room, document_id, comment_id, member)
    assert response.status_code == 201, response.text
    return str(response.json()["images"][-1]["id"])


async def _gallery_ids(
    client: AsyncClient, room: _Room, document_id: str, member: _Member
) -> list[str]:
    response = await client.get(f"/rooms/{room.id}/documents/{document_id}", headers=member.headers)
    return [image["id"] for image in response.json()["images"]]


async def test_author_attaches_image_and_it_joins_the_document_gallery(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment = await _comment(client, room, document_id, room.player)

    response = await _attach(client, room, document_id, comment["id"], room.player)
    assert response.status_code == 201, response.text
    images = response.json()["images"]
    assert len(images) == 1
    assert len(fake_storage) == 1

    # Shown on the Comment and in the Document gallery to whoever sees the Comment.
    listed = (
        await client.get(room.comments_url(document_id), headers=room.other_player.headers)
    ).json()
    assert listed[0]["images"] == images
    assert await _gallery_ids(client, room, document_id, room.other_player) == [images[0]["id"]]


async def test_only_the_author_can_attach_images(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment = await _comment(client, room, document_id, room.player)

    for intruder in (room.other_player, room.master):
        response = await _attach(client, room, document_id, comment["id"], intruder)
        assert response.status_code == 403
    assert fake_storage == {}


async def test_comment_image_limit_returns_conflict(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment = await _comment(client, room, document_id, room.player)

    for _ in range(MAX_IMAGES_PER_COMMENT):
        await _attached_image_id(client, room, document_id, comment["id"], room.player)
    over = await _attach(client, room, document_id, comment["id"], room.player)
    assert over.status_code == 409


async def test_private_comment_image_is_hidden_from_the_gallery_of_others(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment = await _comment(client, room, document_id, room.player, visibility="private")
    image_id = await _attached_image_id(client, room, document_id, comment["id"], room.player)

    assert await _gallery_ids(client, room, document_id, room.player) == [image_id]
    assert await _gallery_ids(client, room, document_id, room.master) == [image_id]
    assert await _gallery_ids(client, room, document_id, room.other_player) == []
    listing = (
        await client.get(f"/rooms/{room.id}/documents", headers=room.other_player.headers)
    ).json()
    assert listing[0]["images"] == []
    # ... and they can't delete it through the gallery either.
    hidden = await client.delete(
        f"/rooms/{room.id}/documents/{document_id}/images/{image_id}",
        headers=room.other_player.headers,
    )
    assert hidden.status_code in (403, 404)


async def test_deleting_a_comment_removes_its_images(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment = await _comment(client, room, document_id, room.player)
    await _attached_image_id(client, room, document_id, comment["id"], room.player)

    deleted = await client.delete(
        f"{room.comments_url(document_id)}/{comment['id']}", headers=room.master.headers
    )
    assert deleted.status_code == 204
    assert fake_storage == {}
    assert await _gallery_ids(client, room, document_id, room.master) == []
    listed = (await client.get(room.comments_url(document_id), headers=room.player.headers)).json()
    assert listed[0]["images"] == []


async def test_author_detaches_an_image(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment = await _comment(client, room, document_id, room.player)
    image_id = await _attached_image_id(client, room, document_id, comment["id"], room.player)
    url = f"{room.comments_url(document_id)}/{comment['id']}/images/{image_id}"

    assert (await client.delete(url, headers=room.other_player.headers)).status_code == 403
    assert (await client.delete(url, headers=room.player.headers)).status_code == 204
    assert fake_storage == {}
    assert (await client.delete(url, headers=room.player.headers)).status_code == 404


async def test_document_owner_can_remove_a_comment_image_from_the_gallery(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room)
    comment = await _comment(client, room, document_id, room.player)
    image_id = await _attached_image_id(client, room, document_id, comment["id"], room.player)

    response = await client.delete(
        f"/rooms/{room.id}/documents/{document_id}/images/{image_id}",
        headers=room.master.headers,
    )
    assert response.status_code == 204
    listed = (await client.get(room.comments_url(document_id), headers=room.player.headers)).json()
    assert listed[0]["images"] == []


async def test_comment_image_can_be_imported_from_url(
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
    document_id = await _document(client, room)
    comment = await _comment(client, room, document_id, room.player)

    response = await client.post(
        f"{room.comments_url(document_id)}/{comment['id']}/images/from-url",
        json={"url": "https://example.com/map.png"},
        headers=room.player.headers,
    )
    assert response.status_code == 201, response.text
    assert len(response.json()["images"]) == 1

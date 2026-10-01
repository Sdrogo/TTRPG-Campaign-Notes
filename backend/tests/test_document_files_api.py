import uuid
from collections.abc import AsyncIterator, Callable, Collection
from dataclasses import dataclass
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import storage, storage_cleanup
from app.db.models import StorageCleanupRow
from app.domain.files import MAX_FILE_BYTES, MAX_FILES_PER_DOCUMENT
from app.main import app

PDF = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@dataclass
class Room:
    id: str
    master: dict[str, str]
    player: dict[str, str]
    player_id: str

    def document_url(self, document_id: str) -> str:
        return f"/rooms/{self.id}/documents/{document_id}"

    def files_url(self, document_id: str) -> str:
        return f"{self.document_url(document_id)}/files"


async def _room(client: AsyncClient, make_token: Callable[..., str]) -> Room:
    master = _auth_headers(make_token(str(uuid.uuid4())))
    room = (await client.post("/rooms", json={"name": "Barovia"}, headers=master)).json()
    invite = (
        await client.post(
            f"/rooms/{room['id']}/invitations", json={"role": "player"}, headers=master
        )
    ).json()
    player_id = str(uuid.uuid4())
    player = _auth_headers(make_token(player_id))
    await client.post(f"/invitations/{invite['code']}/accept", headers=player)
    return Room(id=room["id"], master=master, player=player, player_id=player_id)


async def _document(
    client: AsyncClient, room: Room, headers: dict[str, str], visibility: str = "room"
) -> str:
    response = await client.post(
        f"/rooms/{room.id}/documents",
        json={"name": "Ireena", "visibility": visibility},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _upload(
    client: AsyncClient,
    room: Room,
    document_id: str,
    headers: dict[str, str],
    data: bytes = PDF,
    name: str = "Ireena sheet.pdf",
) -> tuple[int, dict[str, object]]:
    response = await client.post(
        room.files_url(document_id),
        files={"file": (name, data, "application/pdf")},
        headers=headers,
    )
    return response.status_code, response.json() if response.content else {}


async def _files(
    client: AsyncClient, room: Room, document_id: str, headers: dict[str, str]
) -> list[dict[str, object]]:
    response = await client.get(room.document_url(document_id), headers=headers)
    assert response.status_code == 200, response.text
    files: list[dict[str, object]] = response.json()["files"]
    return files


async def _cleanup_rows(session: AsyncSession, paths: Collection[str]) -> list[str]:
    result = await session.execute(
        select(StorageCleanupRow.storage_path).where(StorageCleanupRow.storage_path.in_(paths))
    )
    return list(result.scalars())


def _after_grace() -> datetime:
    return datetime.now(UTC) + 2 * storage_cleanup.SWEEP_GRACE


async def test_master_uploads_a_pdf_and_every_reader_of_the_document_gets_it(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, room.master)

    status_code, body = await _upload(client, room, document_id, room.master)
    assert status_code == 201, body

    (path,) = fake_storage
    # Stored as uploaded, under a random name - not the file's own.
    assert fake_storage[path] == PDF
    assert path.startswith(f"documents/{document_id}/files/")
    assert path.endswith(".pdf")
    assert "Ireena" not in path

    assert body["document_id"] == document_id
    assert body["name"] == "Ireena sheet.pdf"
    assert body["size_bytes"] == len(PDF)
    assert body["content_type"] == "application/pdf"
    assert body["can_delete"] is True
    # A signed link that makes Storage serve it as a download (D-22).
    assert body["url"] == f"https://signed.test/{path}?token=t&download=Ireena%20sheet.pdf"

    # VR-12: a Player who sees the Document sees its files, but can't remove
    # them.
    (seen,) = await _files(client, room, document_id, room.player)
    assert seen["id"] == body["id"]
    assert seen["url"] == body["url"]
    assert seen["can_delete"] is False
    (as_master,) = await _files(client, room, document_id, room.master)
    assert as_master["can_delete"] is True


async def test_a_player_attaches_a_sheet_to_their_own_document(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    # The use case of spec 16: a Player's PC sheet on the PC's Document.
    room = await _room(client, make_token)
    document_id = await _document(client, room, room.player)

    status_code, body = await _upload(client, room, document_id, room.player)
    assert status_code == 201, body
    assert body["uploaded_by"] == room.player_id
    assert body["can_delete"] is True
    assert len(fake_storage) == 1


async def test_files_keep_upload_order(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, room.master)
    for name in ("one.pdf", "two.pdf", "three.pdf"):
        status_code, _ = await _upload(client, room, document_id, room.master, name=name)
        assert status_code == 201

    files = await _files(client, room, document_id, room.master)
    assert [file["name"] for file in files] == ["one.pdf", "two.pdf", "three.pdf"]


async def test_a_player_who_does_not_own_the_document_cannot_upload(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, room.master)

    status_code, _ = await _upload(client, room, document_id, room.player)
    assert status_code == 403
    assert fake_storage == {}


async def test_a_non_member_cannot_upload(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, room.master)
    outsider = _auth_headers(make_token(str(uuid.uuid4())))

    status_code, _ = await _upload(client, room, document_id, outsider)
    assert status_code == 403
    assert fake_storage == {}


async def test_a_hidden_document_has_no_files_to_reach(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    # VR-12: no visible Attachment on a hidden Document - and 404, not 403,
    # so the status doesn't reveal the Document exists (VR-07).
    room = await _room(client, make_token)
    document_id = await _document(client, room, room.master, visibility="master")
    status_code, body = await _upload(client, room, document_id, room.master)
    assert status_code == 201

    response = await client.get(room.document_url(document_id), headers=room.player)
    assert response.status_code == 404
    status_code, _ = await _upload(client, room, document_id, room.player)
    assert status_code == 404
    response = await client.delete(
        f"{room.files_url(document_id)}/{body['id']}", headers=room.player
    )
    assert response.status_code == 404
    assert len(fake_storage) == 1


async def test_bytes_that_are_not_a_pdf_are_refused_despite_the_name(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, room.master)

    status_code, body = await _upload(
        client, room, document_id, room.master, data=b"<html><script>alert(1)</script>"
    )
    assert status_code == 422
    assert body["detail"] == "The file is not a PDF"
    assert fake_storage == {}


async def test_a_file_over_ten_megabytes_is_refused(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, room.master)

    status_code, body = await _upload(
        client,
        room,
        document_id,
        room.master,
        data=PDF + b"0" * MAX_FILE_BYTES,
    )
    assert status_code == 413
    assert body["detail"] == "The file exceeds the 10 MB limit"
    assert fake_storage == {}


async def test_the_eleventh_file_is_refused(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, room.master)
    for _ in range(MAX_FILES_PER_DOCUMENT):
        status_code, _ = await _upload(client, room, document_id, room.master)
        assert status_code == 201

    response = await client.post(
        room.files_url(document_id),
        files={"file": ("one-more.pdf", PDF, "application/pdf")},
        headers={**room.master, "Accept-Language": "it"},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Un Documento può avere al massimo 10 file"
    assert len(fake_storage) == MAX_FILES_PER_DOCUMENT


async def test_an_owner_removes_a_file(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, room.player)
    _, kept = await _upload(client, room, document_id, room.player, name="kept.pdf")
    _, removed = await _upload(client, room, document_id, room.player, name="removed.pdf")
    removed_path = next(path for path in fake_storage if str(removed["url"]).find(path) != -1)

    response = await client.delete(
        f"{room.files_url(document_id)}/{removed['id']}", headers=room.player
    )
    assert response.status_code == 204

    assert [file["id"] for file in await _files(client, room, document_id, room.player)] == [
        kept["id"]
    ]
    # The object goes once the transaction has committed.
    assert removed_path not in fake_storage
    assert len(fake_storage) == 1
    assert await _cleanup_rows(db_session, [removed_path]) == []


async def test_the_master_removes_a_players_file_but_another_player_cannot(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, room.player)
    _, body = await _upload(client, room, document_id, room.player)
    file_url = f"{room.files_url(document_id)}/{body['id']}"

    invite = (
        await client.post(
            f"/rooms/{room.id}/invitations", json={"role": "player"}, headers=room.master
        )
    ).json()
    other = _auth_headers(make_token(str(uuid.uuid4())))
    await client.post(f"/invitations/{invite['code']}/accept", headers=other)

    assert (await client.delete(file_url, headers=other)).status_code == 403
    assert len(fake_storage) == 1
    assert (await client.delete(file_url, headers=room.master)).status_code == 204
    assert fake_storage == {}


async def test_removing_a_file_that_is_not_on_the_document_is_404(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    first = await _document(client, room, room.master)
    second = await _document(client, room, room.master)
    _, body = await _upload(client, room, first, room.master)

    # Another Document's file, and an id that doesn't exist at all.
    for url in (
        f"{room.files_url(second)}/{body['id']}",
        f"{room.files_url(first)}/{uuid.uuid4()}",
    ):
        response = await client.delete(url, headers=room.master)
        assert response.status_code == 404
        assert response.json()["detail"] == "File not found"
    assert len(fake_storage) == 1


async def test_deleting_the_document_removes_its_files_from_storage(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, room.master)
    other_id = await _document(client, room, room.master)
    await _upload(client, room, document_id, room.master)
    await _upload(client, room, document_id, room.master)
    await _upload(client, room, other_id, room.master)
    (other_path,) = [path for path in fake_storage if other_id in path]

    response = await client.delete(room.document_url(document_id), headers=room.master)
    assert response.status_code == 204
    assert set(fake_storage) == {other_path}


async def test_deleting_the_room_removes_every_file_from_storage(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    for headers in (room.master, room.player):
        document_id = await _document(client, room, headers)
        status_code, _ = await _upload(client, room, document_id, headers)
        assert status_code == 201
    assert len(fake_storage) == 2

    response = await client.delete(f"/rooms/{room.id}", headers=room.master)
    assert response.status_code == 204
    assert fake_storage == {}


async def test_the_sweep_never_removes_a_file_in_use(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, room.master)
    await _upload(client, room, document_id, room.master)
    (path,) = fake_storage

    # A stray cleanup row for a path a file still points at.
    await storage_cleanup.record_pending_upload(path)
    await storage_cleanup.sweep(db_session, now=_after_grace())

    assert path in fake_storage
    assert await _cleanup_rows(db_session, [path]) == []


async def test_an_upload_storage_refuses_is_a_502_and_records_nothing(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, room.master)

    async def storage_down(path: str, data: bytes, content_type: str) -> None:
        raise storage.StorageError("Storage unavailable")

    monkeypatch.setattr(storage, "upload", storage_down)
    status_code, body = await _upload(client, room, document_id, room.master)
    assert status_code == 502
    assert body["detail"] == "File storage is unavailable"
    assert await _files(client, room, document_id, room.master) == []


async def test_an_upload_that_cannot_be_signed_is_rolled_back_and_swept(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    room = await _room(client, make_token)
    document_id = await _document(client, room, room.master)

    async def cannot_sign(paths: Collection[str], expires_in: int) -> dict[str, str]:
        return {}

    monkeypatch.setattr(storage, "create_signed_urls", cannot_sign)
    status_code, _ = await _upload(client, room, document_id, room.master)
    assert status_code == 502

    # The object reached Storage but no row points at it: still marked, so
    # the sweep removes the orphan.
    (orphan,) = fake_storage
    assert await _cleanup_rows(db_session, [orphan]) == [orphan]
    await storage_cleanup.sweep(db_session, now=_after_grace())
    assert fake_storage == {}

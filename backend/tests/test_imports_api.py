"""Importing Documents from files (spec 27): the preview, the background job
and what it writes, against the rules of creating a Document by hand (D-12,
D-13, VR-07, NFR-01, Invariant 1). Remote image fetching is replaced by a fake
that serves the app's own signed links and a few test URLs; the SSRF guard has
its own tests (`test_remote_images.py`)."""

import io
import json
import uuid
from collections.abc import AsyncIterator, Callable, Coroutine, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import imports
from app.config import settings
from app.db import import_jobs_repo, remote_images, storage
from app.db.export_jobs_repo import sweep as sweep_export_jobs
from app.db.models import ImportJobRow
from app.domain.imports import ImportJob, ImportStatus
from app.domain.mentions import MentionKind, find_mentions
from app.main import app


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _headers(make_token: Callable[..., str], user_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(user_id)}"}


def _png(color: tuple[int, int, int] = (120, 40, 200)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (60, 40), color=color).save(buffer, format="PNG")
    return buffer.getvalue()


@dataclass
class _Room:
    id: str
    url: str
    master: dict[str, str]
    master_id: str
    player: dict[str, str]
    player_id: str
    other: dict[str, str]
    outsider: dict[str, str]


async def _room(
    client: AsyncClient, make_token: Callable[..., str], name: str = "Barovia"
) -> _Room:
    master_id, player_id, other_id, outsider_id = (str(uuid.uuid4()) for _ in range(4))
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
    return _Room(
        room["id"],
        f"/rooms/{room['id']}",
        master,
        master_id,
        joined[0],
        player_id,
        joined[1],
        _headers(make_token, outsider_id),
    )


async def _second_room(client: AsyncClient, room: _Room, name: str = "Ravenloft") -> _Room:
    """Another Room of the same Master, with no one else in it."""
    other = (await client.post("/rooms", json={"name": name}, headers=room.master)).json()
    return _Room(
        other["id"],
        f"/rooms/{other['id']}",
        room.master,
        room.master_id,
        room.player,
        room.player_id,
        room.other,
        room.outsider,
    )


async def _post(client: AsyncClient, url: str, headers: dict[str, str], **body: Any) -> Any:
    response = await client.post(url, json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _documents(
    client: AsyncClient, room: _Room, headers: dict[str, str] | None = None
) -> Any:
    response = await client.get(f"{room.url}/documents", headers=headers or room.master)
    assert response.status_code == 200, response.text
    return {d["name"]: d for d in response.json()}


async def _detail(client: AsyncClient, room: _Room, document_id: str) -> Any:
    response = await client.get(f"{room.url}/documents/{document_id}", headers=room.master)
    assert response.status_code == 200, response.text
    return response.json()


async def _tags(client: AsyncClient, room: _Room) -> Any:
    response = await client.get(f"{room.url}/tags", headers=room.master)
    return {t["name"]: t for t in response.json()}


@pytest.fixture
def served(monkeypatch: pytest.MonkeyPatch, fake_storage: dict[str, bytes]) -> dict[str, Any]:
    """Replaces the remote image fetch: the app's own signed links are read
    from the fake Storage, the URLs a test registers are served, anything else
    is unreachable. The `calls` entry lists every URL asked for."""
    urls: dict[str, Any] = {"calls": []}

    async def fake_fetch(url: str, transport: Any = None) -> bytes:
        urls["calls"].append(url)
        if url.startswith("https://signed.test/"):
            path = url.removeprefix("https://signed.test/").split("?")[0]
            if path in fake_storage:
                return fake_storage[path]
            raise remote_images.RemoteImageError("errors.image.remoteHttpStatus", status=404)
        if url in urls:
            return bytes(urls[url])
        raise remote_images.RemoteImageError("errors.image.remoteDownloadFailed")

    monkeypatch.setattr(remote_images, "fetch_image_bytes", fake_fetch)
    return urls


@pytest.fixture
def inline_jobs(monkeypatch: pytest.MonkeyPatch) -> None:
    """Runs a job before the request that started it returns."""

    async def inline(coroutine: Coroutine[Any, Any, None]) -> None:
        await coroutine

    monkeypatch.setattr(imports, "spawn", inline)


@pytest.fixture
def held_jobs(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[Coroutine[Any, Any, None]]]:
    """Keeps started jobs from running until the test runs them."""
    held: list[Coroutine[Any, Any, None]] = []

    async def hold(coroutine: Coroutine[Any, Any, None]) -> None:
        held.append(coroutine)

    monkeypatch.setattr(imports, "spawn", hold)
    yield held
    for coroutine in held:
        coroutine.close()


def _upload(*files: tuple[str, bytes]) -> list[tuple[str, tuple[str, bytes, str]]]:
    return [("files", (name, data, "application/octet-stream")) for name, data in files]


async def _preview(
    client: AsyncClient, room: _Room, headers: dict[str, str], *files: tuple[str, bytes]
) -> Response:
    return await client.post(f"{room.url}/imports/preview", files=_upload(*files), headers=headers)


async def _start(
    client: AsyncClient,
    room: _Room,
    headers: dict[str, str],
    files: tuple[tuple[str, bytes], ...],
    selected: list[str] | None = None,
    replace: list[str] | None = None,
) -> Response:
    if selected is None:
        preview = await _preview(client, room, headers, *files)
        assert preview.status_code == 200, preview.text
        selected = [d["key"] for d in preview.json()["documents"]]
    return await client.post(
        f"{room.url}/imports",
        files=_upload(*files),
        data={"choices": json.dumps({"selected": selected, "replace": replace or []})},
        headers=headers,
    )


async def _import(
    client: AsyncClient,
    room: _Room,
    headers: dict[str, str],
    *files: tuple[str, bytes],
    selected: list[str] | None = None,
    replace: list[str] | None = None,
) -> Any:
    """Imports the files and returns the finished job."""
    started = await _start(client, room, headers, files, selected, replace)
    assert started.status_code == 202, started.text
    job = await client.get(f"{room.url}/imports/{started.json()['id']}", headers=headers)
    assert job.status_code == 200, job.text
    return job.json()


async def _export(
    client: AsyncClient, room: _Room, headers: dict[str, str], export_format: str, path: str = ""
) -> bytes:
    response = await client.get(
        f"{room.url}{path}/export", params={"format": export_format}, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.content


async def _seed(client: AsyncClient, room: _Room) -> dict[str, Any]:
    """Room A: a Tag of its own, linked Documents, Notes, a Comment, a
    Character link, a Selective Document and an image."""
    tags = await _tags(client, room)
    faction = await _post(client, f"{room.url}/tags", room.master, name="Faction", category="Group")
    lair = await _post(
        client, f"{room.url}/documents", room.master, name="Lair", visibility="master"
    )
    castle = await _post(
        client,
        f"{room.url}/documents",
        room.master,
        name="Castle",
        tag_ids=[tags["NPC"]["id"], faction["id"]],
        description=(
            f"A dark keep under #[Lair](doc:{lair['id']}) of #[Faction](tag:{faction['id']}) "
            f"and #[Gone](doc:{uuid.uuid4()})."
        ),
    )
    base = f"{room.url}/documents/{castle['id']}"
    await _post(
        client,
        f"{base}/notes",
        room.master,
        title="Rumor",
        description=f"In town, near #[Lair](doc:{lair['id']})",
    )
    await _post(
        client,
        f"{base}/notes",
        room.master,
        title="Truth",
        description="Lives",
        visibility="master",
    )
    await _post(client, f"{base}/comments", room.player, body="Hello there")
    await client.put(
        f"{base}/player",
        json={"user_id": room.player_id, "add_as_owner": True},
        headers=room.master,
    )
    await _post(
        client,
        f"{room.url}/documents",
        room.master,
        name="Cellar",
        visibility="selective",
        selective_user_ids=[room.player_id],
    )
    uploaded = await client.post(
        f"{base}/images",
        files={"file": ("a.png", _png(), "image/png")},
        headers=room.master,
    )
    assert uploaded.status_code == 201, uploaded.text
    return {"castle": castle, "lair": lair, "faction": faction}


# --- the whole Room, into another Room --------------------------------------------


@pytest.mark.parametrize("export_format", ["json", "md"])
async def test_a_room_export_is_imported_into_another_room(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    inline_jobs: None,
    export_format: str,
) -> None:
    room = await _room(client, make_token)
    await _seed(client, room)
    target = await _second_room(client, room)
    exported = await _export(client, room, room.master, export_format)

    preview = await _preview(client, target, target.master, (f"room.{export_format}", exported))
    assert preview.status_code == 200, preview.text
    found = {d["name"]: d for d in preview.json()["documents"]}
    assert set(found) == {"Castle", "Lair", "Cellar"}
    assert found["Castle"]["notes_count"] == 2 and found["Castle"]["images_count"] == 1
    assert found["Castle"]["existing_document_id"] is None
    assert {w["code"] for w in found["Castle"]["warnings"]} >= {"comments_dropped"}
    assert {w["code"] for w in found["Cellar"]["warnings"]} == {"selective_to_private"}
    assert [t["name"] for t in preview.json()["tags_to_create"]] == ["Faction"]
    assert "NPC" in preview.json()["matched_tags"]
    # Nothing is written or fetched by a preview.
    assert await _documents(client, target) == {}
    assert served["calls"] == []

    job = await _import(client, target, target.master, (f"room.{export_format}", exported))

    assert job["status"] == "done"
    assert {d["name"] for d in job["result"]["created"]} == {"Castle", "Lair", "Cellar"}
    assert job["result"]["replaced"] == [] and job["result"]["skipped"] == []
    documents = await _documents(client, target)
    castle = await _detail(client, target, documents["Castle"]["id"])
    tags = await _tags(client, target)
    assert "Faction" in tags
    assert set(castle["tag_ids"]) == {tags["NPC"]["id"], tags["Faction"]["id"]}
    # The Markdown file doesn't say a Note's level: it starts at the Room's.
    truth = "master" if export_format == "json" else "room"
    assert [(n["title"], n["visibility"]) for n in castle["notes"]] == [
        ("Rumor", "room"),
        ("Truth", truth),
    ]
    # Re-pointed inside the file, plain outside it (Decision 14).
    mentions = find_mentions(castle["description"])
    assert [(m.kind, m.target_id) for m in mentions] == [
        (MentionKind.DOCUMENT, uuid.UUID(documents["Lair"]["id"])),
        (MentionKind.TAG, uuid.UUID(tags["Faction"]["id"])),
    ]
    assert "#Gone" in castle["description"]
    # Only the information: the importer owns it, nobody plays it, no Comments.
    assert castle["owner_ids"] == [target.master_id]
    assert castle["played_by"] is None
    assert documents["Lair"]["visibility"] == "master"
    assert documents["Cellar"]["visibility"] == "private"
    assert documents["Cellar"]["selective_user_ids"] == []
    comments = await client.get(
        f"{target.url}/documents/{castle['id']}/comments", headers=target.master
    )
    assert comments.json() == []
    assert len(castle["images"]) == 1 and castle["images"][0]["is_favorite"]
    # Backlinks and history were written like for any edit.
    backlinks = await client.get(
        f"{target.url}/documents/{documents['Lair']['id']}/backlinks", headers=target.master
    )
    assert [g["document_name"] for g in backlinks.json()] == ["Castle"]
    versions = await client.get(
        f"{target.url}/documents/{castle['id']}/versions", headers=target.master
    )
    assert len(versions.json()) == 1 and versions.json()[0]["edited_by"] == target.master_id
    # The job keeps no content once it has ended (Decision 17).
    row = await db_session.get(ImportJobRow, uuid.UUID(job["id"]))
    assert row is not None and row.payload is None


async def test_a_single_document_export_is_copied_or_replaced_in_its_own_room(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    seeded = await _seed(client, room)
    castle_id = seeded["castle"]["id"]
    exported = await _export(client, room, room.master, "json", f"/documents/{castle_id}")

    # The Document is still here: the preview says so and offers Replace.
    preview = (await _preview(client, room, room.master, ("castle.json", exported))).json()
    (found,) = preview["documents"]
    assert found["existing_document_id"] == castle_id and found["can_replace"]

    # Copy: a second Document, the original untouched; its mention of the
    # Document that is not in the file is plain text.
    copied = await _import(client, room, room.master, ("castle.json", exported))
    (copy,) = copied["result"]["created"]
    assert copy["id"] != castle_id
    listed = (await client.get(f"{room.url}/documents", headers=room.master)).json()
    assert [d["name"] for d in listed].count("Castle") == 2
    assert "#Lair" in (await _detail(client, room, copy["id"]))["description"]

    # Replace: name, description, Tags and Notes are the file's; everything
    # else stays (Decision 6).
    edited = json.loads(exported)
    document = edited["documents"][0]
    document["name"] = "Castle Ravenloft"
    document["description"] = "Rewritten."
    document["tag_ids"] = []
    document["notes"] = [{"title": "Only note", "description": "New", "visibility": "room"}]
    versions_before = (
        await client.get(f"{room.url}/documents/{castle_id}/versions", headers=room.master)
    ).json()
    served["calls"].clear()

    replaced = await _import(
        client, room, room.master, ("castle.json", json.dumps(edited).encode()), replace=["0:0"]
    )

    assert replaced["result"]["created"] == []
    assert [d["id"] for d in replaced["result"]["replaced"]] == [castle_id]
    after = await _detail(client, room, castle_id)
    assert (after["name"], after["description"], after["tag_ids"]) == (
        "Castle Ravenloft",
        "Rewritten.",
        [],
    )
    assert [n["title"] for n in after["notes"]] == ["Only note"]
    assert set(after["owner_ids"]) == {room.master_id, room.player_id}
    assert after["played_by"] == room.player_id
    assert after["visibility"] == "room"
    comments = await client.get(f"{room.url}/documents/{castle_id}/comments", headers=room.master)
    assert [c["body"] for c in comments.json()] == ["Hello there"]
    # The image the Document still has is not fetched again.
    assert len(after["images"]) == 1 and served["calls"] == []
    # One new revision, so the replace can be undone (Decision 16).
    versions = (
        await client.get(f"{room.url}/documents/{castle_id}/versions", headers=room.master)
    ).json()
    assert len(versions) == len(versions_before) + 1
    restored = await client.post(
        f"{room.url}/documents/{castle_id}/versions/{versions_before[0]['id']}/restore",
        headers=room.master,
    )
    assert restored.status_code == 200, restored.text
    assert (await _detail(client, room, castle_id))["name"] == "Castle"


# --- who may do what ----------------------------------------------------------------


def _json_file(*documents: dict[str, Any], **extra: Any) -> tuple[str, bytes]:
    return "hand.json", json.dumps({"documents": list(documents), **extra}).encode()


async def test_a_player_imports_a_hand_written_markdown_of_two_documents(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    served["https://img.test/p.png"] = _png()
    markdown = (
        b"# Ireena\nTags: NPC, Faction\n\nA villager.\n\n![p](https://img.test/p.png)\n"
        b"## Secret\nShe knows.\n\n# Barovia\n\nA valley.\n"
    )

    job = await _import(client, room, room.player, ("notes.md", markdown))

    assert job["status"] == "done"
    documents = await _documents(client, room, room.player)
    assert set(documents) == {"Ireena", "Barovia"}
    ireena = documents["Ireena"]
    # The importer owns the copies (D-12); the Room's default visibility.
    assert ireena["owner_ids"] == [room.player_id]
    assert ireena["visibility"] == "room"
    tags = await _tags(client, room)
    # A Player can't create Tags (as POST /tags): "Faction" is dropped.
    assert "Faction" not in tags
    assert ireena["tag_ids"] == [tags["NPC"]["id"]]
    assert len(ireena["images"]) == 1
    detail = (await client.get(f"{room.url}/documents/{ireena['id']}", headers=room.player)).json()
    assert [n["title"] for n in detail["notes"]] == ["Secret"]
    preview = (await _preview(client, room, room.player, ("notes.md", markdown))).json()
    warnings = {w["code"]: w for d in preview["documents"] for w in d["warnings"]}
    assert warnings["tags_not_created"]["names"] == ["Faction"]
    assert preview["unavailable_tags"] == ["Faction"]


async def test_a_player_cannot_replace_a_document_they_do_not_manage(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    mine = await _post(client, f"{room.url}/documents", room.player, name="Mine", description="old")
    theirs = await _post(client, f"{room.url}/documents", room.master, name="Theirs")
    files = (
        _json_file(
            {"id": mine["id"], "name": "Mine", "description": "new"},
            {"id": theirs["id"], "name": "Theirs", "description": "overwritten"},
        ),
    )

    preview = (await _preview(client, room, room.player, *files)).json()
    can = {d["name"]: d["can_replace"] for d in preview["documents"]}
    assert can == {"Mine": True, "Theirs": False}

    refused = await _start(client, room, room.player, files, replace=["0:0", "0:1"])
    assert refused.status_code == 403, refused.text
    assert (await _detail(client, room, theirs["id"]))["description"] == ""
    assert (await _detail(client, room, mine["id"]))["description"] == "old"

    job = await _import(client, room, room.player, *files, selected=["0:0", "0:1"], replace=["0:0"])
    assert (await _detail(client, room, mine["id"]))["description"] == "new"
    assert (await _detail(client, room, theirs["id"]))["description"] == ""
    assert [d["name"] for d in job["result"]["replaced"]] == ["Mine"]
    assert [d["name"] for d in job["result"]["created"]] == ["Theirs"]


async def test_only_someone_who_may_create_documents_imports(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    held_jobs: list[Coroutine[Any, Any, None]],
) -> None:
    room = await _room(client, make_token)
    files = (_json_file({"name": "A"}),)

    assert (await _preview(client, room, room.outsider, *files)).status_code == 403
    assert (await _start(client, room, room.outsider, files, ["0:0"])).status_code == 403
    off = await client.patch(
        room.url, json={"players_can_create_documents": False}, headers=room.master
    )
    assert off.status_code == 200, off.text
    assert (await _preview(client, room, room.player, *files)).status_code == 403
    assert (await _start(client, room, room.player, files, ["0:0"])).status_code == 403
    assert (await _preview(client, room, room.master, *files)).status_code == 200
    assert held_jobs == []


async def test_a_preview_as_a_member_is_refused_like_every_write(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    # Spec 22b: the header makes every write a 403.
    room = await _room(client, make_token)
    headers = {**room.master, "X-View-As": room.player_id}
    files = (_json_file({"name": "A"}),)

    assert (await _preview(client, room, headers, *files)).status_code == 403
    assert (await _start(client, room, headers, files, ["0:0"])).status_code == 403


# --- refused with nothing written ---------------------------------------------------


async def test_a_file_that_is_refused_writes_nothing(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    held_jobs: list[Coroutine[Any, Any, None]],
) -> None:
    room = await _room(client, make_token)
    many = [{"name": f"D{i}"} for i in range(201)]
    images = {"name": "I", "images": [{"url": f"https://x.test/{i}.png"} for i in range(201)]}
    cases = {
        "too big": (("big.json", b"{" + b" " * (5 * 1024 * 1024)), 413),
        "not json": (("bad.json", b"{oops"), 422),
        "not utf-8": (("bad.md", b"\xff\xfe\x00"), 422),
        "newer schema": (_json_file({"name": "A"}, schema_version=4), 422),
        "no document": (("empty.json", b'{"documents": []}'), 422),
        "too many documents": (_json_file(*many), 422),
        "too many images": (_json_file(images), 422),
        "no name": (_json_file({"name": " "}), 422),
        "too many notes": (_json_file({"name": "N", "notes": [{"title": "t"}] * 51}), 422),
    }

    for label, (file, expected) in cases.items():
        preview = await _preview(client, room, room.master, file)
        assert preview.status_code == expected, (label, preview.text)
        started = await _start(client, room, room.master, (file,), ["0:0"])
        assert started.status_code == expected, (label, started.text)
    too_many_files = tuple(_json_file({"name": f"F{i}"}) for i in range(11))
    assert (await _preview(client, room, room.master, *too_many_files)).status_code == 422

    assert await _documents(client, room) == {}
    assert held_jobs == []
    assert (await db_session.scalars(select(ImportJobRow))).all() == []


async def test_the_choices_must_be_valid_and_select_something(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    held_jobs: list[Coroutine[Any, Any, None]],
) -> None:
    room = await _room(client, make_token)
    files = _upload(_json_file({"name": "A"}))

    bad = await client.post(
        f"{room.url}/imports", files=files, data={"choices": "{nope"}, headers=room.master
    )
    assert bad.status_code == 422
    empty = await _start(client, room, room.master, (_json_file({"name": "A"}),), [])
    assert empty.status_code == 422
    assert held_jobs == []


# --- the job ----------------------------------------------------------------------------


async def test_one_import_at_a_time_and_a_job_is_its_requesters_alone(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    held_jobs: list[Coroutine[Any, Any, None]],
) -> None:
    room = await _room(client, make_token)
    other_room = await _second_room(client, room)
    files = (_json_file({"name": "A"}),)

    first = await _start(client, room, room.master, files, ["0:0"])
    assert first.status_code == 202, first.text
    job_id = first.json()["id"]
    assert first.json()["status"] == "queued" and first.json()["result"] is None
    second = await _start(client, room, room.master, files, ["0:0"])
    assert second.status_code == 409
    # Someone else, or another Room, can still import.
    assert (await _start(client, room, room.player, files, ["0:0"])).status_code == 202
    assert (await _start(client, other_room, other_room.master, files, ["0:0"])).status_code == 202

    # Not the requester's, not this Room's: a 404.
    assert (
        await client.get(f"{room.url}/imports/{job_id}", headers=room.player)
    ).status_code == 404
    assert (
        await client.get(f"{other_room.url}/imports/{job_id}", headers=room.master)
    ).status_code == 404
    assert (
        await client.get(f"{room.url}/imports/{job_id}", headers=room.outsider)
    ).status_code == 403
    assert (
        await client.get(f"{room.url}/imports/{uuid.uuid4()}", headers=room.master)
    ).status_code == 404

    # The stored payload holds the parsed content, never the upload.
    row = await db_session.get(ImportJobRow, uuid.UUID(job_id))
    assert row is not None and row.status == "queued"
    assert row.payload is not None and "documents" in json.dumps(row.payload)

    # Run: the queue drains one by one, and the first job is done.
    for coroutine in list(held_jobs):
        await coroutine
    held_jobs.clear()
    done = (await client.get(f"{room.url}/imports/{job_id}", headers=room.master)).json()
    assert done["status"] == "done" and done["finished_at"] is not None
    # The Master can import again once it is over.
    assert (await _start(client, room, room.master, files, ["0:0"])).status_code == 202


async def test_a_job_fails_when_the_importer_left_the_room_before_it_started(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    held_jobs: list[Coroutine[Any, Any, None]],
) -> None:
    room = await _room(client, make_token)
    started = await _start(client, room, room.player, (_json_file({"name": "A"}),), ["0:0"])
    job_id = started.json()["id"]
    removed = await client.delete(f"{room.url}/members/{room.player_id}", headers=room.master)
    assert removed.status_code in (200, 204), removed.text

    await held_jobs.pop()

    row = await db_session.get(ImportJobRow, uuid.UUID(job_id))
    assert row is not None
    await db_session.refresh(row)
    assert (row.status, row.error, row.payload) == ("failed", "refused", None)
    assert await _documents(client, room) == {}


async def test_a_job_fails_when_players_can_no_longer_create_documents(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    held_jobs: list[Coroutine[Any, Any, None]],
) -> None:
    room = await _room(client, make_token)
    started = await _start(client, room, room.player, (_json_file({"name": "A"}),), ["0:0"])
    await client.patch(room.url, json={"players_can_create_documents": False}, headers=room.master)

    await held_jobs.pop()

    job = (
        await client.get(f"{room.url}/imports/{started.json()['id']}", headers=room.player)
    ).json()
    assert job["status"] == "failed"
    assert await _documents(client, room) == {}


async def test_an_unexpected_failure_leaves_nothing_and_fails_the_job(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    inline_jobs: None,
) -> None:
    # Any failure of the write marks the job failed (Decision 9; the
    # transaction itself rolls back, which the shared test session can't show).
    room = await _room(client, make_token)
    file = _json_file({"name": "A", "tag_ids": ["t"]}, tags=[{"id": "t", "name": "Brand new"}])
    from app.db import imports_repo

    async def failing(*args: Any) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(imports_repo, "insert_copies", failing)

    started = await _start(client, room, room.master, (file,), ["0:0"])

    job = (
        await client.get(f"{room.url}/imports/{started.json()['id']}", headers=room.master)
    ).json()
    assert job["status"] == "failed"


async def test_a_job_that_is_not_queued_is_left_alone(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    from app.api.import_job import run_import_job

    await _room(client, make_token)

    await run_import_job(uuid.uuid4())  # unknown: nothing happens, nothing raised


# --- the images --------------------------------------------------------------------------


async def test_an_image_that_fails_is_skipped_and_listed_and_the_rest_is_imported(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    served["https://img.test/ok.png"] = _png()
    served["https://img.test/text.png?token=secret"] = b"not an image at all"
    served["https://img.test/also.png"] = _png((10, 200, 10))
    images = [
        {"id": "1", "url": "https://img.test/gone.png"},
        {"id": "2", "url": "https://img.test/text.png?token=secret"},
        {"id": "3", "url": "https://img.test/ok.png", "is_favorite": True},
        {"id": "4", "url": "https://img.test/also.png"},
    ]
    file = _json_file({"name": "Gallery", "images": images})

    job = await _import(client, room, room.master, file)

    assert job["status"] == "done"
    skipped = {s["url"]: s["reason"] for s in job["result"]["skipped"]}
    assert skipped == {
        "https://img.test/gone.png": "unreachable",
        "https://img.test/text.png": "not_an_image",
    }
    gallery = await _detail(client, room, job["result"]["created"][0]["id"])
    assert len(gallery["images"]) == 2
    # The file's favorite was stored first, so it is the Document's.
    assert [i["is_favorite"] for i in gallery["images"]] == [True, False]


_OWN_STORAGE = "https://own.supabase.test"


@pytest.fixture
def own_bucket(monkeypatch: pytest.MonkeyPatch) -> Callable[[str], str]:
    """Makes `_OWN_STORAGE` this app's Supabase and returns how to write a
    signed link of one of its objects whose token has long expired (the fake
    fetch can't serve it: only a read straight from Storage can)."""
    monkeypatch.setattr(settings, "supabase_url", _OWN_STORAGE)

    def link(path: str) -> str:
        return f"{_OWN_STORAGE}/storage/v1/object/sign/{settings.storage_bucket}/{path}?token=old"

    return link


async def _image_on(
    client: AsyncClient, room: _Room, fake_storage: dict[str, bytes], **document: Any
) -> str:
    """Creates a Document with one image as the Master; returns its object path."""
    created = await _post(client, f"{room.url}/documents", room.master, **document)
    before = set(fake_storage)
    uploaded = await client.post(
        f"{room.url}/documents/{created['id']}/images",
        files={"file": ("a.png", _png(), "image/png")},
        headers=room.master,
    )
    assert uploaded.status_code == 201, uploaded.text
    (path,) = set(fake_storage) - before
    return path


async def test_an_expired_link_of_our_own_storage_is_read_straight_from_storage(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    own_bucket: Callable[[str], str],
    inline_jobs: None,
) -> None:
    # An export's links live an hour at most; a backup imported later still
    # brings its images when the importer sees them (product owner, 2026-10-08).
    room = await _room(client, make_token)
    path = await _image_on(client, room, fake_storage, name="Castle")
    target = await _second_room(client, room)
    file = _json_file(
        {"name": "Castle", "images": [{"url": own_bucket(path), "is_favorite": True}]}
    )

    job = await _import(client, target, target.master, file)

    assert job["status"] == "done"
    assert job["result"]["skipped"] == []
    assert served["calls"] == []
    castle = await _detail(client, target, job["result"]["created"][0]["id"])
    assert len(castle["images"]) == 1 and castle["images"][0]["is_favorite"] is True


async def test_an_image_the_importer_cannot_see_is_not_read_from_storage(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    own_bucket: Callable[[str], str],
    inline_jobs: None,
) -> None:
    # A Master-only Document's image, a Room the importer isn't in, an object
    # no image points at: none of them is read with the backend's key, only
    # fetched by its link, which has expired (Invariant 1).
    room = await _room(client, make_token)
    hidden = await _image_on(client, room, fake_storage, name="Secret", visibility="master")
    elsewhere = await _second_room(client, room)
    foreign = await _image_on(client, elsewhere, fake_storage, name="Foreign")
    links = [own_bucket(hidden), own_bucket(foreign), own_bucket(f"{room.id}/nothing/here.webp")]
    file = _json_file({"name": "Copy", "images": [{"url": url} for url in links]})

    job = await _import(client, room, room.player, file)

    assert [s["reason"] for s in job["result"]["skipped"]] == ["unreachable"] * 3
    assert sorted(served["calls"]) == sorted(links)


async def test_a_comment_image_the_importer_cannot_read_is_not_read_from_storage(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    own_bucket: Callable[[str], str],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    document = await _post(client, f"{room.url}/documents", room.master, name="Hall")
    comment = await _post(
        client,
        f"{room.url}/documents/{document['id']}/comments",
        room.master,
        body="For my eyes",
        visibility="master",
    )
    before = set(fake_storage)
    uploaded = await client.post(
        f"{room.url}/documents/{document['id']}/comments/{comment['id']}/images",
        files={"file": ("a.png", _png(), "image/png")},
        headers=room.master,
    )
    assert uploaded.status_code == 201, uploaded.text
    (path,) = set(fake_storage) - before

    job = await _import(
        client,
        room,
        room.player,
        _json_file({"name": "Copy", "images": [{"url": own_bucket(path)}]}),
    )

    assert [s["reason"] for s in job["result"]["skipped"]] == ["unreachable"]
    assert served["calls"] == [own_bucket(path)]


async def test_a_storage_read_that_fails_falls_back_to_the_link(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    own_bucket: Callable[[str], str],
    monkeypatch: pytest.MonkeyPatch,
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    path = await _image_on(client, room, fake_storage, name="Castle")
    served[own_bucket(path)] = _png()

    async def down(path: str, max_bytes: int) -> bytes:
        raise storage.StorageError("Storage answered 503")

    monkeypatch.setattr(storage, "download", down)

    job = await _import(
        client,
        room,
        room.master,
        _json_file({"name": "Copy", "images": [{"url": own_bucket(path)}]}),
    )

    # The link was still served, so the image came that way.
    assert job["result"]["skipped"] == []
    assert served["calls"] == [own_bucket(path)]


async def test_a_private_address_in_a_file_is_never_fetched(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    inline_jobs: None,
) -> None:
    # The real fetch, no fake: the SSRF guard of the existing pipeline refuses
    # the address before any connection (Decision 15).
    room = await _room(client, make_token)
    file = _json_file({"name": "Bad", "images": [{"url": "http://127.0.0.1:9/x.png"}]})

    job = await _import(client, room, room.master, file)

    assert job["status"] == "done"
    assert [s["reason"] for s in job["result"]["skipped"]] == ["unreachable"]
    created = await _detail(client, room, job["result"]["created"][0]["id"])
    assert created["images"] == []


async def test_images_over_the_documents_cap_are_skipped(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    for index in range(22):
        served[f"https://img.test/{index}.png"] = _png((index, 0, 0))
    document = {
        "name": "Many",
        "images": [{"url": f"https://img.test/{i}.png"} for i in range(22)],
    }
    other = {"name": "Other", "images": [{"url": "https://img.test/0.png"}]}

    # 23 images are over the import's 200 only when counted across files; the
    # per-Document cap of 20 is what stops this one.
    job = await _import(client, room, room.master, _json_file(document, other))

    many = await _detail(
        client, room, next(d["id"] for d in job["result"]["created"] if d["name"] == "Many")
    )
    assert len(many["images"]) == 20
    assert [s["reason"] for s in job["result"]["skipped"]] == ["limit", "limit"]


async def test_an_image_whose_document_is_gone_is_dropped(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    inline_jobs: None,
) -> None:
    from app.api import import_job
    from app.db import documents_repo

    room = await _room(client, make_token)
    served["https://img.test/a.png"] = _png()
    original = import_job._store_image

    async def delete_first(*args: Any) -> uuid.UUID | str | None:
        await documents_repo.delete_document(db_session, args[2].id)
        return await original(*args)

    monkeypatch.setattr(import_job, "_store_image", delete_first)

    job = await _import(
        client,
        room,
        room.master,
        _json_file({"name": "A", "images": [{"url": "https://img.test/a.png"}]}),
    )

    assert job["status"] == "done" and job["result"]["skipped"] == []


async def test_a_storage_failure_skips_the_image(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    inline_jobs: None,
) -> None:
    from app.db import storage

    room = await _room(client, make_token)
    served["https://img.test/a.png"] = _png()

    async def down(path: str, data: bytes, content_type: str) -> None:
        raise storage.StorageError("down")

    monkeypatch.setattr(storage, "upload", down)

    job = await _import(
        client,
        room,
        room.master,
        _json_file({"name": "A", "images": [{"url": "https://img.test/a.png"}]}),
    )

    assert [s["reason"] for s in job["result"]["skipped"]] == ["storage"]


async def test_an_unexpected_error_while_attaching_an_image_skips_it(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    inline_jobs: None,
) -> None:
    from app.db import documents_repo

    room = await _room(client, make_token)
    served["https://img.test/a.png"] = _png()

    async def broken(*args: Any) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(documents_repo, "insert_image", broken)

    job = await _import(
        client,
        room,
        room.master,
        _json_file({"name": "A", "images": [{"url": "https://img.test/a.png"}]}),
    )

    assert job["status"] == "done"
    assert [s["reason"] for s in job["result"]["skipped"]] == ["failed"]


async def test_an_oversize_image_is_skipped(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    inline_jobs: None,
) -> None:
    from app.api import import_job
    from app.domain.images import ImageTooLargeError

    room = await _room(client, make_token)
    served["https://img.test/a.png"] = _png()

    def too_large(data: bytes) -> Any:
        raise ImageTooLargeError("errors.image.tooLarge", mb=20)

    monkeypatch.setattr(import_job, "normalize_image", too_large)

    job = await _import(
        client,
        room,
        room.master,
        _json_file({"name": "A", "images": [{"url": "https://img.test/a.png"}]}),
    )

    assert [s["reason"] for s in job["result"]["skipped"]] == ["too_large"]


# --- housekeeping -----------------------------------------------------------------------


async def test_the_sweep_fails_old_active_imports_and_deletes_finished_ones(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)
    now = datetime.now(UTC)

    def job(status: ImportStatus, created: datetime, finished: datetime | None) -> ImportJob:
        return ImportJob(
            id=uuid.uuid4(),
            room_id=uuid.UUID(room.id),
            requested_by=uuid.uuid4(),
            status=status,
            payload={"files": []} if finished is None else None,
            result=None,
            error=None,
            created_at=created,
            finished_at=finished,
        )

    stale = job(ImportStatus.RUNNING, now - timedelta(hours=1), None)
    fresh = job(ImportStatus.QUEUED, now - timedelta(minutes=1), None)
    old = job(ImportStatus.DONE, now - timedelta(days=9), now - timedelta(days=8))
    recent = job(ImportStatus.DONE, now - timedelta(days=2), now - timedelta(days=1))
    for item in (stale, fresh):
        assert await import_jobs_repo.insert_job(db_session, item)
    for item in (old, recent):
        db_session.add(
            ImportJobRow(
                id=item.id,
                room_id=item.room_id,
                requested_by=item.requested_by,
                status=item.status.value,
                payload=None,
                result={"created": [], "replaced": [], "skipped": []},
                error=None,
                created_at=item.created_at,
                finished_at=item.finished_at,
            )
        )
    await db_session.flush()

    await sweep_export_jobs(db_session)
    db_session.expire_all()

    assert (await import_jobs_repo.get_job(db_session, old.id)) is None
    assert (await import_jobs_repo.get_job(db_session, recent.id)) is not None
    failed = await import_jobs_repo.get_job(db_session, stale.id)
    assert failed is not None
    assert (failed.status, failed.error, failed.payload) == (ImportStatus.FAILED, "stale", None)
    assert (await import_jobs_repo.get_job(db_session, fresh.id)).status is ImportStatus.QUEUED  # type: ignore[union-attr]
    # Starting up fails everything still active.
    assert await import_jobs_repo.fail_active(db_session, "interrupted", now) == 1
    # A finished job keeps its outcome.
    await import_jobs_repo.mark_failed(db_session, recent.id, "late", now)
    assert (await import_jobs_repo.get_job(db_session, recent.id)).status is ImportStatus.DONE  # type: ignore[union-attr]
    assert not await import_jobs_repo.mark_done(db_session, stale.id, {}, now)


async def test_a_failure_to_record_the_failure_is_only_logged(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from app.api import import_job

    async def broken(*args: Any) -> None:
        raise RuntimeError("db down")

    monkeypatch.setattr(import_jobs_repo, "mark_failed", broken)

    await import_job._fail(uuid.uuid4(), "failed")

    assert "Could not mark import" in caplog.text


# --- maps (spec 40) -------------------------------------------------------------


async def _maps(client: AsyncClient, room: _Room, headers: dict[str, str] | None = None) -> Any:
    response = await client.get(f"{room.url}/maps", headers=headers or room.master)
    assert response.status_code == 200, response.text
    return {m["name"]: m for m in response.json()}


async def _seed_maps(
    client: AsyncClient, room: _Room, db_session: AsyncSession, fake_storage: dict[str, bytes]
) -> dict[str, Any]:
    """Room A's maps: a Selective free map with a group, a Document card that
    chose its second image, a hidden Document's card, a Master-only text card
    and arrows, shown on the Castle's page; a geographic map with a
    background, an area, a pin and a link; and the Castle's mention map."""
    seeded = await _seed(client, room)
    castle, lair = seeded["castle"], seeded["lair"]
    docs = f"{room.url}/documents"
    second = await client.post(
        f"{docs}/{castle['id']}/images",
        files={"file": ("b.png", _png((1, 2, 3)), "image/png")},
        headers=room.master,
    )
    assert second.status_code == 201, second.text
    chosen = next(i["id"] for i in second.json()["images"] if not i["is_favorite"])
    court = await _post(
        client,
        f"{room.url}/maps",
        room.master,
        name="Court",
        visibility="selective",
        selective_user_ids=[room.player_id],
    )
    group, castle_card, lair_card, note_card = (str(uuid.uuid4()) for _ in range(4))
    board = await client.put(
        f"{room.url}/maps/{court['id']}/board",
        json={
            "groups": [{"id": group, "title": "Keep", "x": 0, "y": 0, "width": 400, "height": 300}],
            "cards": [
                {
                    "id": castle_card,
                    "document_id": castle["id"],
                    "image_id": chosen,
                    "group_id": group,
                    "caption": "Home",
                    "x": 10,
                    "y": 10,
                },
                {"id": lair_card, "document_id": lair["id"], "x": 600, "y": 0},
                {"id": note_card, "text": "Trap", "master_only": True, "x": 0, "y": 500},
            ],
            "arrows": [
                {
                    "id": str(uuid.uuid4()),
                    "from_end": {"card_id": castle_card},
                    "to_end": {"card_id": lair_card},
                    "direction": "both",
                    "label": "rules",
                    "reverse_label": "serves",
                },
                {
                    "id": str(uuid.uuid4()),
                    "from_end": {"group_id": group},
                    "to_end": {"card_id": note_card},
                },
            ],
        },
        headers=room.master,
    )
    assert board.status_code == 200, board.text
    linked = await client.put(
        f"{docs}/{castle['id']}/linked-map", json={"map_id": court["id"]}, headers=room.master
    )
    assert linked.status_code == 200, linked.text
    valley = await _post(
        client,
        f"{room.url}/maps",
        room.master,
        name="Valley",
        kind="geographic",
        visibility="room",
        plane_width=1000,
        plane_height=800,
    )
    area, pin = str(uuid.uuid4()), str(uuid.uuid4())
    geo = await client.put(
        f"{room.url}/maps/{valley['id']}/geo",
        json={
            "areas": [
                {
                    "id": area,
                    "document_id": castle["id"],
                    "points": [[10, 10], [300, 10], [300, 300]],
                    "color": "red",
                }
            ],
            "pins": [{"id": pin, "name": "Crossroads", "note": "Fog", "x": 500, "y": 500}],
            "links": [
                {
                    "id": str(uuid.uuid4()),
                    "from_end": {"area_id": area},
                    "to_end": {"pin_id": pin},
                    "bend": 30,
                    "label": "road",
                }
            ],
        },
        headers=room.master,
    )
    assert geo.status_code == 200, geo.text
    background = await client.post(
        f"{room.url}/maps/{valley['id']}/background",
        files={"file": ("bg.png", _png((9, 9, 9)), "image/png")},
        headers=room.master,
    )
    assert background.status_code == 200, background.text
    mention = await client.post(
        f"{docs}/{castle['id']}/mention-map", json={"depth": 0}, headers=room.master
    )
    assert mention.status_code == 201, mention.text
    return {**seeded, "court": court, "valley": valley, "chosen": chosen}


async def test_a_room_export_carries_its_maps_into_another_room(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    inline_jobs: None,
) -> None:
    """Spec 40 Decisions 6 to 15: the JSON export holds the free and
    geographic maps (not the mention map); importing it recreates them around
    the imported Documents, with the chosen image, the background, the link to
    the Castle's page, and Selective turned Private."""
    room = await _room(client, make_token)
    seeded = await _seed_maps(client, room, db_session, fake_storage)
    target = await _second_room(client, room)
    exported = await _export(client, room, room.master, "json")
    data = json.loads(exported)
    assert data["schema_version"] == 3
    maps = {m["name"]: m for m in data["maps"]}
    assert set(maps) == {"Court", "Valley"}
    assert maps["Court"]["linked_document_ids"] == [seeded["castle"]["id"]]
    assert maps["Valley"]["background_url"].startswith("https://signed.test/")
    assert len(maps["Court"]["cards"]) == 3 and maps["Court"]["areas"] == []
    # Markdown has no maps.
    assert b"Court" not in await _export(client, room, room.master, "md")

    preview = await _preview(client, target, target.master, ("room.json", exported))
    assert preview.status_code == 200, preview.text
    previewed = {m["name"]: m for m in preview.json()["maps"]}
    assert previewed["Court"]["documents_count"] == 2
    assert previewed["Court"]["skipped"] is None
    assert [w["code"] for w in previewed["Court"]["warnings"]] == ["selective_to_private"]
    assert previewed["Valley"]["kind"] == "geographic" and previewed["Valley"]["warnings"] == []
    assert await _maps(client, target) == {}

    job = await _import(client, target, target.master, ("room.json", exported))

    assert job["status"] == "done", job
    assert {m["name"] for m in job["result"]["maps"]} == {"Court", "Valley"}
    assert job["result"]["skipped_maps"] == []
    documents = await _documents(client, target)
    created = await _maps(client, target)
    assert created["Court"]["visibility"] == "private"
    assert created["Court"]["created_by"] == target.master_id
    court = (
        await client.get(f"{target.url}/maps/{created['Court']['id']}", headers=target.master)
    ).json()
    cards = {c["document_id"] or c["text"]: c for c in court["cards"]}
    assert set(cards) == {documents["Castle"]["id"], documents["Lair"]["id"], "Trap"}
    castle_card = cards[documents["Castle"]["id"]]
    assert castle_card["caption"] == "Home" and castle_card["group_id"] == court["groups"][0]["id"]
    castle = await _detail(client, target, documents["Castle"]["id"])
    second = next(i for i in castle["images"] if not i["is_favorite"])
    assert castle_card["image_id"] == second["id"] != seeded["chosen"]
    assert cards["Trap"]["master_only"] is True
    assert {(a["label"], a["reverse_label"]) for a in court["arrows"]} == {
        ("rules", "serves"),
        (None, None),
    }
    linked = await client.get(
        f"{target.url}/documents/{documents['Castle']['id']}/linked-map", headers=target.master
    )
    assert linked.json()["id"] == created["Court"]["id"]
    valley = (
        await client.get(f"{target.url}/maps/{created['Valley']['id']}/geo", headers=target.master)
    ).json()
    assert (valley["plane_width"], valley["plane_height"]) == (1000, 800)
    assert valley["areas"][0]["document_id"] == documents["Castle"]["id"]
    assert valley["pins"][0]["note"] == "Fog"
    assert valley["links"][0]["bend"] == 30
    assert valley["background_url"] is not None
    source_background = next(p for p in fake_storage if seeded["valley"]["id"] in p)
    assert sum(1 for p in fake_storage if p.startswith("map-backgrounds/")) == 2
    assert source_background.startswith("map-backgrounds/")


async def test_a_players_export_holds_only_the_maps_and_cards_they_see(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
) -> None:
    room = await _room(client, make_token)
    seeded = await _seed_maps(client, room, db_session, fake_storage)
    await _post(client, f"{room.url}/maps", room.master, name="Secret", visibility="master")

    data = json.loads(await _export(client, room, room.player, "json"))

    maps = {m["name"]: m for m in data["maps"]}
    assert set(maps) == {"Court", "Valley"}
    court = maps["Court"]
    # The Master-only Lair and text card, and the arrows to them, are not there.
    assert [c["document_id"] for c in court["cards"]] == [seeded["castle"]["id"]]
    assert court["arrows"] == []
    # The Castle's player sees the image the card chose.
    assert court["cards"][0]["image_id"] == seeded["chosen"]


def _map(**fields: Any) -> dict[str, Any]:
    return {"id": str(uuid.uuid4()), "name": "Board", **fields}


async def test_an_imported_map_leaves_out_what_points_outside_the_file(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    inline_jobs: None,
) -> None:
    """Decisions 10 and 11: a card of a Document not imported, and a Player's
    Master-only content, are left out with the arrows touching them; a map
    that breaks a board rule, or can't be read, is skipped whole."""
    room = await _room(client, make_token)
    await client.patch(room.url, json={"players_can_create_documents": True}, headers=room.master)
    inn, gone, secret, text = (str(uuid.uuid4()) for _ in range(4))
    card = str(uuid.uuid4())
    good = _map(
        name="Inn board",
        visibility="selective",
        linked_document_ids=[inn],
        cards=[
            {"id": card, "document_id": inn, "image_id": str(uuid.uuid4()), "x": 0, "y": 0},
            {"id": gone, "document_id": str(uuid.uuid4()), "x": 300, "y": 0},
            {"id": secret, "text": "Only for the Master", "master_only": True, "x": 0, "y": 300},
            {"id": text, "text": "Rain", "x": 300, "y": 300},
        ],
        arrows=[
            {"id": str(uuid.uuid4()), "from_end": {"card_id": card}, "to_end": {"card_id": gone}},
            {"id": str(uuid.uuid4()), "from_end": {"card_id": card}, "to_end": {"card_id": text}},
            {
                "id": str(uuid.uuid4()),
                "from_end": {"card_id": card},
                "to_end": {"card_id": text},
                "master_only": True,
            },
        ],
    )
    area = str(uuid.uuid4())
    geo = _map(
        name="Town",
        kind="geographic",
        plane_width=500,
        plane_height=500,
        areas=[
            {"id": area, "name": "Square", "points": [[0, 0], [100, 0], [100, 100]]},
            {
                "id": str(uuid.uuid4()),
                "document_id": str(uuid.uuid4()),
                "points": [[0, 0], [10, 0], [10, 10]],
            },
            {
                "id": str(uuid.uuid4()),
                "name": "Vault",
                "master_only": True,
                "points": [[0, 0], [10, 0], [10, 10]],
            },
        ],
        pins=[
            {"id": str(uuid.uuid4()), "document_id": inn, "x": 50, "y": 50},
            {"id": str(uuid.uuid4()), "name": "Hideout", "master_only": True, "x": 1, "y": 1},
        ],
        links=[
            {
                "id": str(uuid.uuid4()),
                "from_end": {"area_id": area},
                "to_end": {"pin_id": str(uuid.uuid4())},
            }
        ],
    )
    off_plane = _map(
        name="Off the plane",
        kind="geographic",
        plane_width=200,
        plane_height=200,
        pins=[{"id": str(uuid.uuid4()), "name": "Far", "x": 900, "y": 900}],
    )
    file = _json_file(
        {"id": inn, "name": "Inn"},
        maps=[good, geo, off_plane, {"name": "Broken", "kind": "mention"}, "not a map"[:0] or {}],
    )

    preview = await _preview(client, room, room.player, file)

    assert preview.status_code == 200, preview.text
    found = {m["name"]: m for m in preview.json()["maps"]}
    assert {w["code"]: w["count"] for w in found["Inn board"]["warnings"]} == {
        "documents_left_out": 1,
        "master_only_dropped": 2,
        "selective_to_private": 1,
    }
    assert found["Inn board"]["documents_count"] == 1
    assert {w["code"]: w["count"] for w in found["Town"]["warnings"]} == {
        "documents_left_out": 1,
        "master_only_dropped": 2,
    }
    assert found["Off the plane"]["skipped"] == "invalid"
    assert found["Broken"]["skipped"] == "invalid"
    assert found[""]["skipped"] == "invalid"

    job = await _import(client, room, room.player, file)

    assert job["status"] == "done", job
    assert {m["name"] for m in job["result"]["maps"]} == {"Inn board", "Town"}
    assert sorted((m["name"], m["reason"]) for m in job["result"]["skipped_maps"]) == [
        ("", "invalid"),
        ("Broken", "invalid"),
        ("Off the plane", "invalid"),
    ]
    maps = await _maps(client, room, room.player)
    board = (
        await client.get(f"{room.url}/maps/{maps['Inn board']['id']}", headers=room.player)
    ).json()
    assert sorted(c["text"] or "doc" for c in board["cards"]) == ["Rain", "doc"]
    assert len(board["arrows"]) == 1
    # The card's image was never in the file: it shows the favorite.
    assert next(c for c in board["cards"] if c["document_id"])["image_id"] is None
    inn_id = job["result"]["created"][0]["id"]
    linked = await client.get(f"{room.url}/documents/{inn_id}/linked-map", headers=room.player)
    assert linked.json()["id"] == maps["Inn board"]["id"]
    town = (
        await client.get(f"{room.url}/maps/{maps['Town']['id']}/geo", headers=room.player)
    ).json()
    assert [a["name"] for a in town["areas"]] == ["Square"]
    assert [p["document_id"] for p in town["pins"]] == [inn_id]
    assert town["links"] == []


async def test_unticked_maps_and_maps_past_the_cap_are_not_created(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    inline_jobs: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api import import_job
    from app.domain import imports as imports_domain

    room = await _room(client, make_token)
    await _post(client, f"{room.url}/maps", room.master, name="Already here")
    monkeypatch.setattr(imports_domain, "MAX_MAPS_PER_ROOM", 2)
    file = _json_file(
        {"name": "Inn"},
        maps=[_map(name="First"), _map(name="Second"), _map(name="Third")],
    )
    preview = await _preview(client, room, room.master, file)
    assert [(m["name"], m["skipped"]) for m in preview.json()["maps"]] == [
        ("First", None),
        ("Second", "limit"),
        ("Third", "limit"),
    ]
    keys = [m["key"] for m in preview.json()["maps"]]

    # Unticking the first leaves room for the second, but another map takes it
    # before the job writes: the job counts again under the Room's lock.
    monkeypatch.setattr(import_job, "MAX_MAPS_PER_ROOM", 1)
    started = await client.post(
        f"{room.url}/imports",
        files=_upload(file),
        data={
            "choices": json.dumps(
                {"selected": [d["key"] for d in preview.json()["documents"]], "maps": keys[1:2]}
            )
        },
        headers=room.master,
    )
    assert started.status_code == 202, started.text
    job = (
        await client.get(f"{room.url}/imports/{started.json()['id']}", headers=room.master)
    ).json()

    assert job["result"]["maps"] == []
    assert job["result"]["skipped_maps"] == [{"name": "Second", "reason": "limit"}]
    assert set(await _maps(client, room)) == {"Already here"}


async def test_a_map_background_is_read_from_storage_or_skipped(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    own_bucket: Callable[[str], str],
    inline_jobs: None,
) -> None:
    """Decision 13: a background of this app's Storage is read straight from
    it when the importer sees a map that has it; one they don't see, or a
    link that fails, is listed and the map stays without it."""
    room = await _room(client, make_token)
    paths = {}
    for name, visibility in (("Seen", "room"), ("Hidden", "master")):
        created = await _post(
            client,
            f"{room.url}/maps",
            room.master,
            name=name,
            kind="geographic",
            visibility=visibility,
        )
        before = set(fake_storage)
        uploaded = await client.post(
            f"{room.url}/maps/{created['id']}/background",
            files={"file": ("bg.png", _png(), "image/png")},
            headers=room.master,
        )
        assert uploaded.status_code == 200, uploaded.text
        (paths[name],) = set(fake_storage) - before
    served["https://img.test/not-an-image"] = b"nope"
    file = _json_file(
        {"name": "Inn"},
        maps=[
            _map(name=f"{name} copy", kind="geographic", background_url=url)
            for name, url in (
                ("Seen", own_bucket(paths["Seen"])),
                ("Hidden", own_bucket(paths["Hidden"])),
                ("Bad", "https://img.test/not-an-image"),
            )
        ],
    )
    await client.patch(room.url, json={"players_can_create_documents": True}, headers=room.master)

    job = await _import(client, room, room.player, file)

    assert job["status"] == "done", job
    assert sorted((m["name"], m["reason"]) for m in job["result"]["skipped_maps"]) == [
        ("Bad copy", "background"),
        ("Hidden copy", "background"),
    ]
    assert served["calls"] == [own_bucket(paths["Hidden"]), "https://img.test/not-an-image"]
    maps = await _maps(client, room, room.player)
    seen = (
        await client.get(f"{room.url}/maps/{maps['Seen copy']['id']}/geo", headers=room.player)
    ).json()
    assert seen["background_url"] is not None


async def test_a_replaced_documents_card_keeps_the_image_it_still_has(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    await _image_on(client, room, fake_storage, name="Castle")
    castle = (await _documents(client, room))["Castle"]
    image_id = (await _detail(client, room, castle["id"]))["images"][0]["id"]
    card = {
        "id": str(uuid.uuid4()),
        "document_id": castle["id"],
        "image_id": image_id,
        "x": 0,
        "y": 0,
    }
    file = _json_file(
        {
            "id": castle["id"],
            "name": "Castle",
            "images": [{"id": image_id, "url": "https://x.test/a"}],
        },
        maps=[_map(name="Keep", cards=[card])],
    )
    preview = await _preview(client, room, room.master, file)
    key = preview.json()["documents"][0]["key"]

    job = await _import(client, room, room.master, file, selected=[key], replace=[key])

    assert job["result"]["replaced"][0]["id"] == castle["id"]
    keep = (await _maps(client, room))["Keep"]
    board = (await client.get(f"{room.url}/maps/{keep['id']}", headers=room.master)).json()
    assert board["cards"][0]["image_id"] == image_id
    assert served["calls"] == []  # the image it still has is not fetched again


@pytest.mark.parametrize("failure", [storage.StorageError("503"), RuntimeError("bug")])
async def test_a_background_that_cannot_be_stored_is_listed(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    inline_jobs: None,
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
) -> None:
    room = await _room(client, make_token)
    served["https://img.test/bg.png"] = _png()

    async def down(*args: Any) -> None:
        raise failure

    monkeypatch.setattr(storage, "upload", down)
    file = _json_file(
        {"name": "Inn"},
        maps=[_map(name="Town", kind="geographic", background_url="https://img.test/bg.png")],
    )

    job = await _import(client, room, room.master, file)

    assert job["result"]["skipped_maps"] == [{"name": "Town", "reason": "background"}]
    assert "Town" in await _maps(client, room)


async def test_a_background_storage_read_that_fails_falls_back_to_the_link(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    served: dict[str, Any],
    own_bucket: Callable[[str], str],
    inline_jobs: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    room = await _room(client, make_token)
    created = await _post(client, f"{room.url}/maps", room.master, name="Town", kind="geographic")
    before = set(fake_storage)
    await client.post(
        f"{room.url}/maps/{created['id']}/background",
        files={"file": ("bg.png", _png(), "image/png")},
        headers=room.master,
    )
    (path,) = set(fake_storage) - before
    served[own_bucket(path)] = _png()

    async def down(path: str, max_bytes: int) -> bytes:
        raise storage.StorageError("Storage answered 503")

    monkeypatch.setattr(storage, "download", down)
    file = _json_file(
        {"name": "Inn"},
        maps=[_map(name="Copy", kind="geographic", background_url=own_bucket(path))],
    )

    job = await _import(client, room, room.master, file)

    assert job["result"]["skipped_maps"] == []
    assert served["calls"] == [own_bucket(path)]

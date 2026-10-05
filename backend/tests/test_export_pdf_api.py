"""The Room PDF job (spec 23b, 23b_1c): the request, the background run, who may
see the file, and what is in it. WeasyPrint is replaced by a stub that records
what it was asked to typeset (the real render is `test_pdf_manual.py`), so the
Manual each job built can be checked for what must never be in it (VR-07)."""

import asyncio
import io
import uuid
from collections.abc import AsyncIterator, Callable, Coroutine, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from PIL import Image
from pypdf import PdfReader, PdfWriter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import export_pdf, export_pdf_job
from app.db import export_jobs_repo, storage
from app.db.models import StorageCleanupRow
from app.domain.export_jobs import ExportStatus
from app.domain.manual import Manual, ManualStyle, PageSize
from app.main import app


def _pdf(pages: int = 2) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (60, 40), color=(120, 40, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@dataclass
class Render:
    """One call of the stubbed renderer."""

    manual: Manual
    style: ManualStyle
    page_size: PageSize
    locale: str

    @property
    def text(self) -> str:
        """Everything in the Manual, as text, for "is this in the PDF"."""
        return repr(self.manual)


@pytest.fixture
def renders(monkeypatch: pytest.MonkeyPatch) -> list[Render]:
    """Replaces the typesetting with a two-page PDF and records each call."""
    calls: list[Render] = []

    def fake_render(manual: Manual, style: ManualStyle, page_size: PageSize, locale: str) -> bytes:
        calls.append(Render(manual, style, page_size, locale))
        return _pdf(2)

    monkeypatch.setattr(export_pdf_job, "render_manual_pdf", fake_render)
    return calls


@pytest.fixture
def inline_jobs(monkeypatch: pytest.MonkeyPatch) -> None:
    """Runs a job before the request that started it returns, instead of in a
    background task."""

    async def inline(coroutine: Coroutine[Any, Any, None]) -> None:
        await coroutine

    monkeypatch.setattr(export_pdf, "spawn", inline)


@pytest.fixture
def held_jobs(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[Coroutine[Any, Any, None]]]:
    """Keeps started jobs from running, so a test sees them queued and runs
    them when it wants (`await held.pop()`)."""
    held: list[Coroutine[Any, Any, None]] = []

    async def hold(coroutine: Coroutine[Any, Any, None]) -> None:
        held.append(coroutine)

    monkeypatch.setattr(export_pdf, "spawn", hold)
    yield held
    for coroutine in held:
        coroutine.close()


@dataclass
class _Room:
    id: str
    url: str
    master: dict[str, str]
    player: dict[str, str]
    other: dict[str, str]
    player_id: str
    other_id: str
    master_id: str
    outsider: dict[str, str]


def _headers(make_token: Callable[..., str], user_id: str, **extra: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(user_id)}", **extra}


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
        joined[0],
        joined[1],
        player_id,
        other_id,
        master_id,
        _headers(make_token, outsider_id),
    )


async def _post(client: AsyncClient, url: str, headers: dict[str, str], **body: Any) -> Any:
    response = await client.post(url, json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _document(client: AsyncClient, room: _Room, name: str, **fields: Any) -> Any:
    return await _post(client, f"{room.url}/documents", room.master, name=name, **fields)


async def _seed(client: AsyncClient, room: _Room) -> dict[str, Any]:
    """Room-wide and Master-only content of every kind the PDF reads."""
    tags = {
        t["name"]: t for t in (await client.get(f"{room.url}/tags", headers=room.master)).json()
    }
    castle = await _document(
        client, room, "Castle", description="A dark keep.", tag_ids=[tags["NPC"]["id"]]
    )
    await _document(client, room, "Vampire lair", visibility="master")
    await _document(client, room, "Village", tag_ids=[tags["Place"]["id"]])
    base = f"{room.url}/documents/{castle['id']}"
    await _post(client, f"{base}/notes", room.master, title="Rumor", description="Heard in town")
    await _post(
        client,
        f"{base}/notes",
        room.master,
        title="Truth",
        description="Strahd lives",
        visibility="master",
    )
    await _post(client, f"{base}/comments", room.player, body="Hello there")
    await _post(client, f"{base}/comments", room.master, body="Beware", visibility="master")
    return {"castle": castle, "tags": tags}


async def _start(
    client: AsyncClient, room: _Room, headers: dict[str, str] | None = None, **body: Any
) -> Response:
    return await client.post(f"{room.url}/exports/pdf", json=body, headers=headers or room.player)


async def _status(
    client: AsyncClient, room: _Room, job_id: str, headers: dict[str, str] | None = None
) -> Response:
    return await client.get(f"{room.url}/exports/{job_id}", headers=headers or room.player)


async def _job(session: AsyncSession, job_id: str) -> Any:
    job = await export_jobs_repo.get_job(session, uuid.UUID(job_id))
    assert job is not None
    return job


async def _cleanup_rows(session: AsyncSession) -> int:
    """How many Room PDF files wait for removal (other rows aren't ours)."""
    count = await session.scalar(
        select(func.count())
        .select_from(StorageCleanupRow)
        .where(StorageCleanupRow.storage_path.like("exports/%"))
    )
    return int(count or 0)


# --- the request and the run -------------------------------------------------


async def test_a_player_gets_a_pdf_with_only_what_they_see(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    renders: list[Render],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    await _seed(client, room)

    started = await _start(client, room, include_comments=True)

    assert started.status_code == 202, started.text
    job = started.json()
    assert job["status"] == "queued"  # the answer is the job as created
    assert job["download_url"] is None and job["expires_at"] is None
    done = (await _status(client, room, job["id"])).json()
    assert done["status"] == "done"
    path = f"exports/{room.id}/{job['id']}.pdf"
    # A signed link that downloads, named like the other exports: never opened
    # from the app's own origin.
    assert done["download_url"].startswith(f"https://signed.test/{path}?")
    assert done["download_url"].endswith(f"&download=barovia-{datetime.now(UTC):%Y-%m-%d}.pdf")
    assert datetime.fromisoformat(done["expires_at"]) - datetime.fromisoformat(
        done["finished_at"]
    ) == timedelta(hours=24)
    assert fake_storage[path].startswith(b"%PDF-")
    # The file's cleanup row was settled with the job row.
    assert await _cleanup_rows(db_session) == 0

    (render,) = renders
    assert (render.style, render.page_size, render.locale) == (
        ManualStyle.GOTHIC,
        PageSize.A4,
        "en",
    )
    for visible in ("Castle", "Village", "Heard in town", "Hello there"):
        assert visible in render.text
    for hidden in ("Vampire lair", "Strahd lives", "Truth", "Beware"):
        assert hidden not in render.text


async def test_the_master_sees_everything_and_the_options_are_honored(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    renders: list[Render],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    seeded = await _seed(client, room)
    npc = seeded["tags"]["NPC"]["id"]

    headers = {**room.master, "Accept-Language": "it"}
    started = await _start(
        client,
        room,
        headers,
        style="print",
        page_size="Letter",
        tag_ids=[npc, npc],
        include_comments=False,
    )

    assert started.status_code == 202, started.text
    (render,) = renders
    assert (render.style, render.page_size, render.locale) == (
        ManualStyle.PRINT,
        PageSize.LETTER,
        "it",
    )
    assert render.manual.labels.contents == "Indice"
    # Only the Documents tagged NPC; no Comments unless asked; the Master's own
    # Notes are there.
    assert "Castle" in render.text and "Village" not in render.text
    assert "Strahd lives" in render.text and "Hello there" not in render.text


async def test_the_master_makes_a_pdf_as_a_player_and_it_matches_what_they_see(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    renders: list[Render],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    await _seed(client, room)

    started = await _start(client, room, room.master, view_as_user_id=room.player_id)

    assert started.status_code == 202, started.text
    # The job is the Master's own (they poll it), made with the player's view.
    assert (await _status(client, room, started.json()["id"], room.master)).json()[
        "status"
    ] == "done"
    assert (await _status(client, room, started.json()["id"])).status_code == 404
    (render,) = renders
    assert "Heard in town" in render.text
    assert "Strahd lives" not in render.text and "Vampire lair" not in render.text


async def test_only_the_master_may_make_it_as_another_member_and_only_a_member(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    renders: list[Render],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)

    by_player = await _start(client, room, room.player, view_as_user_id=room.other_id)
    outsider = str(uuid.uuid4())
    for target in (outsider, str(uuid.uuid4())):
        refused = await _start(client, room, room.master, view_as_user_id=target)
        assert refused.status_code == 403
    # The header of spec 22b still refuses every write, this one included.
    header = {**room.master, "X-View-As": room.player_id}
    by_header = await _start(client, room, header)

    assert by_player.status_code == 403
    assert by_header.status_code == 403
    assert renders == []


async def test_a_tag_of_another_room_is_a_404_and_outsiders_are_refused(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    renders: list[Render],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    elsewhere = await _room(client, make_token, "Elsewhere")
    foreign = (await client.get(f"{elsewhere.url}/tags", headers=elsewhere.master)).json()[0]

    wrong_tag = await _start(client, room, tag_ids=[foreign["id"]])
    outsider = await _start(client, room, room.outsider)
    status_for_outsider = await _status(client, room, str(uuid.uuid4()), room.outsider)
    listing_for_outsider = await client.get(f"{room.url}/exports", headers=room.outsider)

    assert wrong_tag.status_code == 404
    assert outsider.status_code == 403
    assert status_for_outsider.status_code == 403
    assert listing_for_outsider.status_code == 403
    assert renders == []


async def test_a_bad_option_is_a_422(
    db_session: AsyncSession, make_token: Callable[..., str], client: AsyncClient
) -> None:
    room = await _room(client, make_token)

    assert (await _start(client, room, style="comic")).status_code == 422
    assert (await _start(client, room, page_size="A3")).status_code == 422


# --- one at a time, polling, and whose it is ---------------------------------


async def test_one_pdf_at_a_time_per_user_and_room(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    renders: list[Render],
    held_jobs: list[Coroutine[Any, Any, None]],
) -> None:
    room = await _room(client, make_token)

    first = await _start(client, room)
    second = await _start(client, room)
    someone_else = await _start(client, room, room.other)
    status_before = (await _status(client, room, first.json()["id"])).json()["status"]
    await held_jobs.pop(0)  # the first one runs and finishes
    after = await _start(client, room)

    assert first.status_code == 202
    assert second.status_code == 409
    assert second.json()["detail"] == "A PDF is already being generated for you in this Room"
    assert someone_else.status_code == 202  # another user, or another Room, isn't blocked
    assert status_before == "queued"
    assert after.status_code == 202
    assert len(renders) == 1


async def test_a_job_is_its_requesters_alone_and_the_list_shows_only_theirs(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    renders: list[Render],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    elsewhere = await _room(client, make_token, "Elsewhere")
    mine = (await _start(client, room)).json()
    theirs = (await _start(client, room, room.other)).json()

    others_view = await _status(client, room, mine["id"], room.other)
    wrong_room = await client.get(f"{elsewhere.url}/exports/{mine['id']}", headers=elsewhere.master)
    unknown = await _status(client, room, str(uuid.uuid4()))
    listed = (await client.get(f"{room.url}/exports", headers=room.player)).json()
    empty = (await client.get(f"{room.url}/exports", headers=room.master)).json()

    assert others_view.status_code == 404
    assert wrong_room.status_code == 404
    assert unknown.status_code == 404
    assert [job["id"] for job in listed] == [mine["id"]]
    assert listed[0]["status"] == "done" and listed[0]["download_url"]
    assert theirs["id"] not in [job["id"] for job in listed]
    assert empty == []


# --- what goes into the file --------------------------------------------------


async def test_images_are_embedded_downscaled_and_the_cover_comes_from_a_document(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    renders: list[Render],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    document = await _document(client, room, "Gallery")
    upload = await client.post(
        f"{room.url}/documents/{document['id']}/images",
        files={"file": ("a.png", _png(), "image/png")},
        headers=room.master,
    )
    assert upload.status_code == 201, upload.text

    await _start(client, room, cover_document_id=document["id"])

    (render,) = renders
    cover = render.manual.cover_image_url
    assert cover is not None and cover.startswith("data:image/jpeg;base64,")
    (entry,) = [e for c in render.manual.chapters for e in c.entries]
    assert getattr(entry, "image_url", None) == cover
    # Nothing left that the renderer would have to fetch from the network.
    assert all(url.startswith("data:") for url in render.manual.image_urls)


async def test_an_image_that_cannot_be_fetched_or_read_is_left_out_not_fatal(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    renders: list[Render],
    inline_jobs: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    room = await _room(client, make_token)
    broken = await _document(client, room, "Broken image")
    unreadable = await _document(client, room, "Unreadable image")
    for document in (broken, unreadable):
        upload = await client.post(
            f"{room.url}/documents/{document['id']}/images",
            files={"file": ("a.png", _png(), "image/png")},
            headers=room.master,
        )
        assert upload.status_code == 201, upload.text
    stored = [path for path in fake_storage if not path.startswith("exports/")]
    fake_storage[stored[1]] = b"not an image"
    real_download = storage.download_signed

    async def flaky(url: str, max_bytes: int) -> bytes:
        if stored[0] in url:
            raise storage.StorageError("gone")
        return await real_download(url, max_bytes)

    monkeypatch.setattr(storage, "download_signed", flaky)

    started = await _start(client, room)

    assert (await _status(client, room, started.json()["id"])).json()["status"] == "done"
    (render,) = renders
    assert [getattr(e, "image_url", "x") for c in render.manual.chapters for e in c.entries] == [
        None,
        None,
    ]


async def test_attachments_are_appended_in_the_manuals_order_only_when_asked(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    renders: list[Render],
    inline_jobs: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    room = await _room(client, make_token)
    document = await _document(client, room, "Sheets")
    hidden = await _document(client, room, "Secret sheets", visibility="master")
    for target, pages in ((document, 3), (hidden, 5)):
        upload = await client.post(
            f"{room.url}/documents/{target['id']}/files",
            files={"file": ("Sheet.pdf", _pdf(pages), "application/pdf")},
            headers=room.master,
        )
        assert upload.status_code == 201, upload.text

    plain = (await _start(client, room, room.player)).json()
    with_files = (await _start(client, room, room.other, include_attachments=True)).json()
    as_master = (await _start(client, room, room.master, include_attachments=True)).json()

    def page_count(job: dict[str, Any]) -> int:
        return len(PdfReader(io.BytesIO(fake_storage[f"exports/{room.id}/{job['id']}.pdf"])).pages)

    # The 2-page manual alone; plus the 3 pages of the one the player sees; the
    # Master's also holds the 5 of the Document hidden from players.
    assert (page_count(plain), page_count(with_files), page_count(as_master)) == (2, 5, 10)

    # An attachment over the byte budget, or one that can't be fetched, is
    # skipped; the manual still comes out.
    monkeypatch.setattr(export_pdf_job, "MAX_ATTACHMENT_BYTES", 10)
    capped = (await _start(client, room, room.player, include_attachments=True)).json()
    assert page_count(capped) == 2

    async def gone(url: str, max_bytes: int) -> bytes:
        raise storage.StorageError("gone")

    monkeypatch.setattr(export_pdf_job, "MAX_ATTACHMENT_BYTES", 50 * 1024 * 1024)
    monkeypatch.setattr(storage, "download_signed", gone)
    unfetched = (await _start(client, room, room.player, include_attachments=True)).json()
    assert page_count(unfetched) == 2


# --- failures ----------------------------------------------------------------


async def test_a_failed_render_fails_the_job_and_frees_the_user_to_try_again(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    inline_jobs: None,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    room = await _room(client, make_token)

    def broken(*_: Any) -> bytes:
        raise RuntimeError("pango exploded")

    monkeypatch.setattr(export_pdf_job, "render_manual_pdf", broken)
    started = (await _start(client, room)).json()

    failed = (await _status(client, room, started["id"])).json()
    assert failed["status"] == "failed"
    assert failed["download_url"] is None and failed["expires_at"] is None
    job = await _job(db_session, started["id"])
    assert (job.status, job.error, job.storage_path) == (ExportStatus.FAILED, "failed", None)
    assert "pango exploded" in caplog.text
    assert not [path for path in fake_storage if path.startswith("exports/")]
    assert (await _start(client, room)).status_code == 202


async def test_a_failed_upload_leaves_its_cleanup_row_for_the_sweep(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    renders: list[Render],
    inline_jobs: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    room = await _room(client, make_token)

    async def refusing(path: str, data: bytes, content_type: str) -> None:
        raise storage.StorageError("bucket down")

    monkeypatch.setattr(storage, "upload", refusing)
    started = (await _start(client, room)).json()

    assert (await _job(db_session, started["id"])).status is ExportStatus.FAILED
    # Recorded before the upload, so a half-finished one can't leak an object.
    assert await _cleanup_rows(db_session) == 1


async def test_a_job_whose_requester_left_before_it_started_is_refused(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    renders: list[Render],
    held_jobs: list[Coroutine[Any, Any, None]],
) -> None:
    room = await _room(client, make_token)
    left = (await _start(client, room, room.player)).json()
    viewed = (await _start(client, room, room.master, view_as_user_id=room.other_id)).json()
    for headers, member in ((room.player, room.player_id), (room.other, room.other_id)):
        gone = await client.delete(f"{room.url}/members/{member}", headers=headers)
        assert gone.status_code == 204, gone.text

    for coroutine in list(held_jobs):
        await coroutine
    held_jobs.clear()

    for job_id in (left["id"], viewed["id"]):
        job = await _job(db_session, job_id)
        assert (job.status, job.error) == (ExportStatus.FAILED, "refused")
    assert renders == []


async def test_a_job_that_is_missing_or_already_taken_does_nothing(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    renders: list[Render],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    started = (await _start(client, room)).json()

    await export_pdf_job.run_export_job(uuid.uuid4())
    await export_pdf_job.run_export_job(uuid.UUID(started["id"]))

    assert len(renders) == 1
    assert (await _job(db_session, started["id"])).status is ExportStatus.DONE


async def test_a_background_task_is_kept_until_it_ends() -> None:
    finished = asyncio.Event()

    async def work() -> None:
        finished.set()

    await export_pdf_job.spawn(work())
    await asyncio.wait_for(finished.wait(), timeout=5)
    await asyncio.sleep(0)

    assert not export_pdf_job._tasks


# --- after the job: expiry, stale jobs, Room deletion ---------------------------


async def test_a_pdf_is_removed_after_a_day_and_its_row_says_so(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    renders: list[Render],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    started = (await _start(client, room)).json()
    path = f"exports/{room.id}/{started['id']}.pdf"
    finished = (await _job(db_session, started["id"])).finished_at
    assert finished is not None

    await export_jobs_repo.sweep(db_session, finished + timedelta(hours=23))
    assert path in fake_storage
    assert (await _status(client, room, started["id"])).json()["status"] == "done"

    await export_jobs_repo.sweep(db_session, finished + timedelta(hours=25))

    assert path not in fake_storage
    expired = (await _status(client, room, started["id"])).json()
    assert expired["status"] == "expired"
    assert expired["download_url"] is None and expired["expires_at"] is None
    assert (await _job(db_session, started["id"])).storage_path is None
    assert await _cleanup_rows(db_session) == 0
    # A new one can be made.
    assert (await _start(client, room)).status_code == 202


async def test_a_job_stuck_active_is_failed_by_the_sweep_so_its_owner_can_retry(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    held_jobs: list[Coroutine[Any, Any, None]],
) -> None:
    room = await _room(client, make_token)
    started = (await _start(client, room)).json()

    await export_jobs_repo.sweep(db_session, datetime.now(UTC) + timedelta(minutes=10))
    assert (await _job(db_session, started["id"])).status is ExportStatus.QUEUED

    await export_jobs_repo.sweep(db_session, datetime.now(UTC) + timedelta(minutes=31))

    job = await _job(db_session, started["id"])
    assert (job.status, job.error) == (ExportStatus.FAILED, "stale")
    assert (await _start(client, room)).status_code == 202
    # With the real clock nothing is old enough.
    await export_jobs_repo.sweep(db_session)


async def test_a_restart_fails_every_job_it_cut_off(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    held_jobs: list[Coroutine[Any, Any, None]],
) -> None:
    room = await _room(client, make_token)
    started = (await _start(client, room)).json()

    count = await export_jobs_repo.fail_active(db_session, "interrupted", datetime.now(UTC))

    assert count >= 1
    job = await _job(db_session, started["id"])
    assert (job.status, job.error) == (ExportStatus.FAILED, "interrupted")


async def test_deleting_the_room_removes_its_pdfs_from_storage(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    renders: list[Render],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    started = (await _start(client, room)).json()
    path = f"exports/{room.id}/{started['id']}.pdf"
    assert path in fake_storage

    deleted = await client.delete(room.url, headers=room.master)

    assert deleted.status_code == 204, deleted.text
    assert path not in fake_storage


async def test_a_document_listed_in_two_chapters_has_its_attachments_appended_once(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    fake_storage: dict[str, bytes],
    renders: list[Render],
    inline_jobs: None,
) -> None:
    room = await _room(client, make_token)
    tags = {
        t["name"]: t for t in (await client.get(f"{room.url}/tags", headers=room.master)).json()
    }
    both = await _document(client, room, "Both", tag_ids=[tags["NPC"]["id"], tags["Place"]["id"]])
    upload = await client.post(
        f"{room.url}/documents/{both['id']}/files",
        files={"file": ("Sheet.pdf", _pdf(3), "application/pdf")},
        headers=room.master,
    )
    assert upload.status_code == 201, upload.text

    started = (await _start(client, room, include_attachments=True)).json()

    (render,) = renders
    assert [type(e).__name__ for c in render.manual.chapters for e in c.entries] == [
        "ManualDocument",
        "ManualReference",
    ]
    stored = fake_storage[f"exports/{room.id}/{started['id']}.pdf"]
    assert len(PdfReader(io.BytesIO(stored)).pages) == 5


async def test_a_job_that_cannot_even_be_marked_failed_is_only_logged(
    db_session: AsyncSession,
    make_token: Callable[..., str],
    client: AsyncClient,
    inline_jobs: None,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    room = await _room(client, make_token)

    def broken(*_: Any) -> bytes:
        raise RuntimeError("render failed")

    async def no_database(*_: Any) -> None:
        raise RuntimeError("database gone")

    monkeypatch.setattr(export_pdf_job, "render_manual_pdf", broken)
    monkeypatch.setattr(export_jobs_repo, "mark_failed", no_database)

    started = await _start(client, room)

    assert started.status_code == 202  # nothing escaped the background task
    assert "Could not mark Room PDF" in caplog.text

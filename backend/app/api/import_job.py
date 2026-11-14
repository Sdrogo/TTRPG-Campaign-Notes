"""The background work of a Document import (spec 27 Decisions 9 and 15):
starts from a queued `import_jobs` row, checks again that the importer may do
it, plans against the Room as it is then, writes Tags, Documents, Notes and
maps (spec 40) in one transaction (all or nothing), then fetches and attaches
the images, map backgrounds and Section images best effort, in blocks it
saves as it goes so a restart resumes them (spec 59), and points map cards
at the images they chose. Any failure marks the job failed; nothing here
raises to the caller."""

import asyncio
import logging
import uuid
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import get_visible_images, get_visible_images_for_documents
from app.api.export_pdf_job import spawn
from app.api.versions import record_revision
from app.db import (
    clocks_repo,
    documents_repo,
    import_jobs_repo,
    import_staging,
    imports_repo,
    map_transfer_repo,
    mentions_repo,
    notes_repo,
    relationship_maps_repo,
    remote_images,
    room_sections_repo,
    rooms_repo,
    storage,
    storage_cleanup,
    tags_repo,
)
from app.db import session as session_module
from app.db.models import (
    DocumentImageRow,
    RelationshipMapCardRow,
    RelationshipMapRow,
    RoomSectionRow,
)
from app.domain.clock_transfer import plan_clock_import
from app.domain.clocks import MAX_CLOCKS_PER_ROOM, MAX_GROUPS_PER_ROOM
from app.domain.documents import (
    MAX_IMAGES_PER_DOCUMENT,
    can_create_document,
    is_owner,
    plan_new_image,
)
from app.domain.errors import DomainError
from app.domain.geographic_maps import MAX_BACKGROUND_DIMENSION, plan_background_path
from app.domain.images import (
    MAX_INPUT_BYTES,
    ImageTooLargeError,
    InvalidImageError,
    normalize_image,
)
from app.domain.import_files import VAULT_URL_PREFIX, ImportFile, file_from_json, file_to_json
from app.domain.imports import (
    ACTIVE_IMPORT_STATUSES,
    ExistingDocument,
    ImportChoices,
    ImportContext,
    ImportJob,
    ImportPlan,
    ImportStatus,
    PlannedDocument,
    fold,
    next_block,
    plan_import,
)
from app.domain.landing_transfer import PlannedSection, SectionSkipReason, to_section
from app.domain.map_transfer import CardImage, MapSkipReason, PlannedMap, to_source_map
from app.domain.mentions import plan_source_mentions
from app.domain.models import Membership, MentionSource, MentionSourceKind, Room, RoomRole
from app.domain.relationship_maps import MAX_MAPS_PER_ROOM, is_map_visible
from app.domain.room_sections import (
    Section,
    TooManySectionsError,
    plan_new_section,
    plan_section_image_path,
)
from app.domain.visibility import is_document_visible
from app.realtime.audience import CHANGED, push
from app.realtime.broker import CLOCK_RULES, LANDING, Event

logger = logging.getLogger(__name__)

_IMAGES_AT_ONCE = 4


class ImportRefusedByRoomError(Exception):
    """The job can't run any more as asked: the importer left the Room, the
    Room is gone, or Players may no longer create Documents."""


def job_payload(files: list[ImportFile], choices: ImportChoices) -> dict[str, Any]:
    """What a job keeps while it is active: the parsed files and the choices.
    Never the uploaded bytes (Decision 17)."""
    return {
        "files": [file_to_json(file) for file in files],
        "selected": None if choices.selected is None else sorted(choices.selected),
        "replace": sorted(choices.replace),
        "maps": None if choices.maps is None else sorted(choices.maps),
        "sections": None if choices.sections is None else sorted(choices.sections),
        "page_cards": None if choices.page_cards is None else sorted(choices.page_cards),
    }


def _from_payload(payload: dict[str, Any]) -> tuple[list[ImportFile], ImportChoices]:
    """The inverse of `job_payload`."""
    selected = payload["selected"]
    # Absent from the payload of a job queued before spec 40: every map.
    maps = payload.get("maps")
    # Absent before spec 56: every custom Section, no page card.
    sections = payload.get("sections")
    page_cards = payload.get("page_cards", [])
    return (
        [file_from_json(data) for data in payload["files"]],
        ImportChoices(
            None if selected is None else frozenset(selected),
            frozenset(payload["replace"]),
            None if maps is None else frozenset(maps),
            None if sections is None else frozenset(sections),
            None if page_cards is None else frozenset(page_cards),
        ),
    )


async def load_import_context(
    session: AsyncSession, room: Room, importer: Membership
) -> ImportContext:
    """What a plan needs from the Room, as the importer sees it (Invariant 1):
    the Documents they see with whether they manage each and the images it
    has, the Room's Tags and whether they may create Tags (as `POST /tags`:
    an Administrator or the Master). Read in a fixed number of queries."""
    documents = await documents_repo.list_documents_for_room(session, room.id)
    ids = [document.id for document in documents]
    owners = await documents_repo.list_owner_ids_for_documents(session, ids)
    grants = await documents_repo.list_selective_grant_ids_for_documents(session, ids)
    visible = [
        document
        for document in documents
        if is_document_visible(
            document, importer.user_id, importer.role, owners[document.id], grants[document.id]
        )
    ]
    images = await get_visible_images_for_documents(session, [d.id for d in visible], importer)
    # Only a Replace reads them, and only on Documents the importer manages.
    managed = [d.id for d in visible if is_owner(importer.role, importer.user_id, owners[d.id])]
    notes = await notes_repo.list_notes_for_documents(session, managed)
    tags = await tags_repo.list_tags(session, room.id)
    is_master = importer.role is RoomRole.MASTER
    return ImportContext(
        default_visibility=room.default_visibility,
        existing={
            document.id: ExistingDocument(
                document.id,
                is_owner(importer.role, importer.user_id, owners[document.id]),
                frozenset(str(image.id) for image in images.get(document.id, ())),
                document.name,
                tuple(fold(n.title) for n in notes.get(document.id, ()) if n.relational_link),
            )
            for document in visible
        },
        room_tags={fold(tag.name): (tag.id, tag.name) for tag in tags},
        can_manage_tags=importer.is_admin or importer.role is RoomRole.MASTER,
        is_master=is_master,
        map_count=await relationship_maps_repo.count_maps_for_room(session, room.id),
        room_id=room.id,
        sections=tuple(await room_sections_repo.list_sections(session, room.id))
        if is_master
        else (),
    )


async def run_import_job(job_id: uuid.UUID) -> None:
    """Runs the job to the end: `done` with what it did, or `failed`. Never
    raises (it runs as a background task, where nobody would see it). Once
    the Documents are written, the images go in blocks (spec 59). The pictures
    staged for it (spec 65) are removed as it ends, whatever the outcome."""
    try:
        await _run(job_id)
    finally:
        await _discard_staged(job_id)


async def _discard_staged(job_id: uuid.UUID) -> None:
    """Removes the pictures staged for the job once it is over (`done` or
    `failed`). A job a shutdown cut off is still active and keeps them: the
    restart resumes it, and the sweep spares them while it is."""
    try:
        async with session_module.independent_session() as session:
            job = await import_jobs_repo.get_job(session, job_id)
        over = job is None or job.status not in ACTIVE_IMPORT_STATUSES
    except Exception:
        logger.exception("Could not check whether import %s is over", job_id)
        return  # the sweep removes the pictures once the job is over
    if over:
        await import_staging.discard(job_id)


async def _run(job_id: uuid.UUID) -> None:
    """The body of `run_import_job`."""
    try:
        started = await _start(job_id)
        if started is None:
            return
        job, importer, plan = started
        created, replaced, maps, sections = await _write(job, importer, plan)
        progress = _image_progress(plan, created, replaced, maps, sections)
        async with session_module.independent_session() as session:
            await import_jobs_repo.start_images(session, job.id, progress)
            await session.commit()
        await _run_images(job.id, job.room_id, importer.user_id)
    except (ImportRefusedByRoomError, DomainError):
        logger.warning("Import %s refused: the importer can no longer do it", job_id)
        await _fail(job_id, "refused")
    except Exception:
        logger.exception("Import %s failed", job_id)
        await _fail(job_id, "failed")


async def resume_import_job(job_id: uuid.UUID) -> None:
    """Goes on with the images of a job a restart cut off in its image
    phase (spec 59 Decision 6), from the first entry not done, as long as
    the importer is still a member of the Room. Never raises. Like
    `run_import_job`, it removes the staged pictures when the job is over."""
    try:
        await _resume(job_id)
    finally:
        await _discard_staged(job_id)


async def _resume(job_id: uuid.UUID) -> None:
    """The body of `resume_import_job`."""
    try:
        async with session_module.independent_session() as session:
            job = await import_jobs_repo.get_job(session, job_id)
            if job is None or job.status is not ImportStatus.RUNNING or job.progress is None:
                return
            if await rooms_repo.get_membership(session, job.room_id, job.requested_by) is None:
                raise ImportRefusedByRoomError
        await _run_images(job.id, job.room_id, job.requested_by)
    except ImportRefusedByRoomError:
        logger.warning("Import %s refused: the importer can no longer do it", job_id)
        await _fail(job_id, "refused")
    except Exception:
        logger.exception("Import %s failed", job_id)
        await _fail(job_id, "failed")


async def resume_import_jobs() -> None:
    """At startup, before the sweeps: claims the imports a restart cut off
    in their image phase and resumes each in the background. A failure is
    only logged, so the app still starts."""
    try:
        async with session_module.independent_session() as session:
            ids = await import_jobs_repo.claim_image_phases(session)
            await session.commit()
    except Exception:
        logger.exception("Could not resume the imports interrupted by a restart")
        return
    for job_id in ids:
        await spawn(resume_import_job(job_id))


def _image_progress(
    plan: ImportPlan,
    created: list[dict[str, str]],
    replaced: list[dict[str, str]],
    maps: list[PlannedMap],
    sections: list[PlannedSection],
) -> dict[str, Any]:
    """The image phase's starting point (spec 59 Decisions 3, 4): the work
    list (each Document's images in order, so its favorite is stored first,
    then the maps' backgrounds and the Sections' images, each naming what it
    goes to and how a skip is listed), nothing done yet, what the Documents'
    transaction made and what it already left out."""
    work: list[dict[str, Any]] = [
        {
            "kind": "image",
            "target": str(document.id),
            "url": image.url,
            "source_id": image.source_id,
            "skip": _skip(document, image.url, ""),
        }
        for document in plan.documents
        for image in document.images
    ]
    work += [
        {
            "kind": "background",
            "target": str(m.id),
            "url": m.background_url,
            "skip": {"name": m.name, "reason": "background"},
        }
        for m in maps
        if m.background_url is not None
    ]
    work += [
        {
            "kind": "section",
            "target": str(s.id),
            "url": s.image_url,
            "skip": _skipped_section(s, "image"),
        }
        for s in sections
        if s.image_url is not None
    ]
    created_maps = {m.key for m in maps}
    written = {s.key for s in sections}
    return {
        "work": work,
        "done": 0,
        "stored": {},
        "result": {
            "created": created,
            "replaced": replaced,
            "maps": [{"id": str(m.id), "name": m.name} for m in maps],
            "sections": [
                {"id": str(s.id), "kind": s.kind.value, "title": s.title} for s in sections
            ],
        },
        "card_images": [
            [str(image.card_id), str(image.document_id), image.source_id]
            for m in maps
            for image in m.card_images
        ],
        "skipped": [],
        "skipped_maps": [
            {"name": m.name, "reason": (m.skipped or MapSkipReason.LIMIT).value}
            for m in plan.maps
            if m.key not in created_maps
        ],
        "skipped_sections": [
            _skipped_section(s, (s.skipped or SectionSkipReason.LIMIT).value)
            for s in plan.sections
            if s.key not in written
        ],
    }


async def _run_images(job_id: uuid.UUID, room_id: uuid.UUID, importer_id: uuid.UUID) -> None:
    """Works through the job's image list a block at a time, saving after
    each, then points the map cards at their images and marks the job done
    with what it did."""
    while True:
        async with session_module.independent_session() as session:
            job = await import_jobs_repo.get_job(session, job_id)
        if job is None or job.progress is None:
            return  # failed by the sweep meanwhile, or its Room deleted
        progress = job.progress
        if progress["done"] >= len(progress["work"]):
            break
        done, block = next_block(progress)
        skipped = await _attach_block(job_id, room_id, importer_id, block)
        async with session_module.independent_session() as session:
            await import_jobs_repo.save_block(session, job_id, done, skipped)
            await session.commit()

    work = progress["work"]
    attached = {
        (uuid.UUID(work[int(index)]["target"]), work[int(index)]["source_id"]): uuid.UUID(value)
        for index, value in progress["stored"].items()
        if work[int(index)]["kind"] == "image" and work[int(index)]["source_id"] is not None
    }
    cards = [
        CardImage(uuid.UUID(card), uuid.UUID(document), source)
        for card, document, source in progress["card_images"]
    ]
    await _point_card_images(cards, attached)
    result = {
        **progress["result"],
        "skipped": progress["skipped"],
        "skipped_maps": progress["skipped_maps"],
        "skipped_sections": progress["skipped_sections"],
        "images": {"total": len(work), "stored": len(progress["stored"])},
    }
    async with session_module.independent_session() as session:
        await import_jobs_repo.mark_done(session, job_id, result, datetime.now(UTC))
        await session.commit()


async def _fail(job_id: uuid.UUID, error: str) -> None:
    """Marks the job failed, in its own transaction; a failure of that is only
    logged (the sweep fails a job left active)."""
    try:
        async with session_module.independent_session() as session:
            await import_jobs_repo.mark_failed(session, job_id, error, datetime.now(UTC))
            await session.commit()
    except Exception:
        logger.exception("Could not mark import %s as failed", job_id)


async def _start(job_id: uuid.UUID) -> tuple[ImportJob, Membership, ImportPlan] | None:
    """Marks the queued job running, checks the importer is still a member who
    may create Documents (Decision 10) and plans the import against the Room
    now. None for a job that isn't queued."""
    async with session_module.independent_session() as session:
        job = await import_jobs_repo.get_job(session, job_id)
        if job is None or job.status is not ImportStatus.QUEUED or job.payload is None:
            return None
        await import_jobs_repo.mark_running(session, job_id)
        await session.commit()

        importer = await rooms_repo.get_membership(session, job.room_id, job.requested_by)
        room = await rooms_repo.get_room(session, job.room_id)
        if importer is None or room is None:
            raise ImportRefusedByRoomError
        if not can_create_document(importer.role, room.players_can_create_documents):
            raise ImportRefusedByRoomError
        files, choices = _from_payload(job.payload)
        context = await load_import_context(session, room, importer)
        return job, importer, plan_import(files, context, choices)


async def _write(
    job: ImportJob, importer: Membership, plan: ImportPlan
) -> tuple[list[dict[str, str]], list[dict[str, str]], list[PlannedMap], list[PlannedSection]]:
    """The one transaction of the import (Decision 9): Tags, copied Documents,
    replaced information, backlinks, history, the maps (spec 40) and the
    Sections of the Room home (spec 56). Returns the Documents created and
    replaced as `{id, name}`, the maps created (the planned ones the Room
    still has room for, counted under its lock: a map created meanwhile
    pushes the last ones out, as `limit`) and the Sections written, likewise."""
    now = datetime.now(UTC)
    copies = [d for d in plan.documents if not d.replaces]
    replaced = [d for d in plan.documents if d.replaces]
    async with session_module.independent_session() as session:
        for document in sorted(replaced, key=lambda d: str(d.id)):
            await documents_repo.lock_document(session, document.id)
        await imports_repo.insert_tags(session, job.room_id, plan.new_tags)
        await imports_repo.insert_copies(session, job.room_id, importer.user_id, copies, now)
        await imports_repo.replace_information(session, importer.user_id, replaced, now)
        for document in plan.documents:
            await _index(session, document)
        for document in replaced:
            # One new revision, so the replace can be undone from the history.
            await record_revision(session, document.id, importer.user_id, now=now, force_new=True)
        maps = [m for m in plan.maps if m.skipped is None]
        if maps:
            await rooms_repo.lock_room(session, job.room_id)
            room_left = MAX_MAPS_PER_ROOM - await relationship_maps_repo.count_maps_for_room(
                session, job.room_id
            )
            maps = maps[: max(room_left, 0)]
            await map_transfer_repo.insert_maps(
                session,
                [to_source_map(m, job.room_id, importer.user_id, now) for m in maps],
                importer.user_id,
                now,
            )
        sections = await _write_sections(
            session, job.room_id, [s for s in plan.sections if s.skipped is None]
        )
        await _write_clocks(session, job.room_id, importer.user_id, plan, now)
        await session.commit()
        await session_module.run_after_commit(session)
    return (
        [{"id": str(d.id), "name": d.name} for d in copies],
        [{"id": str(d.id), "name": d.name} for d in replaced],
        maps,
        sections,
    )


async def _write_clocks(
    session: AsyncSession,
    room_id: uuid.UUID,
    importer_id: uuid.UUID,
    plan: ImportPlan,
    now: datetime,
) -> None:
    """Spec 61 Decision 27: the Master's import adds the files' clocks and
    groups, under the Room's lock and within its caps, merging labels and
    mark kinds by name; it tells the Room's streams."""
    if not plan.clock_files:
        return
    await rooms_repo.lock_room(session, room_id)
    planned = plan_clock_import(
        [data for data, _ in plan.clock_files],
        [documents for _, documents in plan.clock_files],
        room_id,
        importer_id,
        now,
        await clocks_repo.list_labels(session, room_id),
        await clocks_repo.list_kinds(session, room_id),
        MAX_CLOCKS_PER_ROOM - await clocks_repo.count_clocks(session, room_id),
        MAX_GROUPS_PER_ROOM - await clocks_repo.count_groups(session, room_id),
        await clocks_repo.next_position(session, room_id),
    )
    if not planned.clocks and not planned.groups and not planned.labels and not planned.kinds:
        return
    await clocks_repo.insert_import(session, planned)
    push(session, room_id, Event(None, CHANGED, None, CLOCK_RULES))


async def _write_sections(
    session: AsyncSession, room_id: uuid.UUID, planned: list[PlannedSection]
) -> list[PlannedSection]:
    """Writes the planned Sections against the Room home as it is now,
    under the Room's lock (spec 56 Decisions 5, 6, 8): a page card onto the
    Room's card of its kind, or added back last when the Room has none; a
    custom Section last. One past the cap is left out (the caller lists it
    as `limit`). Returns what was written, each under its id in the Room,
    and tells the Room's streams."""
    if not planned:
        return []
    await rooms_repo.lock_room(session, room_id)
    landing = await room_sections_repo.list_sections(session, room_id)
    written: list[PlannedSection] = []
    new: list[Section] = []
    for section in planned:
        own = next((s for s in landing if s.kind is section.kind), None)
        if section.is_page_card and own is not None:
            await room_sections_repo.update_section(
                session, replace(own, title=section.title, description=section.description)
            )
            written.append(replace(section, id=own.id))
            continue
        try:
            position = plan_new_section(room_id, landing, section.kind, section.title).position
        except TooManySectionsError:
            continue
        row = to_section(section, room_id, position)
        landing.append(row)
        new.append(row)
        written.append(section)
    await room_sections_repo.insert_sections(session, new)
    push(session, room_id, Event(None, CHANGED, None, LANDING))
    return written


def _skipped_section(section: PlannedSection, reason: str) -> dict[str, str | None]:
    """A Section of the file the result lists as not written, or without
    its image."""
    return {"kind": section.kind.value, "title": section.title, "reason": reason}


async def _index(session: AsyncSession, document: PlannedDocument) -> None:
    """Writes the backlinks a Document's description and Notes hold (spec 20).
    A replaced Document's description is always rewritten, to clear the old
    ones; its old Notes took theirs with them."""
    description = plan_source_mentions(document.text, document.id)
    if description or document.replaces:
        await mentions_repo.replace_mentions(
            session, MentionSource(document.id, MentionSourceKind.DESCRIPTION), description
        )
    for note in document.notes:
        planned = plan_source_mentions(note.text, document.id)
        if planned:
            await mentions_repo.replace_mentions(
                session,
                MentionSource(document.id, MentionSourceKind.NOTE, note_id=note.id),
                planned,
            )


def _skip(plan_document: PlannedDocument, url: str, reason: str) -> dict[str, str]:
    """A skipped image, named without its query string (a signed link's token
    is the file's own business)."""
    parts = urlsplit(url)
    if url.startswith(VAULT_URL_PREFIX):  # the picture's place in the vault
        return {
            "kind": "image",
            "document_id": str(plan_document.id),
            "document_name": plan_document.name,
            "url": url.removeprefix(VAULT_URL_PREFIX)[:200],
            "reason": reason,
        }
    return {
        "kind": "image",
        "document_id": str(plan_document.id),
        "document_name": plan_document.name,
        "url": f"{parts.scheme}://{parts.netloc}{parts.path}"[:200],
        "reason": reason,
    }


async def _attach_block(
    job_id: uuid.UUID,
    room_id: uuid.UUID,
    importer_id: uuid.UUID,
    block: list[tuple[int, dict[str, Any]]],
) -> dict[str, list[Any]]:
    """Fetches and stores one block of the work list, a few at a time, the
    entries of one target in order (a Document's favorite first). One that
    fails is skipped and listed, never failing the import (spec 27 Decision
    15); what it was skipped from, by result list, is returned."""
    skipped: dict[str, list[Any]] = {"skipped": [], "skipped_maps": [], "skipped_sections": []}
    gate = asyncio.Semaphore(_IMAGES_AT_ONCE)
    database = asyncio.Lock()
    by_target: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    for index, entry in block:
        by_target.setdefault(entry["target"], []).append((index, entry))

    async def one_target(entries: list[tuple[int, dict[str, Any]]]) -> None:
        for index, entry in entries:
            target = uuid.UUID(entry["target"])
            if entry["kind"] == "image":
                async with gate:
                    data = await _image_bytes(entry["url"], room_id, job_id, importer_id)
                if data is None:
                    skipped["skipped"].append({**entry["skip"], "reason": "unreachable"})
                    continue
                async with database:
                    reason = await _store_image(room_id, importer_id, target, data, job_id, index)
                if isinstance(reason, str):
                    skipped["skipped"].append({**entry["skip"], "reason": reason})
            elif entry["kind"] == "background":
                async with database:  # few, one at a time as before spec 59
                    stored = await _store_background(
                        room_id, importer_id, target, entry["url"], job_id, index
                    )
                if not stored:
                    skipped["skipped_maps"].append(entry["skip"])
            else:
                async with database:  # few, one at a time as before spec 59
                    stored = await _store_section_image(
                        room_id, importer_id, target, entry["url"], job_id, index
                    )
                if not stored:
                    skipped["skipped_sections"].append(entry["skip"])

    await asyncio.gather(*(one_target(entries) for entries in by_target.values()))
    return skipped


async def _image_bytes(
    url: str, room_id: uuid.UUID, job_id: uuid.UUID, importer_id: uuid.UUID
) -> bytes | None:
    """The bytes of one image to attach, or None when they can't be had: a
    picture of the uploaded vault is read from its staging (spec 65), any other
    link from this app's own bucket or else fetched from its address."""
    if url.startswith(VAULT_URL_PREFIX):
        try:
            return await import_staging.read(room_id, job_id, url.removeprefix(VAULT_URL_PREFIX))
        except storage.StorageError:
            return None
    data = await _read_own_image(url, importer_id)
    if data is None:
        try:
            data = await remote_images.fetch_image_bytes(url)
        except remote_images.RemoteImageError:
            return None
    return data


async def _read_own_image(url: str, importer_id: uuid.UUID) -> bytes | None:
    """The bytes of an image the file links in this app's own bucket, read
    straight from Storage, so an export's signed links still import after they
    expire (an hour at most). Only when the importer sees that image right now,
    in its own Room, as on every read path (Invariant 1): the link's token is
    not trusted for that. None sends the caller to the plain URL fetch, which
    needs the token to still be valid."""
    path = storage.own_object_path(url)
    if path is None:
        return None
    async with session_module.independent_session() as session:
        image = await documents_repo.get_image_by_storage_path(session, path)
        if image is None:
            return None
        document = await documents_repo.get_document(session, image.document_id)
        if document is None:  # pragma: no cover - the image row cascades with its Document
            return None
        viewer = await rooms_repo.get_membership(session, document.room_id, importer_id)
        if viewer is None:
            return None
        owners = await documents_repo.list_owner_ids(session, document.id)
        grants = await documents_repo.list_selective_grant_ids(session, document.id)
        if not is_document_visible(document, viewer.user_id, viewer.role, owners, grants):
            return None
        if image.id not in {i.id for i in await get_visible_images(session, document.id, viewer)}:
            return None
    try:
        return await storage.download(path, MAX_INPUT_BYTES)
    except storage.StorageError:
        logger.warning("An imported image could not be read from Storage", exc_info=True)
        return None


async def _store_image(
    room_id: uuid.UUID,
    importer_id: uuid.UUID,
    document_id: uuid.UUID,
    data: bytes,
    job_id: uuid.UUID,
    index: int,
) -> uuid.UUID | str | None:
    """Attaches one fetched image to its Document in the usual order
    (`record_pending_upload`, upload, row and `confirm_upload` in one
    transaction, which also marks entry `index` of the job's work list
    stored), so a crash leaks nothing and a resume adds nothing twice. The
    new image's id when it is stored, else why it was skipped; None for a
    Document deleted meanwhile, which just drops its images."""
    try:
        normalized = await asyncio.to_thread(normalize_image, data)
    except ImageTooLargeError:
        return "too_large"
    except InvalidImageError:
        return "not_an_image"
    try:
        async with session_module.independent_session() as session:
            row = await documents_repo.get_document(session, document_id)
            if row is None or row.room_id != room_id:
                return None
            await documents_repo.lock_document(session, document_id)
            current = await documents_repo.list_images(session, document_id)
            if len(current) >= MAX_IMAGES_PER_DOCUMENT:
                return "limit"
            image = plan_new_image(room_id, document_id, normalized.extension, importer_id, current)
            await storage_cleanup.record_pending_upload(image.storage_path)
            await storage.upload(image.storage_path, normalized.data, normalized.content_type)
            await documents_repo.insert_image(session, image)
            await storage_cleanup.confirm_upload(session, image.storage_path)
            await import_jobs_repo.mark_stored(session, job_id, index, str(image.id))
            await session.commit()
    except storage.StorageError:
        return "storage"
    except Exception:
        logger.exception("An imported image could not be attached")
        return "failed"
    return image.id


async def _point_card_images(
    wanted: list[CardImage], attached: dict[tuple[uuid.UUID, str], uuid.UUID]
) -> None:
    """Points each created card at the image it chose in the file (spec 40
    Decision 13): the image the job just attached, or for a replaced
    Document one it still has under the file's id. A card whose image never
    came keeps showing its Document's favorite. One query and one statement."""
    if not wanted:
        return
    async with session_module.independent_session() as session:
        # A card's image id in the file is a UUID (`read_map` checks it).
        candidates = {image.card_id: uuid.UUID(image.source_id) for image in wanted}
        kept = {
            (document_id, image_id)
            for document_id, image_id in await session.execute(
                select(DocumentImageRow.document_id, DocumentImageRow.id).where(
                    DocumentImageRow.id.in_(list(candidates.values())),
                    DocumentImageRow.post_id.is_(None),
                )
            )
        }
        values = []
        for image in wanted:
            found = attached.get((image.document_id, image.source_id))
            existing = candidates.get(image.card_id)
            if found is None and (image.document_id, existing) in kept:
                found = existing
            if found is not None:
                values.append({"id": image.card_id, "image_id": found})
        if values:
            # ORM bulk UPDATE by primary key: one statement for every card.
            await session.execute(update(RelationshipMapCardRow), values)
        await session.commit()


async def _store_background(
    room_id: uuid.UUID,
    importer_id: uuid.UUID,
    map_id: uuid.UUID,
    url: str,
    job_id: uuid.UUID,
    index: int,
) -> bool:
    """One created geographic map's background (spec 40 Decision 13), like
    an uploaded one: read from this app's Storage when the importer sees a
    map that has it, else fetched from `url`; validated, at most
    `MAX_BACKGROUND_DIMENSION` px, the usual Storage order, entry `index`
    marked stored with it. Whether it is stored; a map deleted meanwhile
    counts as done."""
    data = await _read_own_background(url, importer_id)
    try:
        if data is None:
            data = await remote_images.fetch_image_bytes(url)
        normalized = await asyncio.to_thread(normalize_image, data, MAX_BACKGROUND_DIMENSION)
    except (remote_images.RemoteImageError, ImageTooLargeError, InvalidImageError):
        return False
    path = plan_background_path(room_id, map_id, normalized.extension)
    try:
        async with session_module.independent_session() as session:
            if await relationship_maps_repo.lock_map(session, map_id) is None:
                return True  # pragma: no cover - only a deletion while the job runs
            await storage_cleanup.record_pending_upload(path)
            await storage.upload(path, normalized.data, normalized.content_type)
            await relationship_maps_repo.set_background(session, map_id, path)
            await storage_cleanup.confirm_upload(session, path)
            await import_jobs_repo.mark_stored(session, job_id, index, "")
            await session.commit()
    except storage.StorageError:
        return False
    except Exception:
        logger.exception("An imported map background could not be attached")
        return False
    return True


async def _read_own_background(url: str, importer_id: uuid.UUID) -> bytes | None:
    """The bytes of a map background the file links in this app's own bucket,
    read straight from Storage like `_read_own_image`, only when the importer
    sees, right now, a map that has it as its background (Invariant 1)."""
    path = storage.own_object_path(url)
    if path is None:
        return None
    async with session_module.independent_session() as session:
        maps = (
            await session.scalars(
                select(RelationshipMapRow).where(RelationshipMapRow.background_path == path)
            )
        ).all()
        grants = await relationship_maps_repo.list_grants_for_maps(session, [m.id for m in maps])
        visible = False
        for row in maps:
            viewer = await rooms_repo.get_membership(session, row.room_id, importer_id)
            relationship_map = await relationship_maps_repo.get_map(session, row.id)
            if viewer is not None and relationship_map is not None:
                visible = visible or is_map_visible(
                    relationship_map, viewer.user_id, viewer.role, grants[row.id]
                )
        if not visible:
            return None
    try:
        return await storage.download(path, MAX_INPUT_BYTES)
    except storage.StorageError:
        logger.warning("An imported map background could not be read from Storage", exc_info=True)
        return None


async def _store_section_image(
    room_id: uuid.UUID,
    importer_id: uuid.UUID,
    section_id: uuid.UUID,
    url: str,
    job_id: uuid.UUID,
    index: int,
) -> bool:
    """One written Section's image (spec 56 Decision 9), read from this
    app's Storage when the importer is a member of a Room that has it, else
    fetched from `url`; validated, re-encoded and swapped in with the usual
    Storage order, entry `index` marked stored with it. Whether it is
    stored; a Section deleted meanwhile counts as done."""
    data = await _read_own_section_image(url, importer_id)
    try:
        if data is None:
            data = await remote_images.fetch_image_bytes(url)
        normalized = await asyncio.to_thread(normalize_image, data)
    except (remote_images.RemoteImageError, ImageTooLargeError, InvalidImageError):
        return False
    path = plan_section_image_path(room_id)
    try:
        async with session_module.independent_session() as session:
            await rooms_repo.lock_room(session, room_id)
            section = await room_sections_repo.get_section(session, room_id, section_id)
            if section is None:  # pragma: no cover - only a deletion while the job runs
                return True
            await storage_cleanup.record_pending_upload(path)
            await storage.upload(path, normalized.data, normalized.content_type)
            await room_sections_repo.set_section_image(session, section_id, path)
            await storage_cleanup.confirm_upload(session, path)
            if section.image_path is not None:
                await storage_cleanup.schedule_removal(session, [section.image_path])
            push(session, room_id, Event(None, CHANGED, section_id, LANDING))
            await import_jobs_repo.mark_stored(session, job_id, index, "")
            await session.commit()
            await session_module.run_after_commit(session)
    except storage.StorageError:
        return False
    except Exception:
        logger.exception("An imported Section image could not be stored")
        return False
    return True


async def _read_own_section_image(url: str, importer_id: uuid.UUID) -> bytes | None:
    """The bytes of a Section image the file links in this app's own bucket,
    read straight from Storage like `_read_own_image`, only when the importer
    is a member, right now, of a Room whose Room home shows it (every member
    sees every Section, spec 55, Invariant 1)."""
    path = storage.own_object_path(url)
    if path is None:
        return None
    async with session_module.independent_session() as session:
        room_ids = (
            await session.scalars(
                select(RoomSectionRow.room_id).where(RoomSectionRow.image_path == path)
            )
        ).all()
        member = False
        for owner_room in set(room_ids):
            member = (
                member
                or await rooms_repo.get_membership(session, owner_room, importer_id) is not None
            )
        if not member:
            return None
    try:
        return await storage.download(path, MAX_INPUT_BYTES)
    except storage.StorageError:
        logger.warning("An imported Section image could not be read from Storage", exc_info=True)
        return None

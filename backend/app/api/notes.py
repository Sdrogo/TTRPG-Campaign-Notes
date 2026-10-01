"""Notes on a Document (spec 12): extra blocks with a title, a description and
a visibility of their own. A Note is reachable only through a Document the
requester can see, and is then filtered by its own visibility (VR-03); one
they can't see is absent from every response (Invariant 1, VR-07). Owners and
the Master manage Notes (D-12)."""

import uuid
from collections.abc import Collection
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import (
    DocumentNotes,
    ensure_room_members,
    get_document_notes,
    get_visible_document,
    require_membership,
)
from app.api.errors import http_error, translated_error
from app.api.validation import UniqueIds
from app.auth.dependencies import CurrentUserDep
from app.db import documents_repo, notes_repo, rooms_repo
from app.db.session import SessionDep
from app.domain.errors import DomainError
from app.domain.models import DocumentVisibility, Membership, Note
from app.domain.notes import (
    InvalidNoteOrderError,
    NoteTitleRequiredError,
    NoteTitleTooLongError,
    NotNoteManagerError,
    TooManyNotesError,
    can_manage_notes,
    ensure_can_manage_notes,
    plan_new_note,
    plan_note_edit,
    plan_note_order,
)
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/documents/{document_id}/notes", tags=["notes"])


class NoteResponse(BaseModel):
    """A Note as every route serializes it, for one viewer."""

    id: uuid.UUID
    document_id: uuid.UUID
    title: str
    description: str
    visibility: DocumentVisibility
    # Who a Selective Note is shared with. Sent only to those who can edit the
    # Note: a reader sees the level, not who else was let in.
    selective_user_ids: list[uuid.UUID]
    position: int
    created_at: datetime
    updated_at: datetime
    # What the requester may do with this Note, decided by the domain layer
    # so the UI never re-derives permission rules.
    can_edit: bool
    can_delete: bool


class CreateNoteRequest(BaseModel):
    """A new Note with its visibility level and, for Selective, who else may
    read it."""

    title: str
    description: str = ""
    visibility: DocumentVisibility = DocumentVisibility.ROOM
    selective_user_ids: UniqueIds = []


class UpdateNoteRequest(BaseModel):
    """A partial edit: omitted fields are left as they are. Changing the
    visibility or the grants is audited (VR-08)."""

    title: str | None = None
    description: str | None = None
    visibility: DocumentVisibility | None = None
    selective_user_ids: UniqueIds | None = None


class NoteOrderRequest(BaseModel):
    """The Notes the requester sees, in the order they want them. Not
    de-duplicated on purpose: a repeated id is a 422, not a silent fix."""

    note_ids: list[uuid.UUID]


def note_response(
    note: Note,
    selective_ids: Collection[uuid.UUID],
    viewer: Membership,
    owner_ids: Collection[uuid.UUID],
) -> NoteResponse:
    """Serializes a Note the viewer is known to see, with the permission flags
    the UI shows or hides its actions by."""
    can_manage = can_manage_notes(viewer.role, viewer.user_id, owner_ids)
    return NoteResponse(
        id=note.id,
        document_id=note.document_id,
        title=note.title,
        description=note.description,
        visibility=note.visibility,
        selective_user_ids=sorted(selective_ids) if can_manage else [],
        position=note.position,
        created_at=note.created_at,
        updated_at=note.updated_at,
        can_edit=can_manage,
        can_delete=can_manage,
    )


def visible_note_responses(
    notes: DocumentNotes, viewer: Membership, owner_ids: Collection[uuid.UUID]
) -> list[NoteResponse]:
    """The Notes a viewer may see, serialized in display order."""
    return [note_response(note, notes.grants[note.id], viewer, owner_ids) for note in notes.visible]


def _title_error(exc: DomainError, locale: str) -> HTTPException:
    """The 422 for a Note title that is empty or too long."""
    return translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale)


async def _require_document(
    session: AsyncSession,
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    requester_id: uuid.UUID,
    locale: str,
) -> tuple[Membership, list[uuid.UUID]]:
    """The requester's Membership and the Document's Owner ids, once they are
    known to be a member who can see the Document."""
    membership = await require_membership(session, room_id, requester_id, locale)
    _, owner_ids, _ = await get_visible_document(
        session, room_id, document_id, requester_id, membership.role, locale
    )
    return membership, owner_ids


def _ensure_manager(membership: Membership, owner_ids: Collection[uuid.UUID], locale: str) -> None:
    """403 unless the requester is an Owner of the Document or the Master."""
    try:
        ensure_can_manage_notes(membership.role, membership.user_id, owner_ids)
    except NotNoteManagerError as exc:
        raise translated_error(status.HTTP_403_FORBIDDEN, exc, locale) from exc


def _get_visible_note(notes: DocumentNotes, note_id: uuid.UUID, locale: str) -> Note:
    """The Note, once the viewer is known to see it; 404 otherwise, whether or
    not it exists (VR-07). Looked up among the Document's visible Notes, so a
    Note of another Document is not found either."""
    note = next((n for n in notes.visible if n.id == note_id), None)
    if note is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.note.notFound", locale)
    return note


@router.get("")
async def list_notes(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> list[NoteResponse]:
    """The Document's Notes the requester can see, in display order."""
    requester_id = uuid.UUID(current_user.id)
    membership, owner_ids = await _require_document(
        session, room_id, document_id, requester_id, locale
    )
    notes = await get_document_notes(session, document_id, membership, owner_ids)
    return visible_note_responses(notes, membership, owner_ids)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_note(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    body: CreateNoteRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> NoteResponse:
    """An Owner (or the Master) adds a Note after the Document's others, up to
    `MAX_NOTES_PER_DOCUMENT` (409 beyond)."""
    requester_id = uuid.UUID(current_user.id)
    membership, owner_ids = await _require_document(
        session, room_id, document_id, requester_id, locale
    )
    _ensure_manager(membership, owner_ids, locale)

    # Locked before the count and the position are read, so two concurrent
    # creates can't both slip under the cap or share a position.
    await documents_repo.lock_document(session, document_id)
    existing = await notes_repo.list_notes_for_document(session, document_id)
    try:
        note = plan_new_note(
            document_id,
            requester_id,
            body.title,
            body.description,
            body.visibility,
            existing,
            datetime.now(UTC),
        )
    except (NoteTitleRequiredError, NoteTitleTooLongError) as exc:
        raise _title_error(exc, locale) from exc
    except TooManyNotesError as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc

    await ensure_room_members(
        session, room_id, body.selective_user_ids, "errors.note.invalidSelectiveUsers", locale
    )
    await notes_repo.insert_note(session, note, body.selective_user_ids)
    return note_response(note, body.selective_user_ids, membership, owner_ids)


@router.put("/order")
async def reorder_notes(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    body: NoteOrderRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> list[NoteResponse]:
    """An Owner (or the Master) puts the Notes they see in a new order. A Note
    hidden from them keeps its slot (`plan_note_order`). 422 unless `note_ids`
    is exactly the Notes they can see."""
    requester_id = uuid.UUID(current_user.id)
    membership, owner_ids = await _require_document(
        session, room_id, document_id, requester_id, locale
    )
    _ensure_manager(membership, owner_ids, locale)

    # Locked first: the read below decides where every Note lands.
    await documents_repo.lock_document(session, document_id)
    notes = await get_document_notes(session, document_id, membership, owner_ids)
    try:
        ordered_ids = plan_note_order(
            [note.id for note in notes.every],
            {note.id for note in notes.visible},
            body.note_ids,
        )
    except InvalidNoteOrderError as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc

    await notes_repo.set_note_positions(session, ordered_ids)
    reordered = await get_document_notes(session, document_id, membership, owner_ids)
    return visible_note_responses(reordered, membership, owner_ids)


@router.patch("/{note_id}")
async def update_note(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    note_id: uuid.UUID,
    body: UpdateNoteRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> NoteResponse:
    """An Owner (or the Master) edits a Note's title, description, visibility
    or grants. A change of who can see it is audited in the same transaction
    (VR-08, Invariant 7)."""
    requester_id = uuid.UUID(current_user.id)
    membership, owner_ids = await _require_document(
        session, room_id, document_id, requester_id, locale
    )
    notes = await get_document_notes(session, document_id, membership, owner_ids)
    # Visibility first (404), then permission (403): otherwise the status
    # would tell a non-manager whether a hidden Note exists.
    note = _get_visible_note(notes, note_id, locale)
    _ensure_manager(membership, owner_ids, locale)

    selective_ids = notes.grants[note.id]
    try:
        plan = plan_note_edit(
            note,
            room_id,
            requester_id,
            datetime.now(UTC),
            title=body.title,
            description=body.description,
            visibility=body.visibility,
            current_selective_ids=selective_ids,
            new_selective_ids=body.selective_user_ids,
        )
    except (NoteTitleRequiredError, NoteTitleTooLongError) as exc:
        raise _title_error(exc, locale) from exc

    if body.selective_user_ids is not None:
        await ensure_room_members(
            session, room_id, body.selective_user_ids, "errors.note.invalidSelectiveUsers", locale
        )

    await notes_repo.update_note(session, plan.note)
    if body.selective_user_ids is not None:
        await notes_repo.set_note_grants(session, note_id, body.selective_user_ids)
        selective_ids = body.selective_user_ids
    if plan.audit_entry is not None:
        await rooms_repo.insert_audit_log(session, plan.audit_entry)
    return note_response(plan.note, selective_ids, membership, owner_ids)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    note_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """An Owner (or the Master) deletes a Note they can see, for good."""
    requester_id = uuid.UUID(current_user.id)
    membership, owner_ids = await _require_document(
        session, room_id, document_id, requester_id, locale
    )
    notes = await get_document_notes(session, document_id, membership, owner_ids)
    note = _get_visible_note(notes, note_id, locale)
    _ensure_manager(membership, owner_ids, locale)
    await notes_repo.delete_note(session, note.id)

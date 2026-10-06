"""History of a whole Document, its Notes included (spec 24b, FR-D5): list,
read and restore. Only the Document's Owners and the Master see or restore
revisions (D-12), and each sees them projected on the Notes they may read
(VR-03, VR-07). Text edits aren't audited (Invariant 7): the history is the
record. `record_revision` at the top is what every route that changes the
Document's text or its Notes calls."""

import uuid
from dataclasses import replace
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import get_document_notes, get_owned_document
from app.api.errors import http_error, translated_error
from app.api.mentions import clean_content_mentions, index_mentions
from app.auth.dependencies import CurrentUserDep
from app.db import documents_repo, notes_repo, rooms_repo, versions_repo
from app.db.session import SessionDep
from app.domain.models import Membership, MentionSource, MentionSourceKind, Note
from app.domain.notes import TooManyNotesError
from app.domain.versions import (
    DocumentState,
    Version,
    change_size,
    note_states,
    plan_restore,
    plan_version,
    visible_history,
    visible_note_ids,
)
from app.i18n.dependencies import LocaleDep

router = APIRouter(tags=["versions"])

_VERSIONS = "/rooms/{room_id}/documents/{document_id}/versions"


class NoteVersionResponse(BaseModel):
    """A Note as the revision holds it."""

    id: uuid.UUID
    title: str
    description: str


class VersionSummaryResponse(BaseModel):
    """A revision in the history list, without its texts. `title` is the
    Document's name as it was then."""

    id: uuid.UUID
    title: str
    # The member who saved it, a user id the client resolves through the
    # members list (like `owner_ids`).
    edited_by: uuid.UUID
    created_at: datetime
    # The last save merged into this revision (spec 24 Decision 2).
    updated_at: datetime
    # What it changed against the previous revision the requester sees, only
    # counting what they see; all null for the first one, which has nothing
    # before it, and in a restore's reply.
    words_added: int | None
    words_removed: int | None
    notes_added: int | None
    notes_removed: int | None


class VersionResponse(VersionSummaryResponse):
    """One revision in full: the description and the Notes the requester may
    read, in display order."""

    description: str
    notes: list[NoteVersionResponse]


def _summary(
    version: Version, state: DocumentState, older: DocumentState | None
) -> VersionSummaryResponse:
    """A revision for the list, with its change size against `older`."""
    size = change_size(older, state) if older is not None else None
    return VersionSummaryResponse(
        id=version.id,
        title=state.name,
        edited_by=version.edited_by,
        created_at=version.created_at,
        updated_at=version.updated_at,
        words_added=None if size is None else size.words_added,
        words_removed=None if size is None else size.words_removed,
        notes_added=None if size is None else size.notes_added,
        notes_removed=None if size is None else size.notes_removed,
    )


def _full(version: Version, state: DocumentState, older: DocumentState | None) -> VersionResponse:
    """A revision in full, projected (`state`), with its change size."""
    return VersionResponse(
        **_summary(version, state, older).model_dump(),
        description=state.description,
        notes=[
            NoteVersionResponse(id=note.id, title=note.title, description=note.description)
            for note in state.notes
        ],
    )


async def _current_state(session: AsyncSession, document_id: uuid.UUID) -> DocumentState | None:
    """The Document's text and every Note as stored now, or None if the
    Document is gone."""
    document = await documents_repo.get_document(session, document_id)
    if document is None:  # pragma: no cover - only a concurrent Document deletion
        return None
    notes = await notes_repo.list_notes_for_document(session, document_id)
    grants = await notes_repo.list_grants_for_notes(session, [note.id for note in notes])
    return DocumentState(document.name, document.description, note_states(notes, grants))


async def record_revision(
    session: AsyncSession,
    document_id: uuid.UUID,
    editor: uuid.UUID,
    *,
    now: datetime | None = None,
    force_new: bool = False,
) -> Version | None:
    """Records the Document as it is now in its history (`plan_version`) and
    returns the latest revision afterwards. Call it in the same transaction,
    after any change to the Document's name or description or to its Notes
    (created, edited, deleted, reordered, or their visibility changed: that
    rewrites the latest revision without adding one). Takes the Document's
    row lock first, so two saves in flight can't both append where one should
    merge."""
    await documents_repo.lock_document(session, document_id)
    state = await _current_state(session, document_id)
    if state is None:  # pragma: no cover - only a concurrent Document deletion
        return None
    latest = await versions_repo.get_latest_version(session, document_id)
    write = plan_version(latest, editor, now or datetime.now(UTC), state, force_new=force_new)
    if write is None:
        return latest
    if write.is_new:
        await versions_repo.insert_version(session, document_id, write.version)
    else:
        await versions_repo.update_version(session, write.version)
    return write.version


def _version_not_found(locale: str) -> HTTPException:
    """The 404 for a revision that doesn't exist, belongs elsewhere or isn't
    in the requester's view of the history."""
    return http_error(status.HTTP_404_NOT_FOUND, "errors.version.notFound", locale)


async def _history_for(
    session: AsyncSession,
    document_id: uuid.UUID,
    membership: Membership,
    owner_ids: list[uuid.UUID],
) -> tuple[list[tuple[Version, DocumentState]], set[uuid.UUID], list[Note], set[uuid.UUID]]:
    """The history as the requester sees it (`visible_history`), the Notes of
    it they may read, and the Document's Notes now: every one in display
    order, and the ids of those the requester sees."""
    history = await versions_repo.list_versions(session, document_id)
    notes = await get_document_notes(session, document_id, membership, owner_ids)
    visible_now = {note.id for note in notes.visible}
    readable = visible_note_ids(
        history,
        [note.id for note in notes.every],
        visible_now,
        membership.user_id,
        membership.role,
        owner_ids,
    )
    return visible_history(history, readable), readable, notes.every, visible_now


@router.get(_VERSIONS)
async def list_document_versions(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> list[VersionSummaryResponse]:
    """The Document's history (name, description and Notes), newest first,
    without the texts. Owners and the Master only: 404 for a Document the
    requester can't see (VR-07), 403 for a member who isn't an Owner (D-12).
    A revision that only changed Notes hidden from the requester isn't
    listed, and the counts only count what they see."""
    _, owner_ids, membership = await get_owned_document(
        session, room_id, document_id, uuid.UUID(current_user.id), locale
    )
    history, *_ = await _history_for(session, document_id, membership, owner_ids)
    return [
        _summary(version, state, history[index + 1][1] if index + 1 < len(history) else None)
        for index, (version, state) in enumerate(history)
    ]


@router.get(_VERSIONS + "/{version_id}")
async def get_document_version(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    version_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> VersionResponse:
    """One revision in full, with the Notes the requester may read, for the
    comparison. Same access as the list; 404 for a revision of another
    Document or one the list leaves out."""
    _, owner_ids, membership = await get_owned_document(
        session, room_id, document_id, uuid.UUID(current_user.id), locale
    )
    history, *_ = await _history_for(session, document_id, membership, owner_ids)
    for index, (version, state) in enumerate(history):
        if version.id == version_id:
            older = history[index + 1][1] if index + 1 < len(history) else None
            return _full(version, state, older)
    raise _version_not_found(locale)


@router.post(_VERSIONS + "/{version_id}/restore")
async def restore_document_version(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    version_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> VersionResponse:
    """Puts the whole Document back as it was in a revision (spec 24b Decision
    5): name, description and the Notes the requester sees, with their texts
    and order; Notes deleted since come back (same id, their last visibility,
    grants to members still in the Room), Notes added since are deleted. A
    Note hidden from the requester is never touched. The restore is itself a
    new revision, so nothing is lost, and it never merges into the previous
    one. Mention links to content the requester can't see are unlinked, like
    on any save. 409 when the Notes would pass the cap. Returns the revision
    now in force; the client reloads the Document."""
    requester_id = uuid.UUID(current_user.id)
    document, owner_ids, membership = await get_owned_document(
        session, room_id, document_id, requester_id, locale
    )
    await documents_repo.lock_document(session, document_id)
    history, readable, every, visible_now = await _history_for(
        session, document_id, membership, owner_ids
    )
    target = next((state for version, state in history if version.id == version_id), None)
    if target is None:
        raise _version_not_found(locale)
    try:
        plan = plan_restore(target, [note.id for note in every], visible_now)
    except TooManyNotesError as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc

    description = await clean_content_mentions(
        session, membership, target.description, previous=document.description
    )
    await documents_repo.update_document(
        session, replace(document, name=target.name, description=description)
    )
    await index_mentions(
        session, MentionSource(document_id, MentionSourceKind.DESCRIPTION), description
    )

    now = datetime.now(UTC)
    by_id = {note.id: note for note in every}
    for note_id in plan.delete:
        await notes_repo.delete_note(session, note_id)
    for state in plan.rewrite:
        note = by_id[state.id]
        text = await clean_content_mentions(
            session, membership, state.description, previous=note.description
        )
        if (note.title, note.description) != (state.title, text):
            await notes_repo.update_note(
                session, replace(note, title=state.title, description=text, updated_at=now)
            )
            await _index_note(session, document_id, note.id, text)
    member_ids = {member.user_id for member in await rooms_repo.list_memberships(session, room_id)}
    for state in plan.recreate:
        text = await clean_content_mentions(session, membership, state.description)
        await notes_repo.insert_note(
            session,
            Note(
                id=state.id,
                document_id=document_id,
                title=state.title,
                description=text,
                visibility=state.visibility,
                position=len(every),
                created_by=requester_id,
                created_at=now,
                updated_at=now,
            ),
            [user_id for user_id in state.selective_user_ids if user_id in member_ids],
        )
        await _index_note(session, document_id, state.id, text)
    await notes_repo.set_note_positions(session, plan.order)

    current = await record_revision(session, document_id, requester_id, now=now, force_new=True)
    assert current is not None  # the Document is locked and still here
    return _full(current, current.state.only(readable), None)


async def _index_note(
    session: AsyncSession, document_id: uuid.UUID, note_id: uuid.UUID, text: str
) -> None:
    """Rewrites the backlinks a Note's text holds (spec 20)."""
    await index_mentions(
        session, MentionSource(document_id, MentionSourceKind.NOTE, note_id=note_id), text
    )

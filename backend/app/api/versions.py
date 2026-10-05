"""Version history of a Document's text and of each Note's text (spec 24,
FR-D5): list, read and restore. Only the Document's Owners and the Master see
or restore versions (D-12), and a Note's history follows the Note's own
visibility too (VR-03, VR-07). Text edits aren't audited (Invariant 7): the
version list is the record. The helpers at the top are what the Document and
Note save routes call to write a version."""

import uuid
from dataclasses import replace
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import get_document_notes, get_owned_document
from app.api.errors import http_error
from app.api.mentions import clean_content_mentions, index_mentions
from app.auth.dependencies import CurrentUserDep
from app.db import documents_repo, notes_repo, versions_repo
from app.db.session import SessionDep
from app.db.versions_repo import Subject
from app.domain.models import Membership, MentionSource, MentionSourceKind
from app.domain.versions import Version, change_size, plan_version
from app.i18n.dependencies import LocaleDep

router = APIRouter(tags=["versions"])

_DOCUMENT_VERSIONS = "/rooms/{room_id}/documents/{document_id}/versions"
_NOTE_VERSIONS = "/rooms/{room_id}/documents/{document_id}/notes/{note_id}/versions"


class VersionSummaryResponse(BaseModel):
    """A version in the history list, without its description. `title` is the
    Document's name or the Note's title as it was then."""

    id: uuid.UUID
    title: str
    # The member who saved it, a user id the client resolves through the
    # members list (like `owner_ids`).
    edited_by: uuid.UUID
    created_at: datetime
    # The last save merged into this version (spec 24 Decision 2).
    updated_at: datetime
    # Words added and removed against the previous version; null for the
    # first one, which has nothing before it, and in a restore's reply.
    words_added: int | None
    words_removed: int | None


class VersionResponse(VersionSummaryResponse):
    """One version in full."""

    description: str


def _summaries(versions: list[Version]) -> list[VersionSummaryResponse]:
    """The list of versions (newest first) with each one's change size against
    the version before it."""
    summaries: list[VersionSummaryResponse] = []
    for index, version in enumerate(versions):
        older = versions[index + 1] if index + 1 < len(versions) else None
        size = change_size(older, version) if older is not None else None
        summaries.append(
            VersionSummaryResponse(
                id=version.id,
                title=version.title,
                edited_by=version.edited_by,
                created_at=version.created_at,
                updated_at=version.updated_at,
                words_added=None if size is None else size.words_added,
                words_removed=None if size is None else size.words_removed,
            )
        )
    return summaries


def _full(version: Version, older: Version | None) -> VersionResponse:
    """One version in full, with its change size against `older`."""
    size = change_size(older, version) if older is not None else None
    return VersionResponse(
        id=version.id,
        title=version.title,
        description=version.description,
        edited_by=version.edited_by,
        created_at=version.created_at,
        updated_at=version.updated_at,
        words_added=None if size is None else size.words_added,
        words_removed=None if size is None else size.words_removed,
    )


async def record_version(
    session: AsyncSession,
    subject: Subject,
    subject_id: uuid.UUID,
    document_id: uuid.UUID,
    editor: uuid.UUID,
    title: str,
    description: str,
    *,
    now: datetime | None = None,
    force_new: bool = False,
) -> Version:
    """Writes what a save of this text leaves in the history (`plan_version`)
    and returns the latest version afterwards. Takes the Document's row lock
    first (a Note's history is serialized on its Document), so two saves in
    flight can't both append where one should merge. Call it in the same
    transaction as the edit, with the text as stored."""
    await documents_repo.lock_document(session, document_id)
    latest = await versions_repo.get_latest_version(session, subject, subject_id)
    write = plan_version(
        latest, editor, now or datetime.now(UTC), title, description, force_new=force_new
    )
    if write is None:
        assert latest is not None  # no change is only ever judged against a version
        return latest
    if write.is_new:
        await versions_repo.insert_version(session, subject, subject_id, write.version)
    else:
        await versions_repo.update_version(session, subject, write.version)
    return write.version


def _version_not_found(locale: str) -> HTTPException:
    """The 404 for a version that doesn't exist or belongs elsewhere."""
    return http_error(status.HTTP_404_NOT_FOUND, "errors.version.notFound", locale)


async def _require_note(
    session: AsyncSession,
    document_id: uuid.UUID,
    note_id: uuid.UUID,
    membership: Membership,
    owner_ids: list[uuid.UUID],
    locale: str,
) -> None:
    """404 unless the requester sees the Note on this Document, whether or not
    it exists (VR-07): an Owner can't read the history of a Master-only Note."""
    notes = await get_document_notes(session, document_id, membership, owner_ids)
    if not any(note.id == note_id for note in notes.visible):
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.note.notFound", locale)


@router.get(_DOCUMENT_VERSIONS)
async def list_document_versions(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> list[VersionSummaryResponse]:
    """The Document's name and description history, newest first, without the
    texts. Owners and the Master only: 404 for a Document the requester can't
    see (VR-07), 403 for a member who isn't an Owner (D-12)."""
    await get_owned_document(session, room_id, document_id, uuid.UUID(current_user.id), locale)
    return _summaries(await versions_repo.list_versions(session, "document", document_id))


@router.get(_DOCUMENT_VERSIONS + "/{version_id}")
async def get_document_version(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    version_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> VersionResponse:
    """One version of the Document's name and description in full, for the
    comparison. Same access as the list; 404 for a version of another
    Document."""
    await get_owned_document(session, room_id, document_id, uuid.UUID(current_user.id), locale)
    versions = await versions_repo.list_versions(session, "document", document_id)
    for index, version in enumerate(versions):
        if version.id == version_id:
            return _full(version, versions[index + 1] if index + 1 < len(versions) else None)
    raise _version_not_found(locale)


@router.post(_DOCUMENT_VERSIONS + "/{version_id}/restore")
async def restore_document_version(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    version_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> VersionResponse:
    """Puts an earlier name and description back (spec 24 Decision 3). The
    restore is itself a new version holding the old text, so nothing is lost,
    and it never merges into the previous one. Mention links to content the
    requester can't see are unlinked, like on any save. Restoring the text the
    Document already has changes nothing and returns the latest version.
    Returns the version now in force; the client reloads the Document."""
    requester_id = uuid.UUID(current_user.id)
    document, _, membership = await get_owned_document(
        session, room_id, document_id, requester_id, locale
    )
    await documents_repo.lock_document(session, document_id)
    version = await versions_repo.get_version(session, "document", document_id, version_id)
    if version is None:
        raise _version_not_found(locale)

    description = await clean_content_mentions(
        session, membership, version.description, previous=document.description
    )
    await documents_repo.update_document(
        session, replace(document, name=version.title, description=description)
    )
    await index_mentions(
        session, MentionSource(document_id, MentionSourceKind.DESCRIPTION), description
    )
    current = await record_version(
        session,
        "document",
        document_id,
        document_id,
        requester_id,
        version.title,
        description,
        force_new=True,
    )
    return _full(current, None)


@router.get(_NOTE_VERSIONS)
async def list_note_versions(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    note_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> list[VersionSummaryResponse]:
    """The Note's title and description history, newest first, without the
    texts. Owners and the Master only, and only of a Note the requester can
    see: 404 for a hidden Note (VR-07), 403 for a member who isn't an Owner."""
    _, owner_ids, membership = await get_owned_document(
        session, room_id, document_id, uuid.UUID(current_user.id), locale
    )
    await _require_note(session, document_id, note_id, membership, owner_ids, locale)
    return _summaries(await versions_repo.list_versions(session, "note", note_id))


@router.get(_NOTE_VERSIONS + "/{version_id}")
async def get_note_version(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    note_id: uuid.UUID,
    version_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> VersionResponse:
    """One version of the Note's title and description in full. Same access as
    the list; 404 for a version of another Note."""
    _, owner_ids, membership = await get_owned_document(
        session, room_id, document_id, uuid.UUID(current_user.id), locale
    )
    await _require_note(session, document_id, note_id, membership, owner_ids, locale)
    versions = await versions_repo.list_versions(session, "note", note_id)
    for index, version in enumerate(versions):
        if version.id == version_id:
            return _full(version, versions[index + 1] if index + 1 < len(versions) else None)
    raise _version_not_found(locale)


@router.post(_NOTE_VERSIONS + "/{version_id}/restore")
async def restore_note_version(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    note_id: uuid.UUID,
    version_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> VersionResponse:
    """Puts an earlier title and description of the Note back, as a new version
    (see `restore_document_version`). The Note's visibility, grants and
    position are untouched. Returns the version now in force; the client
    reloads the Document."""
    requester_id = uuid.UUID(current_user.id)
    _, owner_ids, membership = await get_owned_document(
        session, room_id, document_id, requester_id, locale
    )
    await documents_repo.lock_document(session, document_id)
    notes = await get_document_notes(session, document_id, membership, owner_ids)
    note = next((n for n in notes.visible if n.id == note_id), None)
    if note is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.note.notFound", locale)
    version = await versions_repo.get_version(session, "note", note_id, version_id)
    if version is None:
        raise _version_not_found(locale)

    now = datetime.now(UTC)
    description = await clean_content_mentions(
        session, membership, version.description, previous=note.description
    )
    await notes_repo.update_note(
        session, replace(note, title=version.title, description=description, updated_at=now)
    )
    await index_mentions(
        session,
        MentionSource(document_id, MentionSourceKind.NOTE, note_id=note_id),
        description,
    )
    current = await record_version(
        session,
        "note",
        note_id,
        document_id,
        requester_id,
        version.title,
        description,
        now=now,
        force_new=True,
    )
    return _full(current, None)

"""The Room's Glossary (spec 79): terms with a definition, Tags and linked
Documents. Every member reads the entries their visibility lets them see; an
entry they can't see is absent from every response, and a linked Document they
can't see is dropped from its links (VR-07, VR-10). The Administrator and the
Master manage entries (section 9)."""

import uuid
from collections.abc import Collection
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import ensure_room_members, require_membership, visible_documents
from app.api.errors import http_error, translated_error
from app.api.mentions import clean_content_mentions
from app.api.validation import UniqueIds
from app.auth.dependencies import CurrentUserDep
from app.db import documents_repo, glossary_repo, rooms_repo, tags_repo
from app.db.session import SessionDep
from app.domain.errors import DomainError
from app.domain.glossary import (
    DefinitionTooLongError,
    DuplicateTermError,
    GlossaryEntry,
    NotGlossaryManagerError,
    TermRequiredError,
    TermTooLongError,
    TooManyAliasesError,
    TooManyEntriesError,
    TooManyRelatedDocumentsError,
    can_manage_glossary,
    clean_related_documents,
    ensure_can_manage_glossary,
    entry_keys,
    plan_entry_edit,
    plan_new_entry,
)
from app.domain.models import DocumentVisibility, Membership
from app.domain.rooms import starting_visibility
from app.domain.visibility import is_glossary_entry_visible, starting_grants
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/glossary", tags=["glossary"])

_FIELD_ERRORS = (
    TermRequiredError,
    TermTooLongError,
    TooManyAliasesError,
    DefinitionTooLongError,
    TooManyRelatedDocumentsError,
    DuplicateTermError,
)


class GlossaryDocumentResponse(BaseModel):
    """A Document an entry links to, which the viewer sees."""

    id: uuid.UUID
    name: str


class GlossaryEntryResponse(BaseModel):
    """An entry as every route serializes it, for one viewer."""

    id: uuid.UUID
    term: str
    aliases: list[str]
    definition: str
    visibility: DocumentVisibility
    # Who a Selective entry is shared with: sent only to those who manage it.
    selective_user_ids: list[uuid.UUID]
    highlight: bool
    tag_ids: list[uuid.UUID]
    documents: list[GlossaryDocumentResponse]
    created_at: datetime
    updated_at: datetime
    can_edit: bool
    can_delete: bool


class CreateGlossaryEntryRequest(BaseModel):
    """A new entry. Without `visibility` it starts at the Room's default
    (VR-05)."""

    term: str
    aliases: list[str] = []
    definition: str = ""
    visibility: DocumentVisibility | None = None
    selective_user_ids: UniqueIds = []
    highlight: bool = True
    tag_ids: UniqueIds = []
    document_ids: list[uuid.UUID] = []


class UpdateGlossaryEntryRequest(BaseModel):
    """A partial edit: omitted fields stay. Changing the visibility or the
    grants is audited (VR-08)."""

    term: str | None = None
    aliases: list[str] | None = None
    definition: str | None = None
    visibility: DocumentVisibility | None = None
    selective_user_ids: UniqueIds | None = None
    highlight: bool | None = None
    tag_ids: UniqueIds | None = None
    document_ids: list[uuid.UUID] | None = None


def _field_error(exc: DomainError, locale: str) -> HTTPException:
    """The 409 for a taken word, the 422 for any other invalid field."""
    code = (
        status.HTTP_409_CONFLICT
        if isinstance(exc, DuplicateTermError)
        else status.HTTP_422_UNPROCESSABLE_CONTENT
    )
    return translated_error(code, exc, locale)


async def _visible_entries(
    session: AsyncSession, room_id: uuid.UUID, viewer: Membership
) -> list[GlossaryEntryResponse]:
    """The entries the viewer may see, by term, serialized."""
    entries = await glossary_repo.list_entries(session, room_id)
    ids = [entry.id for entry in entries]
    grants = await glossary_repo.list_grants(session, ids)
    seen = [
        entry
        for entry in entries
        if is_glossary_entry_visible(
            entry.visibility, entry.created_by, viewer.user_id, viewer.role, grants[entry.id]
        )
    ]
    return await _responses(session, seen, grants, viewer)


async def _responses(
    session: AsyncSession,
    entries: list[GlossaryEntry],
    grants: dict[uuid.UUID, list[uuid.UUID]],
    viewer: Membership,
) -> list[GlossaryEntryResponse]:
    """Serializes entries the viewer is known to see, dropping the linked
    Documents they can't see (VR-10)."""
    ids = [entry.id for entry in entries]
    tags = await glossary_repo.list_tag_ids(session, ids)
    linked = await glossary_repo.list_document_ids(session, ids)
    wanted = list({d for document_ids in linked.values() for d in document_ids})
    found = await documents_repo.get_documents_by_ids(session, wanted)
    seen = {d.id: d for d in await visible_documents(session, found, viewer)}
    manager = can_manage_glossary(viewer)
    return [
        GlossaryEntryResponse(
            id=entry.id,
            term=entry.term,
            aliases=list(entry.aliases),
            definition=entry.definition,
            visibility=entry.visibility,
            selective_user_ids=sorted(grants[entry.id]) if manager else [],
            highlight=entry.highlight,
            tag_ids=sorted(tags[entry.id]),
            documents=[
                GlossaryDocumentResponse(id=seen[d].id, name=seen[d].name)
                for d in linked[entry.id]
                if d in seen
            ],
            created_at=entry.created_at,
            updated_at=entry.updated_at,
            can_edit=manager,
            can_delete=manager,
        )
        for entry in entries
    ]


def _ensure_manager(membership: Membership, locale: str) -> None:
    """403 unless the requester is an Administrator or the Master."""
    try:
        ensure_can_manage_glossary(membership)
    except NotGlossaryManagerError as exc:
        raise translated_error(status.HTTP_403_FORBIDDEN, exc, locale) from exc


async def _check_tags(
    session: AsyncSession, room_id: uuid.UUID, tag_ids: Collection[uuid.UUID], locale: str
) -> None:
    """422 unless every id is a Tag of this Room."""
    found = await tags_repo.get_tags_by_ids(session, room_id, list(tag_ids))
    if len(found) != len(set(tag_ids)):
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.glossary.invalidTagIds", locale
        )


async def _check_documents(
    session: AsyncSession, membership: Membership, document_ids: list[uuid.UUID], locale: str
) -> list[uuid.UUID]:
    """The linked Documents deduplicated; 422 unless every one is a Document
    of the Room that the writer sees (a hidden one can't be named)."""
    try:
        unique = clean_related_documents(document_ids)
    except TooManyRelatedDocumentsError as exc:
        raise _field_error(exc, locale) from exc
    found = await documents_repo.get_documents_by_ids(session, unique)
    seen = {d.id for d in await visible_documents(session, found, membership)}
    if set(unique) != seen:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.glossary.invalidDocumentIds", locale
        )
    return unique


async def _ensure_words_free(session: AsyncSession, entry: GlossaryEntry, locale: str) -> None:
    """409 when another entry of the Room holds the term or an alias."""
    keys = entry_keys(entry.term, entry.aliases)
    if await glossary_repo.find_conflicting_entry(session, entry.room_id, keys, entry.id):
        raise http_error(status.HTTP_409_CONFLICT, "errors.glossary.duplicateTerm", locale)


async def _get_visible_entry(
    session: AsyncSession, room_id: uuid.UUID, entry_id: uuid.UUID, viewer: Membership, locale: str
) -> tuple[GlossaryEntry, list[uuid.UUID]]:
    """The entry and its Selective grantees, once the viewer is known to see
    it; 404 otherwise, whether or not it exists (VR-07)."""
    entry = await glossary_repo.get_entry(session, entry_id)
    grants = await glossary_repo.list_grants(session, [entry_id])
    if (
        entry is None
        or entry.room_id != room_id
        or not is_glossary_entry_visible(
            entry.visibility, entry.created_by, viewer.user_id, viewer.role, grants[entry_id]
        )
    ):
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.glossary.notFound", locale)
    return entry, grants[entry_id]


@router.get("")
async def list_entries(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> list[GlossaryEntryResponse]:
    """The Room's entries the requester can see, by term."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    return await _visible_entries(session, room_id, membership)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_entry(
    room_id: uuid.UUID,
    body: CreateGlossaryEntryRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> GlossaryEntryResponse | None:
    """An Administrator or the Master defines a term, at the Room's default
    visibility unless the request names one (VR-05). 409 when the term or an
    alias is already defined. Returns null if the new entry is hidden from
    the requester (VR-07)."""
    requester_id = uuid.UUID(current_user.id)
    membership = await require_membership(session, room_id, requester_id, locale)
    _ensure_manager(membership, locale)
    room = await rooms_repo.get_room(session, room_id)
    if room is None:  # pragma: no cover - only a concurrent Room deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.room.notFound", locale)
    # The Room row is locked so two creates can't both take the same word.
    await rooms_repo.lock_room(session, room_id)

    await _check_tags(session, room_id, body.tag_ids, locale)
    document_ids = await _check_documents(session, membership, body.document_ids, locale)
    await ensure_room_members(
        session, room_id, body.selective_user_ids, "errors.glossary.invalidSelectiveUsers", locale
    )
    try:
        entry = plan_new_entry(
            room_id,
            requester_id,
            body.term,
            body.aliases,
            await clean_content_mentions(session, membership, body.definition),
            starting_visibility(room, body.visibility),
            body.highlight,
            await glossary_repo.count_entries(session, room_id),
            datetime.now(UTC),
        )
    except TooManyEntriesError as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc
    except _FIELD_ERRORS as exc:
        raise _field_error(exc, locale) from exc
    await _ensure_words_free(session, entry, locale)

    grants = starting_grants(entry.visibility, body.selective_user_ids)
    try:
        async with session.begin_nested():
            await glossary_repo.insert_entry(session, entry)
    except IntegrityError as exc:  # pragma: no cover - lost race on a word
        raise http_error(status.HTTP_409_CONFLICT, "errors.glossary.duplicateTerm", locale) from exc
    await glossary_repo.set_tag_ids(session, entry.id, body.tag_ids)
    await glossary_repo.set_document_ids(session, entry.id, document_ids)
    await glossary_repo.set_grants(session, entry.id, grants)
    if not is_glossary_entry_visible(
        entry.visibility, entry.created_by, requester_id, membership.role, grants
    ):
        return None
    return (await _responses(session, [entry], {entry.id: grants}, membership))[0]


@router.patch("/{entry_id}")
async def update_entry(
    room_id: uuid.UUID,
    entry_id: uuid.UUID,
    body: UpdateGlossaryEntryRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> GlossaryEntryResponse | None:
    """An Administrator or the Master edits an entry. A change of who can see
    it is audited in the same transaction (VR-08, Invariant 7). Returns null
    if the edit hides the entry from the requester (VR-07)."""
    requester_id = uuid.UUID(current_user.id)
    membership = await require_membership(session, room_id, requester_id, locale)
    entry, selective_ids = await _get_visible_entry(session, room_id, entry_id, membership, locale)
    # Visibility first (404), then permission (403), as for Notes.
    _ensure_manager(membership, locale)
    await rooms_repo.lock_room(session, room_id)

    if body.tag_ids is not None:
        await _check_tags(session, room_id, body.tag_ids, locale)
    document_ids = (
        None
        if body.document_ids is None
        else await _check_documents(session, membership, body.document_ids, locale)
    )
    if body.selective_user_ids is not None:
        await ensure_room_members(
            session,
            room_id,
            body.selective_user_ids,
            "errors.glossary.invalidSelectiveUsers",
            locale,
        )
    try:
        plan = plan_entry_edit(
            entry,
            requester_id,
            datetime.now(UTC),
            term=body.term,
            aliases=body.aliases,
            definition=(
                None
                if body.definition is None
                else await clean_content_mentions(
                    session, membership, body.definition, previous=entry.definition
                )
            ),
            visibility=body.visibility,
            highlight=body.highlight,
            current_selective_ids=selective_ids,
            new_selective_ids=body.selective_user_ids,
        )
    except _FIELD_ERRORS as exc:
        raise _field_error(exc, locale) from exc
    await _ensure_words_free(session, plan.entry, locale)

    try:
        async with session.begin_nested():
            await glossary_repo.update_entry(session, plan.entry)
    except IntegrityError as exc:  # pragma: no cover - lost race on a word
        raise http_error(status.HTTP_409_CONFLICT, "errors.glossary.duplicateTerm", locale) from exc
    if body.tag_ids is not None:
        await glossary_repo.set_tag_ids(session, entry_id, body.tag_ids)
    if document_ids is not None:
        await glossary_repo.set_document_ids(session, entry_id, document_ids)
    grants = selective_ids
    if body.selective_user_ids is not None or plan.entry.visibility != DocumentVisibility.SELECTIVE:
        grants = starting_grants(
            plan.entry.visibility,
            selective_ids if body.selective_user_ids is None else body.selective_user_ids,
        )
        await glossary_repo.set_grants(session, entry_id, grants)
    if plan.audit_entry is not None:
        await rooms_repo.insert_audit_log(session, plan.audit_entry)
    if not is_glossary_entry_visible(
        plan.entry.visibility, plan.entry.created_by, requester_id, membership.role, grants
    ):
        return None
    return (await _responses(session, [plan.entry], {entry_id: grants}, membership))[0]


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    room_id: uuid.UUID,
    entry_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """An Administrator or the Master deletes an entry. 404 for one the
    requester can't see, 403 for a Player who can."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    await _get_visible_entry(session, room_id, entry_id, membership, locale)
    _ensure_manager(membership, locale)
    await glossary_repo.delete_entry(session, entry_id)

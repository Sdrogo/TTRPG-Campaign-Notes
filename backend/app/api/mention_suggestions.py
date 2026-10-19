"""Generated mentions (spec 39): proposals of mentions where the names of the
Room's Documents appear as plain words in the descriptions and Notes of the
Documents the caller manages, and applying the ones they chose.
Only names the caller sees are proposed (VR-07), only text they may edit is
scanned or written (D-12), and existing mentions are never touched."""

import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime

from fastapi import APIRouter, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import (
    get_document_notes,
    get_owned_document,
    require_membership,
)
from app.api.errors import http_error, translated_error
from app.api.mentions import clean_content_mentions, document_candidates, index_mentions
from app.api.versions import record_revision
from app.auth.dependencies import CurrentUserDep
from app.db import documents_repo, notes_repo
from app.db.session import SessionDep
from app.domain.documents import is_owner
from app.domain.mention_suggestions import (
    ChosenMatch,
    MentionCandidate,
    MentionSuggestion,
    StaleSuggestionsError,
    apply_mentions,
    choose_matches,
    match_context,
    suggest_mentions,
    usable_candidates,
)
from app.domain.mentions import MentionKind
from app.domain.models import Document, Membership, MentionSource, MentionSourceKind, Note
from app.domain.notes import plan_note_edit
from app.i18n.dependencies import LocaleDep

router = APIRouter(tags=["mentions"])


class MentionSuggestionResponse(BaseModel):
    """One proposed mention: where it is in the stored text, the words as
    written, what it would link to and a little of the text around it."""

    start: int
    end: int
    text: str
    kind: MentionKind
    target_id: uuid.UUID
    target_name: str
    before: str
    after: str


class MentionSourceResponse(BaseModel):
    """A description (`note_id` null) or a Note holding proposals."""

    document_id: uuid.UUID
    document_name: str
    note_id: uuid.UUID | None
    note_title: str | None
    matches: list[MentionSuggestionResponse]


class MentionSuggestionsResponse(BaseModel):
    """Every text with something to propose, Documents by name, each
    description before its Notes in their order."""

    sources: list[MentionSourceResponse]


# What one apply request may carry (422 past it), so a call can't fan out
# into unbounded locks, queries and revisions.
MAX_SOURCES = 500
MAX_MATCHES_PER_SOURCE = 1000


class ChosenMatchRequest(BaseModel):
    """A proposal to apply, as the preview gave it."""

    start: int
    end: int
    kind: MentionKind
    target_id: uuid.UUID


class ChosenSourceRequest(BaseModel):
    """The proposals chosen in one text: a description (`note_id` null) or a
    Note."""

    document_id: uuid.UUID
    note_id: uuid.UUID | None = None
    matches: list[ChosenMatchRequest] = Field(max_length=MAX_MATCHES_PER_SOURCE)


class ApplyMentionSuggestionsRequest(BaseModel):
    """The texts and proposals to apply."""

    sources: list[ChosenSourceRequest] = Field(max_length=MAX_SOURCES)


class ApplyMentionSuggestionsResponse(BaseModel):
    """How many mentions were written, and in how many Documents."""

    applied: int
    documents: int


@dataclass(frozen=True)
class _ManagedDocument:
    """A Document the caller sees and manages, with the Notes they see."""

    document: Document
    notes: list[Note]


async def _with_notes(
    session: AsyncSession, membership: Membership, document: Document, owner_ids: list[uuid.UUID]
) -> _ManagedDocument:
    """The Document with the Notes the caller sees on it."""
    notes = await get_document_notes(session, document.id, membership, owner_ids)
    return _ManagedDocument(document, notes.visible)


def _suggestions_for(
    managed: Sequence[_ManagedDocument],
    documents: Sequence[MentionCandidate],
) -> MentionSuggestionsResponse:
    """The proposals in every managed Document's description and Notes."""
    sources: list[MentionSourceResponse] = []
    for item in sorted(managed, key=lambda m: (m.document.name.casefold(), str(m.document.id))):
        candidates = usable_candidates(documents, exclude_document_id=item.document.id)
        texts: list[tuple[Note | None, str]] = [(None, item.document.description)]
        texts += [(note, note.description) for note in item.notes]
        for note, text in texts:
            found = suggest_mentions(text, candidates)
            if found:
                sources.append(
                    MentionSourceResponse(
                        document_id=item.document.id,
                        document_name=item.document.name,
                        note_id=None if note is None else note.id,
                        note_title=None if note is None else note.title,
                        matches=[_suggestion_response(text, s) for s in found],
                    )
                )
    return MentionSuggestionsResponse(sources=sources)


def _suggestion_response(text: str, suggestion: MentionSuggestion) -> MentionSuggestionResponse:
    """The API shape of one proposal in `text`, with its context."""
    before, after = match_context(text, suggestion)
    return MentionSuggestionResponse(
        start=suggestion.start,
        end=suggestion.end,
        text=suggestion.text,
        kind=suggestion.kind,
        target_id=suggestion.target_id,
        target_name=suggestion.target_name,
        before=before,
        after=after,
    )


@router.get("/rooms/{room_id}/documents/{document_id}/mention-suggestions")
async def document_mention_suggestions(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> MentionSuggestionsResponse:
    """Spec 39: the mentions to propose in this Document's description and
    the Notes the caller sees, from the names of the Documents they see
    (never Tags). 404 for a Document they can't see, 403 unless they are
    one of its Owners or the Master (D-12). Changes nothing."""
    document, owner_ids, membership = await get_owned_document(
        session, room_id, document_id, uuid.UUID(current_user.id), locale
    )
    documents, _ = await document_candidates(session, membership)
    managed = await _with_notes(session, membership, document, owner_ids)
    return _suggestions_for([managed], documents)


@router.get("/rooms/{room_id}/mention-suggestions")
async def room_mention_suggestions(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> MentionSuggestionsResponse:
    """Spec 39: the mentions to propose in every Document of the Room the
    caller sees and manages (an Owner, or the Master for all of them).
    Someone who manages none gets no source. 403 for a non-member. Changes
    nothing."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    documents, seen = await document_candidates(session, membership)
    owners = await documents_repo.list_owner_ids_for_documents(session, [d.id for d in seen])
    managed = [
        await _with_notes(session, membership, document, owners[document.id])
        for document in seen
        if is_owner(membership.role, membership.user_id, owners[document.id])
    ]
    return _suggestions_for(managed, documents)


@router.post("/rooms/{room_id}/mention-suggestions/apply")
async def apply_mention_suggestions(
    room_id: uuid.UUID,
    body: ApplyMentionSuggestionsRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> ApplyMentionSuggestionsResponse:
    """Spec 39: writes the chosen proposals as mentions. Each text is checked
    as for an edit (404 for a Document or a Note the caller can't see, 403
    unless they manage the Document), the proposals are computed again on
    its current text and every chosen one must still be there (409
    otherwise: reload the preview). Then each description and Note is saved
    as an edit saves it (mentions cleaned, "Mentioned in" rewritten) and
    each Document gets one revision in its history, all in one
    transaction."""
    requester_id = uuid.UUID(current_user.id)
    membership = await require_membership(session, room_id, requester_id, locale)
    # A text named twice counts once, with every match it was sent with.
    by_document: dict[uuid.UUID, dict[uuid.UUID | None, list[ChosenMatch]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for source in body.sources:
        by_document[source.document_id][source.note_id] += [
            ChosenMatch(m.start, m.end, m.kind, m.target_id) for m in source.matches
        ]
    # Locked in id order before any text is read, so the text the proposals
    # are checked against is the one written over, and two calls can't
    # deadlock. Only the caller's own Room's Documents are locked; any other
    # id is a 404 below.
    for document_id in await documents_repo.document_ids_in_room(
        session, room_id, list(by_document)
    ):
        await documents_repo.lock_document(session, document_id)

    documents, _ = await document_candidates(session, membership)
    applied = 0
    changed_documents = 0
    for document_id in sorted(by_document, key=str):
        document, owner_ids, _ = await get_owned_document(
            session, room_id, document_id, requester_id, locale
        )
        managed = await _with_notes(session, membership, document, owner_ids)
        candidates = usable_candidates(documents, exclude_document_id=document_id)
        written = 0
        for note_id, chosen in by_document[document_id].items():
            note = _source_note(managed, note_id, locale)
            if not chosen:
                continue
            text = document.description if note is None else note.description
            try:
                picked = choose_matches(suggest_mentions(text, candidates), chosen)
            except StaleSuggestionsError as exc:
                raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc
            new_text = await clean_content_mentions(
                session, membership, apply_mentions(text, picked), previous=text
            )
            if note is None:
                document = replace(document, description=new_text)
                await documents_repo.update_document(session, document)
                await index_mentions(
                    session, MentionSource(document_id, MentionSourceKind.DESCRIPTION), new_text
                )
            else:
                plan = plan_note_edit(
                    note, room_id, requester_id, datetime.now(UTC), description=new_text
                )
                await notes_repo.update_note(session, plan.note)
                await index_mentions(
                    session,
                    MentionSource(document_id, MentionSourceKind.NOTE, note_id=note.id),
                    new_text,
                )
            written += len(picked)
        if written:
            await record_revision(session, document_id, requester_id)
            applied += written
            changed_documents += 1
    return ApplyMentionSuggestionsResponse(applied=applied, documents=changed_documents)


def _source_note(managed: _ManagedDocument, note_id: uuid.UUID | None, locale: str) -> Note | None:
    """The Note a chosen source names (None for the description), among
    those the caller sees; 404 otherwise, whether or not it exists
    (VR-07)."""
    if note_id is None:
        return None
    note = next((n for n in managed.notes if n.id == note_id), None)
    if note is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.note.notFound", locale)
    return note

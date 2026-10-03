"""The visibility history of a Room (FR-V5, VR-08, spec 22 Decision 4): who
changed who sees which Document, Note or Comment, when, from which level to
which, Reveals marked as such. For the Master and the Administrators; an
entry about content the reader can't see doesn't name it (VR-07)."""

import uuid
from datetime import datetime

from fastapi import APIRouter, status
from pydantic import BaseModel

from app.api.access import lookup_content, require_membership
from app.api.errors import http_error, translated_error
from app.auth.dependencies import CurrentUserDep
from app.db import rooms_repo
from app.db.session import SessionDep
from app.domain.history import (
    HISTORY_PAGE_SIZE,
    CannotReadHistoryError,
    ContentState,
    content_ids,
    ensure_can_read_history,
    history_actions,
    history_entry,
)
from app.domain.models import ContentKind, DocumentVisibility
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/audit-log", tags=["history"])


class HistoryEntryResponse(BaseModel):
    """One change in the visibility history. Unless `state` is `visible`,
    the content isn't named: its ids and names are null and the grant and
    recipient lists empty, so the reader learns only that a hidden (or since
    deleted) Document, Note or Comment changed (VR-07)."""

    id: uuid.UUID
    created_at: datetime
    actor_id: uuid.UUID
    kind: ContentKind
    is_reveal: bool
    state: ContentState
    # The levels before and after the change.
    from_visibility: DocumentVisibility
    to_visibility: DocumentVisibility
    document_id: uuid.UUID | None
    document_name: str | None
    note_id: uuid.UUID | None
    note_title: str | None
    comment_id: uuid.UUID | None
    # Who a Selective level let in after the change.
    selective_user_ids: list[uuid.UUID]
    # For a Reveal, the members who gained access.
    recipient_ids: list[uuid.UUID]


class HistoryPageResponse(BaseModel):
    """A page of the history, newest first. `next_before` is the `before` to
    ask for the next page, null on the last one."""

    entries: list[HistoryEntryResponse]
    next_before: uuid.UUID | None


@router.get("")
async def visibility_history(
    room_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
    kind: ContentKind | None = None,
    before: uuid.UUID | None = None,
) -> HistoryPageResponse:
    """The Room's visibility changes and Reveals, newest first, a page at a
    time (`before` = the `next_before` of the previous page; 422 for one that
    isn't an entry of this Room), optionally only those about one `kind` of
    content. For the Master and the Administrators (403 otherwise). The
    Master sees every name; an Administrator who isn't the Master sees
    content they can't read as unnamed (VR-07)."""
    requester_id = uuid.UUID(current_user.id)
    membership = await require_membership(session, room_id, requester_id, locale)
    try:
        ensure_can_read_history(membership)
    except CannotReadHistoryError as exc:
        raise translated_error(status.HTTP_403_FORBIDDEN, exc, locale) from exc

    cursor = None
    if before is not None:
        cursor = await rooms_repo.get_audit_entry(session, room_id, before)
        if cursor is None:
            raise http_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.history.invalidCursor", locale
            )
    found = await rooms_repo.list_audit_entries(
        session, room_id, history_actions(kind), HISTORY_PAGE_SIZE + 1, cursor
    )
    page = found[:HISTORY_PAGE_SIZE]

    ids = [content_ids(entry) for entry in page]
    lookup = await lookup_content(
        session,
        membership,
        {document_id for document_id, _, _ in ids if document_id is not None},
        {note_id for _, note_id, _ in ids if note_id is not None},
        {comment_id for _, _, comment_id in ids if comment_id is not None},
    )
    entries = []
    for entry in page:
        shown = history_entry(entry, lookup.existing_ids, lookup.visible_ids)
        document = lookup.documents.get(shown.document_id) if shown.document_id else None
        note = lookup.notes.get(shown.note_id) if shown.note_id else None
        entries.append(
            HistoryEntryResponse(
                id=entry.id,
                created_at=entry.created_at,
                actor_id=entry.actor_user_id,
                kind=shown.kind,
                is_reveal=shown.is_reveal,
                state=shown.state,
                from_visibility=DocumentVisibility(str(entry.details["from"])),
                to_visibility=DocumentVisibility(str(entry.details["to"])),
                document_id=shown.document_id,
                document_name=None if document is None else document.name,
                note_id=shown.note_id,
                note_title=None if note is None else note.title,
                comment_id=shown.comment_id,
                selective_user_ids=shown.selective_user_ids,
                recipient_ids=shown.recipient_ids,
            )
        )
    return HistoryPageResponse(
        entries=entries,
        next_before=page[-1].id if len(found) > HISTORY_PAGE_SIZE else None,
    )

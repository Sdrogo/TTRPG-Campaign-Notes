"""Document and Tag mentions (spec 20, FR-D4): how the text that holds them
is cleaned and indexed on save, and the "Mentioned in" lists of a Document
and of a Tag, filtered per viewer with the same rules as the Documents, Notes
and Comments themselves (VR-07, Invariant 1)."""

import uuid
from collections import defaultdict
from collections.abc import Sequence

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import get_visible_document, require_membership, visible_documents
from app.api.errors import http_error
from app.auth.dependencies import CurrentUserDep
from app.db import comments_repo, documents_repo, mentions_repo, notes_repo, tags_repo
from app.db.session import SessionDep
from app.domain.mentions import content_targets, plan_source_mentions, unlink_unknown_content
from app.domain.models import DocumentMention, Membership, MentionSource, MentionSourceKind
from app.domain.visibility import is_comment_visible_in_thread, is_note_visible
from app.i18n.dependencies import LocaleDep

router = APIRouter(tags=["mentions"])


async def clean_content_mentions(
    session: AsyncSession, writer: Membership, text: str, previous: str = ""
) -> str:
    """`text` with every `#` mention the writer may not link turned back into
    plain `#Name`: a Document must be one of the Room's that the writer sees
    (or one the saved text already linked, so editing someone else's text
    keeps their links), a Tag one of the Room's. A forged or foreign id never
    becomes a link, and the answer can't reveal whether a hidden Document
    exists (VR-07)."""
    document_ids, tag_ids = content_targets(text)
    if not document_ids and not tag_ids:
        return text
    found = await documents_repo.get_documents_by_ids(session, list(document_ids))
    in_room = {document.id for document in found if document.room_id == writer.room_id}
    seen = {document.id for document in await visible_documents(session, found, writer)}
    already_linked, _ = content_targets(previous)
    tags = await tags_repo.get_tags_by_ids(session, writer.room_id, list(tag_ids))
    return unlink_unknown_content(text, seen | (in_room & already_linked), {tag.id for tag in tags})


async def index_mentions(session: AsyncSession, source: MentionSource, text: str) -> None:
    """Rewrites the backlinks `source` holds from its saved, cleaned `text`."""
    planned = plan_source_mentions(text, source.document_id)
    await mentions_repo.replace_mentions(session, source, planned)


class BacklinkResponse(BaseModel):
    """Where a mention is in its source Document: the description, a Note
    (with its title) or a Comment (with its author), and the excerpt around
    it."""

    kind: MentionSourceKind
    note_id: uuid.UUID | None
    note_title: str | None
    comment_id: uuid.UUID | None
    comment_author_id: uuid.UUID | None
    excerpt: str


class BacklinkGroupResponse(BaseModel):
    """A Document that mentions the target, with every place it does."""

    document_id: uuid.UUID
    document_name: str
    mentions: list[BacklinkResponse]


_KIND_ORDER = {
    MentionSourceKind.DESCRIPTION: 0,
    MentionSourceKind.NOTE: 1,
    MentionSourceKind.COMMENT: 2,
}


async def visible_backlinks(
    session: AsyncSession, mentions: Sequence[DocumentMention], viewer: Membership
) -> list[BacklinkGroupResponse]:
    """The backlinks `viewer` may see, grouped by source Document: only where
    they see the source Document and, for a Note or a Comment, that Note or
    the Comment through its whole parent chain (spec 20 Decision 5). Groups
    by Document name, then the description, the Notes in order and the
    Comments oldest first."""
    found = await documents_repo.get_documents_by_ids(
        session, list({mention.source_document_id for mention in mentions})
    )
    documents = {
        document.id: document for document in await visible_documents(session, found, viewer)
    }
    mentions = [m for m in mentions if m.source_document_id in documents]

    note_ids = [m.note_id for m in mentions if m.note_id is not None]
    notes = {note.id: note for note in await notes_repo.get_notes_by_ids(session, note_ids)}
    note_grants = await notes_repo.list_grants_for_notes(session, note_ids)
    owners = await documents_repo.list_owner_ids_for_documents(
        session, list({note.document_id for note in notes.values()})
    )
    comment_ids = [m.comment_id for m in mentions if m.comment_id is not None]
    comments = await comments_repo.get_comments_with_ancestors(session, comment_ids)
    comment_grants = await comments_repo.list_grants_for_comments(session, list(comments))

    groups: dict[uuid.UUID, list[tuple[tuple[int, int, str], BacklinkResponse]]] = defaultdict(list)
    for mention in mentions:
        note = None if mention.note_id is None else notes[mention.note_id]
        comment = None if mention.comment_id is None else comments[mention.comment_id]
        if note is not None and not is_note_visible(
            note, viewer.user_id, viewer.role, owners[note.document_id], note_grants[note.id]
        ):
            continue
        if comment is not None and not is_comment_visible_in_thread(
            comment, comments, comment_grants, viewer.user_id, viewer.role
        ):
            continue
        order = (
            _KIND_ORDER[mention.source_kind],
            0 if note is None else note.position,
            "" if comment is None else comment.created_at.isoformat(),
        )
        groups[mention.source_document_id].append(
            (
                order,
                BacklinkResponse(
                    kind=mention.source_kind,
                    note_id=mention.note_id,
                    note_title=None if note is None else note.title,
                    comment_id=mention.comment_id,
                    comment_author_id=None if comment is None else comment.author_id,
                    excerpt=mention.excerpt,
                ),
            )
        )
    return [
        BacklinkGroupResponse(
            document_id=document_id,
            document_name=documents[document_id].name,
            mentions=[response for _, response in sorted(entries, key=lambda e: e[0])],
        )
        for document_id, entries in sorted(
            groups.items(), key=lambda item: (documents[item[0]].name.casefold(), str(item[0]))
        )
    ]


@router.get("/rooms/{room_id}/documents/{document_id}/backlinks")
async def document_backlinks(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> list[BacklinkGroupResponse]:
    """The Documents that mention this one, where they do it ("Mentioned
    in", spec 20), as the requester may see them. 404 for a Document they
    can't see, as for the Document itself (VR-07)."""
    requester_id = uuid.UUID(current_user.id)
    membership = await require_membership(session, room_id, requester_id, locale)
    await get_visible_document(session, room_id, document_id, requester_id, membership.role, locale)
    mentions = await mentions_repo.list_mentions_of_document(session, document_id)
    return await visible_backlinks(session, mentions, membership)


@router.get("/rooms/{room_id}/tags/{tag_id}/backlinks")
async def tag_backlinks(
    room_id: uuid.UUID,
    tag_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> list[BacklinkGroupResponse]:
    """The Documents that mention this Tag, with the same filter as a
    Document's (spec 20 Decision 8). Every member sees a Room's Tags; 404 for
    a Tag of another Room."""
    requester_id = uuid.UUID(current_user.id)
    membership = await require_membership(session, room_id, requester_id, locale)
    if not await tags_repo.get_tags_by_ids(session, room_id, [tag_id]):
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.tag.notFound", locale)
    mentions = await mentions_repo.list_mentions_of_tag(session, tag_id)
    return await visible_backlinks(session, mentions, membership)

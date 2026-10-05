"""Full-text search in a Room (FR-N5, spec 21): Documents, Notes, Comments
and Tags matching a query, grouped by kind, each with its matched words
marked. Only what the requester may see is ever found or counted (VR-07,
NFR-01): the match runs in SQL over the Room, the visibility functions filter
it, and excerpts are built from the visible rows only."""

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import lookup_content, require_membership
from app.api.errors import http_error
from app.auth.dependencies import CurrentUserDep
from app.db import search_repo, tags_repo
from app.db.session import SessionDep
from app.domain.search import (
    MAX_CANDIDATES_PER_KIND,
    MAX_RESULTS_PER_KIND,
    RESULTS_PER_KIND,
    Highlighted,
    SearchKind,
    first_page,
    kinds_to_search,
    prefix_query,
    read_headline,
    searchable_text,
)
from app.i18n.dependencies import LocaleDep

router = APIRouter(tags=["search"])

# The longest query accepted, in characters.
MAX_QUERY_LENGTH = 200


class HighlightedResponse(BaseModel):
    """Text with the matched words as `[start, end)` offsets in UTF-16 code
    units (JavaScript string indexes), never as HTML."""

    text: str
    highlights: list[tuple[int, int]]


class SearchHitResponse(BaseModel):
    """One result. `document_id` and `document_name` say which Document it
    is or belongs to (null for a Tag); `title` is the Document's name, the
    Note's title or the Tag's name (null for a Comment); `excerpt` is the
    stretch of the description, Note text or Comment around the best match
    (null when that text is empty, and for a Tag)."""

    kind: SearchKind
    id: uuid.UUID
    document_id: uuid.UUID | None
    document_name: str | None
    title: HighlightedResponse | None
    excerpt: HighlightedResponse | None


class SearchGroupResponse(BaseModel):
    """The results of one kind, best first, and whether more are visible
    beyond `limit`."""

    items: list[SearchHitResponse]
    has_more: bool


class SearchResponse(BaseModel):
    """The results grouped by kind (spec 21 Decision 3). A kind the request
    didn't search comes back empty."""

    documents: SearchGroupResponse
    notes: SearchGroupResponse
    comments: SearchGroupResponse
    tags: SearchGroupResponse


@dataclass
class _Hit:
    """A visible result before its texts are marked up."""

    kind: SearchKind
    id: uuid.UUID
    document_id: uuid.UUID | None
    document_name: str | None
    title: str | None
    excerpt: str | None


def _empty() -> SearchGroupResponse:
    """A group with no results."""
    return SearchGroupResponse(items=[], has_more=False)


def _shown(highlighted: Highlighted | None) -> HighlightedResponse | None:
    """The API form of a `Highlighted`, or None."""
    if highlighted is None:
        return None
    return HighlightedResponse(text=highlighted.text, highlights=list(highlighted.highlights))


@router.get("/rooms/{room_id}/search")
async def search_room(
    room_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
    q: Annotated[str, Query(max_length=MAX_QUERY_LENGTH)] = "",
    kind: SearchKind | None = None,
    tag: Annotated[list[uuid.UUID] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_RESULTS_PER_KIND)] = RESULTS_PER_KIND,
) -> SearchResponse:
    """Searches the Room for `q`, ignoring case and accents, every word as a
    prefix ("dra" finds "Drago") and all of them required; under 2
    characters finds nothing. `kind` keeps one kind of result; each `tag`
    keeps only results from Documents carrying it (all of them, and then no
    Tags). At most `limit` results per kind (10 by default, up to 50), with
    `has_more`. For members only (403 otherwise); 404 for a Tag of another
    Room. Content the requester can't see is never found, counted or quoted
    (VR-07)."""
    requester_id = uuid.UUID(current_user.id)
    membership = await require_membership(session, room_id, requester_id, locale)
    tag_ids = list(dict.fromkeys(tag or []))
    if tag_ids and len(await tags_repo.get_tags_by_ids(session, room_id, tag_ids)) != len(tag_ids):
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.tag.notFound", locale)

    tsquery = prefix_query(q)
    kinds = kinds_to_search(kind, bool(tag_ids))
    if tsquery is None or not kinds:
        return SearchResponse(documents=_empty(), notes=_empty(), comments=_empty(), tags=_empty())

    document_ids = (
        await search_repo.match_document_ids(
            session, room_id, tsquery, tag_ids, MAX_CANDIDATES_PER_KIND
        )
        if SearchKind.DOCUMENT in kinds
        else []
    )
    note_ids = (
        await search_repo.match_note_ids(
            session, room_id, tsquery, tag_ids, MAX_CANDIDATES_PER_KIND
        )
        if SearchKind.NOTE in kinds
        else []
    )
    comment_ids = (
        await search_repo.match_comment_ids(
            session, room_id, tsquery, tag_ids, MAX_CANDIDATES_PER_KIND
        )
        if SearchKind.COMMENT in kinds
        else []
    )
    tag_hits = (
        await search_repo.match_tag_ids(session, room_id, tsquery, MAX_CANDIDATES_PER_KIND)
        if SearchKind.TAG in kinds
        else []
    )

    # Filter first (Invariant 1): only what survives is paged, counted and
    # read for excerpts. Only the best `MAX_CANDIDATES_PER_KIND` matches of a
    # kind are checked, so a short prefix stays cheap in a large Room.
    lookup = await lookup_content(session, membership, document_ids, note_ids, comment_ids)
    documents, more_documents = first_page(
        [i for i in document_ids if i in lookup.visible_ids], limit
    )
    notes, more_notes = first_page([i for i in note_ids if i in lookup.visible_ids], limit)
    comments, more_comments = first_page([i for i in comment_ids if i in lookup.visible_ids], limit)
    # Every member sees every Tag of the Room (D-14).
    tags, more_tags = first_page(tag_hits, limit)
    tags_by_id = {t.id: t for t in await tags_repo.get_tags_by_ids(session, room_id, tags)}

    hits: list[_Hit] = []
    for document_id in documents:
        document = lookup.documents[document_id]
        hits.append(
            _Hit(
                SearchKind.DOCUMENT,
                document.id,
                document.id,
                document.name,
                document.name,
                document.description,
            )
        )
    for note_id in notes:
        note = lookup.notes[note_id]
        parent = lookup.documents[note.document_id]
        hits.append(
            _Hit(SearchKind.NOTE, note.id, parent.id, parent.name, note.title, note.description)
        )
    for comment_id in comments:
        comment = lookup.comments[comment_id]
        parent = lookup.documents[comment.document_id]
        hits.append(
            _Hit(SearchKind.COMMENT, comment.id, parent.id, parent.name, None, comment.body)
        )
    for tag_id in tags:
        hits.append(_Hit(SearchKind.TAG, tag_id, None, None, tags_by_id[tag_id].name, None))

    titles = await _mark_up(session, tsquery, [hit.title for hit in hits], whole=True)
    excerpts = await _mark_up(session, tsquery, [hit.excerpt for hit in hits], whole=False)
    responses: dict[SearchKind, list[SearchHitResponse]] = {kind: [] for kind in SearchKind}
    for hit, title, excerpt in zip(hits, titles, excerpts, strict=True):
        responses[hit.kind].append(
            SearchHitResponse(
                kind=hit.kind,
                id=hit.id,
                document_id=hit.document_id,
                document_name=hit.document_name,
                title=_shown(title),
                excerpt=_shown(excerpt),
            )
        )
    return SearchResponse(
        documents=SearchGroupResponse(
            items=responses[SearchKind.DOCUMENT], has_more=more_documents
        ),
        notes=SearchGroupResponse(items=responses[SearchKind.NOTE], has_more=more_notes),
        comments=SearchGroupResponse(items=responses[SearchKind.COMMENT], has_more=more_comments),
        tags=SearchGroupResponse(items=responses[SearchKind.TAG], has_more=more_tags),
    )


async def _mark_up(
    session: AsyncSession, tsquery: str, texts: list[str | None], whole: bool
) -> list[Highlighted | None]:
    """Each text marked up by Postgres, in one query; None where the text is
    None or empty once shown as the reader sees it."""
    shown = [None if value is None else searchable_text(value) for value in texts]
    wanted = [value for value in shown if value]
    marked = iter(await search_repo.headlines(session, tsquery, wanted, whole))
    return [read_headline(next(marked), value) if value else None for value in shown]

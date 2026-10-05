"""Full-text matching in one Room (spec 21): the ids of the Documents, Notes,
Comments and Tags whose `search_vector` matches a prefix query, best first,
and the excerpts Postgres marks up. Matches are not filtered for any viewer:
the caller applies the visibility functions before using them (Invariant 1)
and builds excerpts only for what survived."""

import uuid
from collections.abc import Sequence

from sqlalchemy import ColumnElement, Select, bindparam, func, literal_column, select, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.types import Text

from app.db.models import SEARCH_CONFIG, DocumentRow, DocumentTagRow, NoteRow, PostRow, TagRow
from app.domain.models import PostKind
from app.domain.search import START_MARK, STOP_MARK

_CONFIG: ColumnElement[str] = literal_column(f"'{SEARCH_CONFIG}'::regconfig")

# `ts_headline` options: an excerpt of about a dozen to two dozen words around
# the best match; a title keeps every word and marks every match.
_EXCERPT_OPTIONS = (
    f"StartSel={START_MARK}, StopSel={STOP_MARK}, MaxWords=24, MinWords=12, ShortWord=0"
)
_TITLE_OPTIONS = f"StartSel={START_MARK}, StopSel={STOP_MARK}, HighlightAll=true"


def _query(tsquery: str) -> ColumnElement[str]:
    """The parsed prefix query, under the search configuration."""
    return func.to_tsquery(_CONFIG, tsquery)


def _tagged_document_ids(tag_ids: Sequence[uuid.UUID]) -> Select[uuid.UUID]:
    """The Documents carrying every one of `tag_ids` (AND, like the Tag
    combinations of spec 11_2)."""
    return (
        select(DocumentTagRow.document_id)
        .where(DocumentTagRow.tag_id.in_(tag_ids))
        .group_by(DocumentTagRow.document_id)
        .having(func.count(func.distinct(DocumentTagRow.tag_id)) == len(set(tag_ids)))
    )


async def match_document_ids(
    session: AsyncSession, room_id: uuid.UUID, tsquery: str, tag_ids: Sequence[uuid.UUID]
) -> list[uuid.UUID]:
    """The Room's Documents whose name or description match, best first (a
    name match ranks higher), only those carrying every one of `tag_ids`
    when there are any."""
    query = _query(tsquery)
    statement = select(DocumentRow.id).where(
        DocumentRow.room_id == room_id, DocumentRow.search_vector.op("@@")(query)
    )
    if tag_ids:
        statement = statement.where(DocumentRow.id.in_(_tagged_document_ids(tag_ids)))
    result = await session.execute(
        statement.order_by(
            func.ts_rank(DocumentRow.search_vector, query).desc(), DocumentRow.name, DocumentRow.id
        )
    )
    return list(result.scalars())


async def match_note_ids(
    session: AsyncSession, room_id: uuid.UUID, tsquery: str, tag_ids: Sequence[uuid.UUID]
) -> list[uuid.UUID]:
    """The Notes on the Room's Documents whose title or text match, best
    first, only on Documents carrying every one of `tag_ids` when there are
    any."""
    query = _query(tsquery)
    statement = (
        select(NoteRow.id)
        .join(DocumentRow, DocumentRow.id == NoteRow.document_id)
        .where(DocumentRow.room_id == room_id, NoteRow.search_vector.op("@@")(query))
    )
    if tag_ids:
        statement = statement.where(NoteRow.document_id.in_(_tagged_document_ids(tag_ids)))
    result = await session.execute(
        statement.order_by(func.ts_rank(NoteRow.search_vector, query).desc(), NoteRow.id)
    )
    return list(result.scalars())


async def match_comment_ids(
    session: AsyncSession, room_id: uuid.UUID, tsquery: str, tag_ids: Sequence[uuid.UUID]
) -> list[uuid.UUID]:
    """The Comments (replies included) on the Room's Documents whose text
    matches, best then newest first, only on Documents carrying every one of
    `tag_ids` when there are any. A deleted Comment has no vector, so it is
    never found."""
    query = _query(tsquery)
    statement = (
        select(PostRow.id)
        .join(DocumentRow, DocumentRow.id == PostRow.document_id)
        .where(
            DocumentRow.room_id == room_id,
            PostRow.kind == PostKind.COMMENT.value,
            PostRow.deleted_at.is_(None),
            PostRow.search_vector.op("@@")(query),
        )
    )
    if tag_ids:
        statement = statement.where(PostRow.document_id.in_(_tagged_document_ids(tag_ids)))
    result = await session.execute(
        statement.order_by(
            func.ts_rank(PostRow.search_vector, query).desc(),
            PostRow.created_at.desc(),
            PostRow.id,
        )
    )
    return list(result.scalars())


async def match_tag_ids(session: AsyncSession, room_id: uuid.UUID, tsquery: str) -> list[uuid.UUID]:
    """The Room's Tags whose name matches, best first."""
    query = _query(tsquery)
    result = await session.execute(
        select(TagRow.id)
        .where(TagRow.room_id == room_id, TagRow.search_vector.op("@@")(query))
        .order_by(func.ts_rank(TagRow.search_vector, query).desc(), TagRow.name, TagRow.id)
    )
    return list(result.scalars())


async def headlines(
    session: AsyncSession, tsquery: str, texts: Sequence[str], whole: bool
) -> list[str]:
    """`ts_headline` for each of `texts`, in order, with the matched words
    between `START_MARK` and `STOP_MARK`: the whole text when `whole` (a
    title), otherwise an excerpt around the best match. One query whatever
    the number of texts."""
    if not texts:
        return []
    statement = text(
        "SELECT ts_headline(CAST(:config AS regconfig), t.body, "
        "to_tsquery(CAST(:config AS regconfig), :query), :options) "
        "FROM unnest(:texts) WITH ORDINALITY AS t(body, n) ORDER BY t.n"
    ).bindparams(
        bindparam("texts", type_=ARRAY(Text())),
    )
    result = await session.execute(
        statement,
        {
            "config": SEARCH_CONFIG,
            "query": tsquery,
            "options": _TITLE_OPTIONS if whole else _EXCERPT_OPTIONS,
            "texts": list(texts),
        },
    )
    return list(result.scalars())

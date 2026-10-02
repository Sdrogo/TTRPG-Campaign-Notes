"""Comments: rows of `posts` with kind "comment", and their Selective
grants."""

import uuid
from collections import defaultdict
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import PostRow, PostVisibilityGrantRow
from app.domain.models import Comment, DocumentVisibility, PostKind


def comment_from_row(row: PostRow) -> Comment:
    """Maps a `posts` row to the domain `Comment`."""
    return Comment(
        id=row.id,
        document_id=row.document_id,
        author_id=row.author_id,
        body=row.body,
        visibility=DocumentVisibility(row.visibility),
        created_at=row.created_at,
        updated_at=row.updated_at,
        deleted_at=row.deleted_at,
        as_document_id=row.as_document_id,
        parent_id=row.parent_id,
    )


async def insert_comment(
    session: AsyncSession, comment: Comment, selective_user_ids: Sequence[uuid.UUID]
) -> None:
    """Inserts a Comment and its Selective grants; duplicate grantees are
    ignored."""
    session.add(
        PostRow(
            id=comment.id,
            document_id=comment.document_id,
            author_id=comment.author_id,
            kind=PostKind.COMMENT.value,
            body=comment.body,
            visibility=comment.visibility.value,
            created_at=comment.created_at,
            updated_at=comment.updated_at,
            deleted_at=comment.deleted_at,
            as_document_id=comment.as_document_id,
            parent_id=comment.parent_id,
        )
    )
    await session.flush()
    for user_id in set(selective_user_ids):
        session.add(PostVisibilityGrantRow(post_id=comment.id, user_id=user_id))
    await session.flush()


async def get_comments_with_ancestors(
    session: AsyncSession, comment_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, Comment]:
    """The Comments with these ids and every Comment above them (parent,
    grandparent, ... up to the top-level one), keyed by id: what the effective
    visibility of a reply needs (spec 19). One query per level of the deepest
    branch. Missing ids, and Posts of another kind, are simply absent."""
    found: dict[uuid.UUID, Comment] = {}
    wanted = set(comment_ids)
    while wanted:
        result = await session.execute(
            select(PostRow).where(PostRow.id.in_(wanted), PostRow.kind == PostKind.COMMENT.value)
        )
        batch = [comment_from_row(row) for row in result.scalars()]
        found.update((comment.id, comment) for comment in batch)
        wanted = {c.parent_id for c in batch if c.parent_id is not None} - found.keys()
    return found


async def list_comments_for_document(
    session: AsyncSession, document_id: uuid.UUID
) -> list[Comment]:
    """Every Comment on the Document, deleted ones included, oldest first. Not
    yet filtered for any viewer."""
    result = await session.execute(
        select(PostRow)
        .where(PostRow.document_id == document_id, PostRow.kind == PostKind.COMMENT.value)
        .order_by(PostRow.created_at, PostRow.id)
    )
    return [comment_from_row(row) for row in result.scalars()]


async def lock_comment(session: AsyncSession, comment_id: uuid.UUID) -> datetime | None:
    """Takes the Comment's row lock until the transaction ends and returns its
    `deleted_at` as of the lock, so a check made on it can't be undone by a
    concurrent deletion: reacting and deleting serialize on this lock
    (spec 19c). The caller has just read the Comment: a row that vanished
    since raises `NoResultFound`."""
    result = await session.execute(
        select(PostRow.deleted_at).where(PostRow.id == comment_id).with_for_update()
    )
    deleted_at: datetime | None = result.scalar_one()
    return deleted_at


async def update_comment(session: AsyncSession, comment: Comment) -> None:
    """Writes a Comment's body, visibility, Character and timestamps. Raises `LookupError`
    if it no longer exists."""
    row = await session.get(PostRow, comment.id)
    if row is None:
        raise LookupError(f"Comment {comment.id} not found")
    row.body = comment.body
    row.visibility = comment.visibility.value
    row.updated_at = comment.updated_at
    row.deleted_at = comment.deleted_at
    row.as_document_id = comment.as_document_id
    await session.flush()


async def list_grants_for_comments(
    session: AsyncSession, comment_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """The Selective grantees of each Comment. A Comment with none maps to an
    empty list."""
    grants: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    if not comment_ids:
        return grants
    result = await session.execute(
        select(PostVisibilityGrantRow.post_id, PostVisibilityGrantRow.user_id).where(
            PostVisibilityGrantRow.post_id.in_(comment_ids)
        )
    )
    for post_id, user_id in result.tuples():
        grants[post_id].append(user_id)
    return grants


async def set_comment_grants(
    session: AsyncSession, comment_id: uuid.UUID, user_ids: Sequence[uuid.UUID]
) -> None:
    """Replaces the Comment's Selective grantees with `user_ids`."""
    await session.execute(
        delete(PostVisibilityGrantRow).where(PostVisibilityGrantRow.post_id == comment_id)
    )
    for user_id in set(user_ids):
        session.add(PostVisibilityGrantRow(post_id=comment_id, user_id=user_id))
    await session.flush()

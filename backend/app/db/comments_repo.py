import uuid
from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import PostRow, PostVisibilityGrantRow
from app.domain.models import Comment, DocumentVisibility, PostKind


def _comment_from_row(row: PostRow) -> Comment:
    return Comment(
        id=row.id,
        document_id=row.document_id,
        author_id=row.author_id,
        body=row.body,
        visibility=DocumentVisibility(row.visibility),
        created_at=row.created_at,
        updated_at=row.updated_at,
        deleted_at=row.deleted_at,
    )


async def insert_comment(
    session: AsyncSession, comment: Comment, selective_user_ids: Sequence[uuid.UUID]
) -> None:
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
        )
    )
    await session.flush()
    for user_id in set(selective_user_ids):
        session.add(PostVisibilityGrantRow(post_id=comment.id, user_id=user_id))
    await session.flush()


async def get_comment(session: AsyncSession, comment_id: uuid.UUID) -> Comment | None:
    row = await session.get(PostRow, comment_id)
    if row is None or row.kind != PostKind.COMMENT.value:
        return None
    return _comment_from_row(row)


async def get_comments_by_ids(
    session: AsyncSession, comment_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, Comment]:
    if not comment_ids:
        return {}
    result = await session.execute(select(PostRow).where(PostRow.id.in_(comment_ids)))
    return {row.id: _comment_from_row(row) for row in result.scalars()}


async def list_comments_for_document(
    session: AsyncSession, document_id: uuid.UUID
) -> list[Comment]:
    result = await session.execute(
        select(PostRow)
        .where(PostRow.document_id == document_id, PostRow.kind == PostKind.COMMENT.value)
        .order_by(PostRow.created_at, PostRow.id)
    )
    return [_comment_from_row(row) for row in result.scalars()]


async def update_comment(session: AsyncSession, comment: Comment) -> None:
    row = await session.get(PostRow, comment.id)
    if row is None:
        raise LookupError(f"Comment {comment.id} not found")
    row.body = comment.body
    row.visibility = comment.visibility.value
    row.updated_at = comment.updated_at
    row.deleted_at = comment.deleted_at
    await session.flush()


async def list_grants_for_comments(
    session: AsyncSession, comment_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
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
    await session.execute(
        delete(PostVisibilityGrantRow).where(PostVisibilityGrantRow.post_id == comment_id)
    )
    for user_id in set(user_ids):
        session.add(PostVisibilityGrantRow(post_id=comment_id, user_id=user_id))
    await session.flush()

"""Reactions on Comments (spec 19c): reads return rows unfiltered; the
caller only asks for Comments the viewer is known to see (Invariant 1)."""

import uuid
from collections import defaultdict
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import CommentReactionRow, PostRow
from app.domain.models import Reaction


async def list_reactions_for_comments(
    session: AsyncSession, comment_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[Reaction]]:
    """Each Comment's reactions, oldest first, in one query. A Comment with
    none maps to an empty list."""
    reactions: dict[uuid.UUID, list[Reaction]] = defaultdict(list)
    if not comment_ids:
        return reactions
    result = await session.execute(
        select(CommentReactionRow)
        .where(CommentReactionRow.comment_id.in_(comment_ids))
        .order_by(CommentReactionRow.created_at, CommentReactionRow.user_id)
    )
    for row in result.scalars():
        reactions[row.comment_id].append(
            Reaction(
                comment_id=row.comment_id,
                user_id=row.user_id,
                emoji=row.emoji,
                created_at=row.created_at,
            )
        )
    return reactions


async def lock_comment(session: AsyncSession, comment_id: uuid.UUID) -> None:
    """Takes the Comment's row lock until the transaction ends, so the emoji
    counted for its cap and the insert that follows are one step."""
    await session.execute(select(PostRow.id).where(PostRow.id == comment_id).with_for_update())


async def add_reaction(
    session: AsyncSession, comment_id: uuid.UUID, user_id: uuid.UUID, emoji: str, now: datetime
) -> None:
    """Adds the member's emoji to the Comment; already there is a no-op, and
    keeps its original time."""
    statement = insert(CommentReactionRow).values(
        comment_id=comment_id, user_id=user_id, emoji=emoji, created_at=now
    )
    await session.execute(statement.on_conflict_do_nothing())
    await session.flush()


async def remove_reaction(
    session: AsyncSession, comment_id: uuid.UUID, user_id: uuid.UUID, emoji: str
) -> None:
    """Removes the member's emoji from the Comment, if it was there."""
    await session.execute(
        delete(CommentReactionRow).where(
            CommentReactionRow.comment_id == comment_id,
            CommentReactionRow.user_id == user_id,
            CommentReactionRow.emoji == emoji,
        )
    )
    await session.flush()


async def delete_reactions_for_comment(session: AsyncSession, comment_id: uuid.UUID) -> None:
    """Clears every reaction on a Comment, for when it is deleted: its
    placeholder keeps nothing (FR-T5)."""
    await session.execute(
        delete(CommentReactionRow).where(CommentReactionRow.comment_id == comment_id)
    )
    await session.flush()

"""The rows that tie a person to the app outside their Room content, for the
account deletion and the personal data export (spec 31). The Room content
itself (Documents, Notes, Comments, images, files) stays with its Room."""

import uuid
from collections.abc import Sequence

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.comments_repo import comment_from_row
from app.db.models import (
    CommentReactionRow,
    DocumentFileRow,
    DocumentImageRow,
    DocumentOwnerRow,
    DocumentReadRow,
    DocumentRow,
    DocumentVisibilityGrantRow,
    FriendCodeRow,
    FriendshipRow,
    InvitationRow,
    NoteVisibilityGrantRow,
    PostRow,
    PostVisibilityGrantRow,
    RevealRecipientRow,
    UserRow,
)
from app.domain.models import Comment, PostKind


async def erase_personal_rows(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Spec 31_1 Decision 3: deletes everything that records the user as a
    person - profile, Friendships and friend code, reactions, reads, Reveal
    receipts, Ownerships, visibility grants and invitations addressed to
    them. Their Memberships are gone already (left or deleted with their
    Room); what they wrote stays, with no profile behind it. Ids left in
    audit entries, versions and `created_by` columns no longer lead to
    anyone once the auth account is deleted too."""
    await session.execute(
        delete(FriendshipRow).where(
            or_(FriendshipRow.user_low == user_id, FriendshipRow.user_high == user_id)
        )
    )
    for model in (
        FriendCodeRow,
        CommentReactionRow,
        DocumentReadRow,
        RevealRecipientRow,
        DocumentOwnerRow,
        DocumentVisibilityGrantRow,
        NoteVisibilityGrantRow,
        PostVisibilityGrantRow,
    ):
        await session.execute(delete(model).where(model.user_id == user_id))
    await session.execute(delete(InvitationRow).where(InvitationRow.invitee_user_id == user_id))
    await session.execute(delete(UserRow).where(UserRow.id == user_id))
    await session.flush()


async def list_comments_by_author(session: AsyncSession, user_id: uuid.UUID) -> list[Comment]:
    """Every Comment the user wrote, deleted ones included, oldest first. Not
    yet filtered for any viewer."""
    result = await session.execute(
        select(PostRow)
        .where(PostRow.author_id == user_id, PostRow.kind == PostKind.COMMENT.value)
        .order_by(PostRow.created_at, PostRow.id)
    )
    return [comment_from_row(row) for row in result.scalars()]


async def list_reactions_by_user(
    session: AsyncSession, user_id: uuid.UUID
) -> list[tuple[uuid.UUID, uuid.UUID, str]]:
    """The user's reactions as (Document id, Comment id, emoji), oldest first."""
    result = await session.execute(
        select(PostRow.document_id, CommentReactionRow.comment_id, CommentReactionRow.emoji)
        .join(PostRow, PostRow.id == CommentReactionRow.comment_id)
        .where(CommentReactionRow.user_id == user_id)
        .order_by(CommentReactionRow.created_at)
    )
    return [(document_id, comment_id, emoji) for document_id, comment_id, emoji in result.all()]


async def list_files_uploaded_by(
    session: AsyncSession, user_id: uuid.UUID
) -> list[DocumentFileRow]:
    """The PDF Attachments the user uploaded, oldest first."""
    result = await session.execute(
        select(DocumentFileRow)
        .where(DocumentFileRow.uploaded_by == user_id)
        .order_by(DocumentFileRow.created_at)
    )
    return list(result.scalars())


async def list_images_added_by(session: AsyncSession, user_id: uuid.UUID) -> list[DocumentImageRow]:
    """The Document and Comment images the user added, oldest first."""
    result = await session.execute(
        select(DocumentImageRow)
        .where(DocumentImageRow.created_by == user_id)
        .order_by(DocumentImageRow.created_at)
    )
    return list(result.scalars())


async def list_owned_document_ids(session: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    """The Documents the user is an Owner of, in every Room."""
    result = await session.execute(
        select(DocumentOwnerRow.document_id).where(DocumentOwnerRow.user_id == user_id)
    )
    return set(result.scalars())


async def list_documents_created_or_played(
    session: AsyncSession, user_id: uuid.UUID
) -> Sequence[DocumentRow]:
    """The Documents the user created or plays as their Character."""
    result = await session.execute(
        select(DocumentRow).where(
            or_(DocumentRow.created_by == user_id, DocumentRow.played_by == user_id)
        )
    )
    return list(result.scalars())

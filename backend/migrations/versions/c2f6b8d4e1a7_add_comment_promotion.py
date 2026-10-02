"""add comment promotion

Spec `19c - Reactions, mentions, pins and promotion.md` (FR-T8), last part:
the "Promoted" mark on a Comment whose text an Owner or the Master took into
the Document's description or into a new Document. All four columns are
nullable, so existing Comments start unpromoted with no backfill.
`promoted_by` names a user and, like `author_id`, has no foreign key (no FK
to `auth.users`); `promoted_document_id` is SET NULL so deleting the new
Document keeps the mark. No new table, so no RLS change: `posts` already has
RLS and the deny policy.

Revision ID: c2f6b8d4e1a7
Revises: a9e3d7c5b1f8
Create Date: 2026-10-02 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c2f6b8d4e1a7"
down_revision: Union[str, Sequence[str], None] = "a9e3d7c5b1f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("posts", sa.Column("promoted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("posts", sa.Column("promoted_by", sa.UUID(), nullable=True))
    op.add_column("posts", sa.Column("promoted_to", sa.String(length=20), nullable=True))
    op.add_column("posts", sa.Column("promoted_document_id", sa.UUID(), nullable=True))
    op.create_index(
        op.f("ix_posts_promoted_document_id"), "posts", ["promoted_document_id"], unique=False
    )
    op.create_foreign_key(
        "posts_promoted_document_id_fkey",
        "posts",
        "documents",
        ["promoted_document_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("posts_promoted_document_id_fkey", "posts", type_="foreignkey")
    op.drop_index(op.f("ix_posts_promoted_document_id"), table_name="posts")
    op.drop_column("posts", "promoted_document_id")
    op.drop_column("posts", "promoted_to")
    op.drop_column("posts", "promoted_by")
    op.drop_column("posts", "promoted_at")

"""add characters

Spec `17 - Characters and posting in character.md` (D-23, D-24): a Document can
be played by one member of its Room (`documents.played_by`, a user id with no
FK, like every user reference), and a Comment can be written as a Document
(`posts.as_document_id`). `ON DELETE SET NULL` on the latter: deleting the
Character turns its Comments back into plain ones, which widens nothing. Only
columns are added, so RLS and the deny policies are unchanged.

Revision ID: a3d9c5e7f210
Revises: e2f7c4a9b1d6
Create Date: 2026-10-01 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3d9c5e7f210"
down_revision: Union[str, Sequence[str], None] = "e2f7c4a9b1d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("documents", sa.Column("played_by", sa.UUID(), nullable=True))
    op.add_column("posts", sa.Column("as_document_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "posts_as_document_id_fkey",
        "posts",
        "documents",
        ["as_document_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(op.f("ix_posts_as_document_id"), "posts", ["as_document_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_posts_as_document_id"), table_name="posts")
    op.drop_constraint("posts_as_document_id_fkey", "posts", type_="foreignkey")
    op.drop_column("posts", "as_document_id")
    op.drop_column("documents", "played_by")

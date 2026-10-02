"""add comment replies

Spec `19 - Threaded replies.md` (FR-T1, D-17), unit 19_1: a Comment can answer
another Comment of the same Document. `posts.parent_id` points at the Post it
answers; NULL is a top-level Comment. CASCADE, though a Comment is never
deleted as a row today (FR-T5 leaves a placeholder): the replies go with
their Document like every Post. Only a column and its index are added, so
RLS is unchanged.

Revision ID: d5b2e8f4a1c7
Revises: c4f9a2e7d1b8
Create Date: 2026-10-02 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5b2e8f4a1c7"
down_revision: Union[str, Sequence[str], None] = "c4f9a2e7d1b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("posts", sa.Column("parent_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "posts_parent_id_fkey", "posts", "posts", ["parent_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index(op.f("ix_posts_parent_id"), "posts", ["parent_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_posts_parent_id"), table_name="posts")
    op.drop_constraint("posts_parent_id_fkey", "posts", type_="foreignkey")
    op.drop_column("posts", "parent_id")

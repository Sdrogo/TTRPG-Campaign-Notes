"""add comment pin and resolution

Spec `19c - Reactions, mentions, pins and promotion.md` (FR-T7), second part:
an Owner or the Master pins a top-level Comment (`pinned_at`), and its
author, an Owner or the Master marks its branch resolved (`resolved_at`,
`resolved_by`). All three are nullable, so existing Comments start unpinned
and open with no backfill. `resolved_by` names a user and, like `author_id`,
has no foreign key (no FK to `auth.users`). No new table, so no RLS change:
`posts` already has RLS and the deny policy.

Revision ID: a9e3d7c5b1f8
Revises: f4c7a1d9e2b6
Create Date: 2026-10-02 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a9e3d7c5b1f8"
down_revision: Union[str, Sequence[str], None] = "f4c7a1d9e2b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("posts", sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("posts", sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("posts", sa.Column("resolved_by", sa.UUID(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("posts", "resolved_by")
    op.drop_column("posts", "resolved_at")
    op.drop_column("posts", "pinned_at")

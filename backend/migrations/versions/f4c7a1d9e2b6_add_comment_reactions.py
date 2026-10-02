"""add comment reactions

Spec `19c - Reactions, mentions, pins and promotion.md` (FR-T6), first part:
one row per (Comment, member, emoji). The primary key keeps a member to one
use of each emoji per Comment; the emoji is validated by the domain layer
(`app/domain/reactions.py`), `String(32)` matching its byte limit. Rows go
with their Comment (CASCADE, so also with its Document and Room). Like every
table in `public` it is backend-only: RLS on, plus the explicit deny policy
for the client roles (code-standards.md -> Data and Storage).

Revision ID: f4c7a1d9e2b6
Revises: e8c1f5a3b7d2
Create Date: 2026-10-02 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f4c7a1d9e2b6"
down_revision: Union[str, Sequence[str], None] = "e8c1f5a3b7d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DENY_POLICY = (
    "CREATE POLICY backend_only_deny_clients ON public.comment_reactions "
    "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "comment_reactions",
        sa.Column("comment_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("emoji", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["comment_id"], ["posts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("comment_id", "user_id", "emoji"),
    )
    op.execute("ALTER TABLE public.comment_reactions ENABLE ROW LEVEL SECURITY")
    op.execute(_DENY_POLICY)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("comment_reactions")

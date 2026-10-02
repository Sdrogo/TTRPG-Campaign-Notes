"""add document reads

Spec `19b - Unread replies.md` (FR-T4), unit 19b_1: when each member last
opened each Document, so the Documents list can count the Comments and
replies posted since. One row per (user, Document); it goes with its Document
(CASCADE) and is deleted by the API when the member leaves or is removed
from the Room. Like every table in `public` it is backend-only: RLS on, plus
the explicit deny policy for the client roles (code-standards.md -> Data and
Storage).

Revision ID: e8c1f5a3b7d2
Revises: d5b2e8f4a1c7
Create Date: 2026-10-02 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e8c1f5a3b7d2"
down_revision: Union[str, Sequence[str], None] = "d5b2e8f4a1c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DENY_POLICY = (
    "CREATE POLICY backend_only_deny_clients ON public.document_reads "
    "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "document_reads",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("document_id", sa.UUID(), nullable=False),
        sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "document_id"),
    )
    op.create_index(
        op.f("ix_document_reads_document_id"), "document_reads", ["document_id"], unique=False
    )
    op.execute("ALTER TABLE public.document_reads ENABLE ROW LEVEL SECURITY")
    op.execute(_DENY_POLICY)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_document_reads_document_id"), table_name="document_reads")
    op.drop_table("document_reads")

"""add document files

Spec `16 - PDF attachments on Documents.md` (D-21, D-22): a Document can carry
PDF Attachments. Only the Storage path is stored; the row cascades with the
Document, and the API queues the Storage object for removal before a Document
or Room deletion lets the cascade drop the row. Like every table in `public`
it is backend-only: RLS on, plus the explicit deny policy for the client roles
(code-standards.md -> Data and Storage).

Revision ID: e2f7c4a9b1d6
Revises: c6e1a4b7d2f9
Create Date: 2026-10-01 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e2f7c4a9b1d6"
down_revision: Union[str, Sequence[str], None] = "c6e1a4b7d2f9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "document_files",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("document_id", sa.UUID(), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("uploaded_by", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_document_files_document_id"), "document_files", ["document_id"], unique=False
    )
    op.execute("ALTER TABLE public.document_files ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY backend_only_deny_clients ON public.document_files "
        "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_document_files_document_id"), table_name="document_files")
    op.drop_table("document_files")

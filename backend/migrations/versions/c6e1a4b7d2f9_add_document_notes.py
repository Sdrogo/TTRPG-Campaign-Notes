"""add document notes

Spec `12_1 - Note backend effort.md`: a Document can carry Notes - extra
blocks with a title, a description and a visibility of their own - and a
Selective Note has its own grant list. Both tables cascade with the Document
(a Note holds no Storage object, so nothing needs a `storage_cleanup` row).
Like every table in `public` both are backend-only: RLS on, plus the explicit
deny policy for the client roles (code-standards.md -> Data and Storage).

Revision ID: c6e1a4b7d2f9
Revises: b5d8f2a9c1e3
Create Date: 2026-10-01 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c6e1a4b7d2f9"
down_revision: Union[str, Sequence[str], None] = "b5d8f2a9c1e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("document_notes", "document_note_visibility_grants")


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "document_notes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("document_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("visibility", sa.String(length=20), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_document_notes_document_id"), "document_notes", ["document_id"], unique=False
    )
    op.create_table(
        "document_note_visibility_grants",
        sa.Column("note_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(["note_id"], ["document_notes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("note_id", "user_id"),
    )
    for table in TABLES:
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY backend_only_deny_clients ON public.{table} "
            "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("document_note_visibility_grants")
    op.drop_index(op.f("ix_document_notes_document_id"), table_name="document_notes")
    op.drop_table("document_notes")

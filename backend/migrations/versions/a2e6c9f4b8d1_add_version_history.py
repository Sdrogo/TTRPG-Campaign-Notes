"""add version history

Spec `24 - Version history.md` (FR-D5), unit 24_1: `document_versions` (a
Document's name and description) and `note_versions` (a Note's title and
description), one row per saved state. Each goes with its Document or Note
(CASCADE). The backfill writes the current text of every existing Document
and Note as its first version (author: its creator, time: its last update),
so the first edit after this migration already has something to compare
against. Like every table in `public` both are backend-only: RLS on, plus the
explicit deny policy for the client roles (code-standards.md -> Data and
Storage).

Revision ID: a2e6c9f4b8d1
Revises: d9a4f1c7e3b5
Create Date: 2026-10-05 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a2e6c9f4b8d1"
down_revision: Union[str, Sequence[str], None] = "d9a4f1c7e3b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _deny_policy(table: str) -> str:
    return (
        f"CREATE POLICY backend_only_deny_clients ON public.{table} "
        "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
    )


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "document_versions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("document_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("edited_by", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_document_versions_document_id"), "document_versions", ["document_id"]
    )
    op.create_table(
        "note_versions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("note_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("edited_by", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["note_id"], ["document_notes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_note_versions_note_id"), "note_versions", ["note_id"])

    op.execute(
        "INSERT INTO document_versions "
        "(id, document_id, name, description, edited_by, created_at, updated_at) "
        "SELECT gen_random_uuid(), id, name, description, created_by, updated_at, updated_at "
        "FROM documents"
    )
    op.execute(
        "INSERT INTO note_versions "
        "(id, note_id, title, description, edited_by, created_at, updated_at) "
        "SELECT gen_random_uuid(), id, title, description, created_by, updated_at, updated_at "
        "FROM document_notes"
    )

    for table in ("document_versions", "note_versions"):
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(_deny_policy(table))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_note_versions_note_id"), table_name="note_versions")
    op.drop_table("note_versions")
    op.drop_index(op.f("ix_document_versions_document_id"), table_name="document_versions")
    op.drop_table("document_versions")

"""add document mentions

Spec `20 - Mention backlinks.md`, unit 20_1. Table `document_mentions`: one
row per Document or Tag a source names, the source being a Document's
description, one of its Notes or one of its Comments (`source_kind`), with an
excerpt around the mention. Rows go with the source Document, the Note, the
Comment and the target (CASCADE). Backend-only, like every table in `public`:
RLS on, plus the explicit deny policy for the client roles.

Then the one-off conversion (Decision 2): every plain `#Name` the browser
resolves today, in descriptions, Notes and Comments that aren't deleted, is
written as a `#[Name](doc:<uuid>)` / `#[Name](tag:<uuid>)` token by the
browser's own rule (`app/domain/mentions.py::convert_plain_mentions`), and
the backlinks are filled from the converted text. The downgrade writes the
tokens back as plain `#Name` (their stored name) and drops the table.

Applied to the live database only with the product owner's go-ahead, and only
once the frontend that reads tokens (20_2) is deployed: before it, tokens
show as their raw syntax.

Revision ID: d7b3a9f2c5e8
Revises: c2f6b8d4e1a7
Create Date: 2026-10-03 00:00:00.000000

"""

import uuid
from collections import defaultdict
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.domain.mentions import (
    NamedTarget,
    convert_plain_mentions,
    plain_mentions,
    plan_source_mentions,
)

# revision identifiers, used by Alembic.
revision: str = "d7b3a9f2c5e8"
down_revision: Union[str, Sequence[str], None] = "c2f6b8d4e1a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DENY_POLICY = (
    "CREATE POLICY backend_only_deny_clients ON public.document_mentions "
    "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
)

# Each text column that may hold mentions: its table, the column, the Room of
# the row and the source it is for. Deleted Comments are empty placeholders.
_SOURCES = (
    (
        "description",
        "SELECT d.id, d.room_id, d.id AS document_id, d.description AS text FROM documents d",
        "UPDATE documents SET description = :text WHERE id = :id",
    ),
    (
        "note",
        "SELECT n.id, d.room_id, n.document_id, n.description AS text "
        "FROM document_notes n JOIN documents d ON d.id = n.document_id",
        "UPDATE document_notes SET description = :text WHERE id = :id",
    ),
    (
        "comment",
        "SELECT p.id, d.room_id, p.document_id, p.body AS text "
        "FROM posts p JOIN documents d ON d.id = p.document_id WHERE p.deleted_at IS NULL",
        "UPDATE posts SET body = :text WHERE id = :id",
    ),
)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "document_mentions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("source_document_id", sa.UUID(), nullable=False),
        sa.Column("source_kind", sa.String(length=20), nullable=False),
        sa.Column("note_id", sa.UUID(), nullable=True),
        sa.Column("comment_id", sa.UUID(), nullable=True),
        sa.Column("target_document_id", sa.UUID(), nullable=True),
        sa.Column("target_tag_id", sa.UUID(), nullable=True),
        sa.Column("excerpt", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "(target_document_id IS NULL) <> (target_tag_id IS NULL)",
            name="ck_document_mentions_one_target",
        ),
        sa.CheckConstraint(
            "(source_kind = 'description' AND note_id IS NULL AND comment_id IS NULL)"
            " OR (source_kind = 'note' AND note_id IS NOT NULL AND comment_id IS NULL)"
            " OR (source_kind = 'comment' AND comment_id IS NOT NULL AND note_id IS NULL)",
            name="ck_document_mentions_source",
        ),
        sa.ForeignKeyConstraint(["source_document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["note_id"], ["document_notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["comment_id"], ["posts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_tag_id"], ["tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in (
        "source_document_id",
        "note_id",
        "comment_id",
        "target_document_id",
        "target_tag_id",
    ):
        op.create_index(
            op.f(f"ix_document_mentions_{column}"), "document_mentions", [column], unique=False
        )
    op.execute("ALTER TABLE public.document_mentions ENABLE ROW LEVEL SECURITY")
    op.execute(_DENY_POLICY)
    _convert_existing_text()


def _convert_existing_text() -> None:
    """Writes every plain `#Name` as a token and fills the backlinks."""
    bind = op.get_bind()
    documents: dict[uuid.UUID, list[NamedTarget]] = defaultdict(list)
    for row in bind.execute(sa.text("SELECT id, room_id, name, created_at FROM documents")):
        documents[row.room_id].append(NamedTarget(row.id, row.name, row.created_at))
    tags: dict[uuid.UUID, list[NamedTarget]] = defaultdict(list)
    for row in bind.execute(sa.text("SELECT id, room_id, name, created_at FROM tags")):
        tags[row.room_id].append(NamedTarget(row.id, row.name, row.created_at))

    insert = sa.text(
        "INSERT INTO document_mentions (id, source_document_id, source_kind, note_id, "
        "comment_id, target_document_id, target_tag_id, excerpt) VALUES (:id, "
        ":source_document_id, :source_kind, :note_id, :comment_id, :target_document_id, "
        ":target_tag_id, :excerpt)"
    )
    for kind, select, update in _SOURCES:
        for row in bind.execute(sa.text(select)).all():
            text = convert_plain_mentions(row.text, documents[row.room_id], tags[row.room_id])
            if text != row.text:
                bind.execute(sa.text(update), {"id": row.id, "text": text})
            for planned in plan_source_mentions(text, row.document_id):
                bind.execute(
                    insert,
                    {
                        "id": uuid.uuid4(),
                        "source_document_id": row.document_id,
                        "source_kind": kind,
                        "note_id": row.id if kind == "note" else None,
                        "comment_id": row.id if kind == "comment" else None,
                        "target_document_id": planned.target_document_id,
                        "target_tag_id": planned.target_tag_id,
                        "excerpt": planned.excerpt,
                    },
                )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    for _, select, update in _SOURCES:
        for row in bind.execute(sa.text(select)).all():
            text = plain_mentions(row.text)
            if text != row.text:
                bind.execute(sa.text(update), {"id": row.id, "text": text})
    op.drop_table("document_mentions")

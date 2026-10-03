"""add reveals and default visibility

Spec `22 - Reveal and visibility history.md`, unit 22_1:

- `rooms.default_visibility` (not null, default `room`): the level new
  Documents, Notes and top-level Comments start at when the request names
  none (VR-05). Existing Rooms get `room`, which is what they did until now.
- `reveals`: one row per Reveal (FR-V2, VR-06), the Document it is on and,
  for a Note or a Comment, which one (separate FK columns so the row goes
  with the content, CASCADE; a CHECK keeps them consistent with
  `content_kind`), plus who revealed it and when.
- `reveal_recipients`: the members who gained access, with `seen_at` set once
  they open it (spec 22 Decision 3). CASCADE from the Reveal.
- An index on `audit_log (room_id, created_at)` for the visibility history.

Both new tables are backend-only, like every table in `public`: RLS on, plus
the explicit deny policy for the client roles. No data is rewritten.

Revision ID: b8d2f6a4c9e1
Revises: d7b3a9f2c5e8
Create Date: 2026-10-03 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8d2f6a4c9e1"
down_revision: Union[str, Sequence[str], None] = "d7b3a9f2c5e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _deny_policy(table: str) -> str:
    """The restrictive deny policy every table in `public` carries."""
    return (
        f"CREATE POLICY backend_only_deny_clients ON public.{table} "
        "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
    )


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "rooms",
        sa.Column(
            "default_visibility",
            sa.String(length=20),
            server_default=sa.text("'room'"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_audit_log_room_id_created_at", "audit_log", ["room_id", "created_at"], unique=False
    )

    op.create_table(
        "reveals",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("content_kind", sa.String(length=20), nullable=False),
        sa.Column("document_id", sa.UUID(), nullable=False),
        sa.Column("note_id", sa.UUID(), nullable=True),
        sa.Column("comment_id", sa.UUID(), nullable=True),
        sa.Column("revealed_by", sa.UUID(), nullable=False),
        sa.Column("revealed_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(content_kind = 'document' AND note_id IS NULL AND comment_id IS NULL)"
            " OR (content_kind = 'note' AND note_id IS NOT NULL AND comment_id IS NULL)"
            " OR (content_kind = 'comment' AND comment_id IS NOT NULL AND note_id IS NULL)",
            name="ck_reveals_content",
        ),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["note_id"], ["document_notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["comment_id"], ["posts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("room_id", "document_id", "note_id", "comment_id"):
        op.create_index(op.f(f"ix_reveals_{column}"), "reveals", [column], unique=False)

    op.create_table(
        "reveal_recipients",
        sa.Column("reveal_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["reveal_id"], ["reveals.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("reveal_id", "user_id"),
    )
    op.create_index(
        op.f("ix_reveal_recipients_user_id"), "reveal_recipients", ["user_id"], unique=False
    )

    for table in ("reveals", "reveal_recipients"):
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(_deny_policy(table))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_reveal_recipients_user_id"), table_name="reveal_recipients")
    op.drop_table("reveal_recipients")
    for column in ("room_id", "document_id", "note_id", "comment_id"):
        op.drop_index(op.f(f"ix_reveals_{column}"), table_name="reveals")
    op.drop_table("reveals")
    op.drop_index("ix_audit_log_room_id_created_at", table_name="audit_log")
    op.drop_column("rooms", "default_visibility")

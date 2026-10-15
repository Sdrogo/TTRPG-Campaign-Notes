"""add document linked maps

Spec `36 - Mention map.md` Decision 15: a Document can show an existing free
map on its page, under its images, as well as its own mention map. One
linked map per Document (the primary key); the link goes with the Document
or the map. Backend-only like every other table: RLS on, plus the explicit
deny policy for the client roles.

Revision ID: e8b4d2f6a9c1
Revises: c6e2a9f4d8b3
Create Date: 2026-10-15 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "e8b4d2f6a9c1"
down_revision: Union[str, Sequence[str], None] = "c6e2a9f4d8b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "document_linked_maps",
        sa.Column(
            "document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "map_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("relationship_maps.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("linked_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.execute("ALTER TABLE public.document_linked_maps ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY backend_only_deny_clients ON public.document_linked_maps "
        "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
    )


def downgrade() -> None:
    op.drop_table("document_linked_maps")

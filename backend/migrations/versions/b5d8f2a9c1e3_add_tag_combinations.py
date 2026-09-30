"""add tag combinations

Spec `11_2 - Add Room Setup Page Refinment.md`: a Room's Documents list can
group by a *combination* of two or more Tags as well as by single Main Tags.
A combination is its own line item in the same order as the single Main
Tags (`tags.main_position`), so it has its own `position` in that shared
order, and its Tags live in a link table. Like every table in `public` both
are backend-only: RLS on, plus the explicit deny policy for the client roles
(code-standards.md -> Data and Storage).

Revision ID: b5d8f2a9c1e3
Revises: a7c3e9d1b254
Create Date: 2026-09-30 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5d8f2a9c1e3"
down_revision: Union[str, Sequence[str], None] = "a7c3e9d1b254"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("tag_combinations", "tag_combination_tags")


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "tag_combinations",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_tag_combinations_room_id"), "tag_combinations", ["room_id"], unique=False
    )
    op.create_table(
        "tag_combination_tags",
        sa.Column("combination_id", sa.UUID(), nullable=False),
        sa.Column("tag_id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(["combination_id"], ["tag_combinations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("combination_id", "tag_id"),
    )
    for table in TABLES:
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY backend_only_deny_clients ON public.{table} "
            "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("tag_combination_tags")
    op.drop_index(op.f("ix_tag_combinations_room_id"), table_name="tag_combinations")
    op.drop_table("tag_combinations")

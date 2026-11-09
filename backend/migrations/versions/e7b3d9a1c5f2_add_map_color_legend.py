"""add map color legend

Spec `68 - Relationship color legend.md`: a free map gives its relation
colors a meaning, either its own (`color_legend`, a JSON object of palette
color to meaning) or through a Room preset it stays linked to
(`legend_preset_id`), never both. Presets are a new backend-only table with
the usual deny policy. Additive: existing maps start with no meanings.

Revision ID: e7b3d9a1c5f2
Revises: d4a8f2c6b9e1
Create Date: 2026-11-09 14:10:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "e7b3d9a1c5f2"
down_revision: Union[str, Sequence[str], None] = "d4a8f2c6b9e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "relationship_map_legend_presets",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("entries", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("room_id", "name", name="uq_relationship_map_legend_presets_name"),
    )
    op.create_index(
        op.f("ix_relationship_map_legend_presets_room_id"),
        "relationship_map_legend_presets",
        ["room_id"],
        unique=False,
    )
    op.execute("ALTER TABLE public.relationship_map_legend_presets ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY backend_only_deny_clients ON public.relationship_map_legend_presets "
        "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
    )

    op.add_column(
        "relationship_maps",
        sa.Column("color_legend", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column("relationship_maps", sa.Column("legend_preset_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_relationship_maps_legend_preset",
        "relationship_maps",
        "relationship_map_legend_presets",
        ["legend_preset_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_relationship_maps_legend_preset_id"),
        "relationship_maps",
        ["legend_preset_id"],
        unique=False,
    )
    op.create_check_constraint(
        "ck_relationship_maps_legend",
        "relationship_maps",
        "legend_preset_id IS NULL OR color_legend IS NULL",
    )


def downgrade() -> None:
    op.drop_constraint("ck_relationship_maps_legend", "relationship_maps", type_="check")
    op.drop_index(op.f("ix_relationship_maps_legend_preset_id"), table_name="relationship_maps")
    op.drop_constraint(
        "fk_relationship_maps_legend_preset", "relationship_maps", type_="foreignkey"
    )
    op.drop_column("relationship_maps", "legend_preset_id")
    op.drop_column("relationship_maps", "color_legend")
    op.drop_index(
        op.f("ix_relationship_map_legend_presets_room_id"),
        table_name="relationship_map_legend_presets",
    )
    op.drop_table("relationship_map_legend_presets")

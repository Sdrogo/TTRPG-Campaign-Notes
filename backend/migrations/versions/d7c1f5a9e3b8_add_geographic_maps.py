"""add geographic maps

Spec `38 - Geographic maps.md` (unit 38_1): a map gets a `kind` (`free`, as
before, or `geographic`) and, for a geographic one, a flat plane
(`plane_width`, `plane_height`) and an optional stored background image
(`background_path`). Its content hangs off the map in three tables of their
own, so the free board's cards, groups and arrows are not touched: areas
(closed shapes, `points` as JSON) and pins (points), both optionally bound to
a Document, and links between an area or a pin and another. Everything
cascades with the map; an area or pin also cascades with its Document, and a
link with either end. A Document appears at most once per map as an area and
once as a pin (the domain refuses both). Like every table in `public` they
are backend-only: RLS on, plus the explicit deny policy for the client roles
(code-standards.md -> Data and Storage).

Revision ID: d7c1f5a9e3b8
Revises: e8b4d2f6a9c1
Create Date: 2026-10-17 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "d7c1f5a9e3b8"
down_revision: str | Sequence[str] | None = "e8b4d2f6a9c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("relationship_map_areas", "relationship_map_pins", "relationship_map_links")


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "relationship_maps",
        sa.Column("kind", sa.String(length=12), server_default="free", nullable=False),
    )
    op.add_column("relationship_maps", sa.Column("plane_width", sa.Integer(), nullable=True))
    op.add_column("relationship_maps", sa.Column("plane_height", sa.Integer(), nullable=True))
    op.add_column(
        "relationship_maps", sa.Column("background_path", sa.String(length=300), nullable=True)
    )
    op.create_check_constraint(
        "ck_relationship_maps_kind",
        "relationship_maps",
        "(kind = 'free' AND plane_width IS NULL AND plane_height IS NULL"
        " AND background_path IS NULL)"
        " OR (kind = 'geographic' AND plane_width >= 100 AND plane_width <= 20000"
        " AND plane_height >= 100 AND plane_height <= 20000"
        " AND source_document_id IS NULL)",
    )

    op.create_table(
        "relationship_map_areas",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("map_id", sa.UUID(), nullable=False),
        sa.Column("document_id", sa.UUID(), nullable=True),
        sa.Column("name", sa.String(length=80), nullable=True),
        sa.Column("subtitle", sa.String(length=80), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("points", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("color", sa.String(length=10), nullable=False),
        sa.Column("dashed", sa.Boolean(), nullable=False),
        sa.Column("filled", sa.Boolean(), nullable=False),
        sa.Column("master_only", sa.Boolean(), nullable=False),
        sa.CheckConstraint(
            "(document_id IS NULL) = (name IS NOT NULL)", name="ck_relationship_map_areas_kind"
        ),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["map_id"], ["relationship_maps.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("map_id", "document_id", name="uq_relationship_map_areas_document"),
    )
    op.create_index(
        op.f("ix_relationship_map_areas_document_id"),
        "relationship_map_areas",
        ["document_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_relationship_map_areas_map_id"), "relationship_map_areas", ["map_id"], unique=False
    )

    op.create_table(
        "relationship_map_pins",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("map_id", sa.UUID(), nullable=False),
        sa.Column("document_id", sa.UUID(), nullable=True),
        sa.Column("name", sa.String(length=80), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("x", sa.Double(), nullable=False),
        sa.Column("y", sa.Double(), nullable=False),
        sa.Column("label_side", sa.String(length=6), nullable=False),
        sa.Column("color", sa.String(length=10), nullable=False),
        sa.Column("master_only", sa.Boolean(), nullable=False),
        sa.CheckConstraint(
            "(document_id IS NULL) = (name IS NOT NULL)", name="ck_relationship_map_pins_kind"
        ),
        sa.CheckConstraint(
            "label_side IN ('left', 'right', 'above', 'below')",
            name="ck_relationship_map_pins_label_side",
        ),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["map_id"], ["relationship_maps.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("map_id", "document_id", name="uq_relationship_map_pins_document"),
    )
    op.create_index(
        op.f("ix_relationship_map_pins_document_id"),
        "relationship_map_pins",
        ["document_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_relationship_map_pins_map_id"), "relationship_map_pins", ["map_id"], unique=False
    )

    op.create_table(
        "relationship_map_links",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("map_id", sa.UUID(), nullable=False),
        sa.Column("from_area_id", sa.UUID(), nullable=True),
        sa.Column("from_pin_id", sa.UUID(), nullable=True),
        sa.Column("to_area_id", sa.UUID(), nullable=True),
        sa.Column("to_pin_id", sa.UUID(), nullable=True),
        sa.Column("direction", sa.String(length=10), nullable=False),
        sa.Column("label", sa.String(length=60), nullable=True),
        sa.Column("reverse_label", sa.String(length=60), nullable=True),
        sa.Column("bend", sa.Double(), nullable=True),
        sa.Column("label_position", sa.Double(), nullable=True),
        sa.Column("reverse_label_position", sa.Double(), nullable=True),
        sa.Column("label_offset", sa.Double(), nullable=True),
        sa.Column("reverse_label_offset", sa.Double(), nullable=True),
        sa.Column("color", sa.String(length=10), nullable=False),
        sa.Column("master_only", sa.Boolean(), nullable=False),
        sa.CheckConstraint(
            "(from_area_id IS NULL) <> (from_pin_id IS NULL)",
            name="ck_relationship_map_links_from",
        ),
        sa.CheckConstraint(
            "(to_area_id IS NULL) <> (to_pin_id IS NULL)", name="ck_relationship_map_links_to"
        ),
        sa.CheckConstraint(
            "from_area_id IS DISTINCT FROM to_area_id OR from_area_id IS NULL",
            name="ck_relationship_map_links_area_ends_differ",
        ),
        sa.CheckConstraint(
            "from_pin_id IS DISTINCT FROM to_pin_id OR from_pin_id IS NULL",
            name="ck_relationship_map_links_pin_ends_differ",
        ),
        sa.CheckConstraint(
            "direction IN ('forward', 'both', 'none')", name="ck_relationship_map_links_direction"
        ),
        sa.CheckConstraint(
            "reverse_label IS NULL OR direction = 'both'",
            name="ck_relationship_map_links_reverse_label",
        ),
        sa.CheckConstraint(
            "label_position IS NULL"
            " OR (label IS NOT NULL AND label_position >= 0 AND label_position <= 1)",
            name="ck_relationship_map_links_label_position",
        ),
        sa.CheckConstraint(
            "reverse_label_position IS NULL"
            " OR (reverse_label IS NOT NULL AND reverse_label_position >= 0"
            " AND reverse_label_position <= 1)",
            name="ck_relationship_map_links_reverse_label_position",
        ),
        sa.CheckConstraint(
            "label_offset IS NULL"
            " OR (label_position IS NOT NULL AND label_offset >= -2000 AND label_offset <= 2000)",
            name="ck_relationship_map_links_label_offset",
        ),
        sa.CheckConstraint(
            "reverse_label_offset IS NULL"
            " OR (reverse_label_position IS NOT NULL AND reverse_label_offset >= -2000"
            " AND reverse_label_offset <= 2000)",
            name="ck_relationship_map_links_reverse_label_offset",
        ),
        sa.ForeignKeyConstraint(["from_area_id"], ["relationship_map_areas.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["from_pin_id"], ["relationship_map_pins.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["map_id"], ["relationship_maps.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["to_area_id"], ["relationship_map_areas.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["to_pin_id"], ["relationship_map_pins.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_relationship_map_links_map_id"), "relationship_map_links", ["map_id"], unique=False
    )

    for table in _TABLES:
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY backend_only_deny_clients ON public.{table} "
            "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_relationship_map_links_map_id"), table_name="relationship_map_links")
    op.drop_table("relationship_map_links")
    op.drop_index(op.f("ix_relationship_map_pins_map_id"), table_name="relationship_map_pins")
    op.drop_index(op.f("ix_relationship_map_pins_document_id"), table_name="relationship_map_pins")
    op.drop_table("relationship_map_pins")
    op.drop_index(op.f("ix_relationship_map_areas_map_id"), table_name="relationship_map_areas")
    op.drop_index(
        op.f("ix_relationship_map_areas_document_id"), table_name="relationship_map_areas"
    )
    op.drop_table("relationship_map_areas")
    op.drop_constraint("ck_relationship_maps_kind", "relationship_maps", type_="check")
    op.drop_column("relationship_maps", "background_path")
    op.drop_column("relationship_maps", "plane_height")
    op.drop_column("relationship_maps", "plane_width")
    op.drop_column("relationship_maps", "kind")

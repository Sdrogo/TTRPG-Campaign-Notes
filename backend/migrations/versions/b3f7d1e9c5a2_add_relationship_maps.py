"""add relationship maps

Spec `28 - Relationship maps.md` (unit 28_1): a Room holds free boards where
Document cards, text cards and groups are joined by labelled arrows.
`relationship_maps` carries the map's name, description and visibility (with
`relationship_map_grants` for the selective level); groups, cards and arrows
hang off the map and cascade with it. A Document card cascades with its
Document, and an arrow cascades with either of its ends, so deleting a
Document removes its cards and every arrow touching them. A Document appears
at most once per map. Like every table in `public` they are backend-only: RLS
on, plus the explicit deny policy for the client roles (code-standards.md ->
Data and Storage).

Revision ID: b3f7d1e9c5a2
Revises: a8c4e2f6b1d3
Create Date: 2026-10-12 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3f7d1e9c5a2"
down_revision: str | Sequence[str] | None = "a8c4e2f6b1d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = (
    "relationship_maps",
    "relationship_map_grants",
    "relationship_map_groups",
    "relationship_map_cards",
    "relationship_map_arrows",
)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "relationship_maps",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("visibility", sa.String(length=20), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_relationship_maps_room_id"), "relationship_maps", ["room_id"], unique=False
    )
    op.create_table(
        "relationship_map_grants",
        sa.Column("map_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(["map_id"], ["relationship_maps.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("map_id", "user_id"),
    )
    op.create_table(
        "relationship_map_groups",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("map_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=80), nullable=True),
        sa.Column("color", sa.String(length=10), nullable=False),
        sa.Column("struck", sa.Boolean(), nullable=False),
        sa.Column("x", sa.Double(), nullable=False),
        sa.Column("y", sa.Double(), nullable=False),
        sa.Column("width", sa.Double(), nullable=False),
        sa.Column("height", sa.Double(), nullable=False),
        sa.ForeignKeyConstraint(["map_id"], ["relationship_maps.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_relationship_map_groups_map_id"),
        "relationship_map_groups",
        ["map_id"],
        unique=False,
    )
    op.create_table(
        "relationship_map_cards",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("map_id", sa.UUID(), nullable=False),
        sa.Column("group_id", sa.UUID(), nullable=True),
        sa.Column("document_id", sa.UUID(), nullable=True),
        sa.Column("text", sa.String(length=300), nullable=True),
        sa.Column("caption", sa.String(length=80), nullable=True),
        sa.Column("size", sa.String(length=10), nullable=False),
        sa.Column("master_only", sa.Boolean(), nullable=False),
        sa.Column("color", sa.String(length=10), nullable=False),
        sa.Column("struck", sa.Boolean(), nullable=False),
        sa.Column("x", sa.Double(), nullable=False),
        sa.Column("y", sa.Double(), nullable=False),
        sa.CheckConstraint(
            "size IN ('normal', 'large', 'title')", name="ck_relationship_map_cards_size"
        ),
        sa.CheckConstraint(
            "(document_id IS NULL) <> (text IS NULL)", name="ck_relationship_map_cards_kind"
        ),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["relationship_map_groups.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["map_id"], ["relationship_maps.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("map_id", "document_id", name="uq_relationship_map_cards_document"),
    )
    op.create_index(
        op.f("ix_relationship_map_cards_document_id"),
        "relationship_map_cards",
        ["document_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_relationship_map_cards_map_id"), "relationship_map_cards", ["map_id"], unique=False
    )
    op.create_table(
        "relationship_map_arrows",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("map_id", sa.UUID(), nullable=False),
        sa.Column("from_card_id", sa.UUID(), nullable=True),
        sa.Column("from_group_id", sa.UUID(), nullable=True),
        sa.Column("to_card_id", sa.UUID(), nullable=True),
        sa.Column("to_group_id", sa.UUID(), nullable=True),
        sa.Column("direction", sa.String(length=10), nullable=False),
        sa.Column("label", sa.String(length=60), nullable=True),
        sa.Column("reverse_label", sa.String(length=60), nullable=True),
        sa.Column("color", sa.String(length=10), nullable=False),
        sa.Column("master_only", sa.Boolean(), nullable=False),
        sa.CheckConstraint(
            "direction IN ('forward', 'both', 'none')", name="ck_relationship_map_arrows_direction"
        ),
        sa.CheckConstraint(
            "reverse_label IS NULL OR direction = 'both'",
            name="ck_relationship_map_arrows_reverse_label",
        ),
        sa.CheckConstraint(
            "(from_card_id IS NULL) <> (from_group_id IS NULL)",
            name="ck_relationship_map_arrows_from",
        ),
        sa.CheckConstraint(
            "(to_card_id IS NULL) <> (to_group_id IS NULL)", name="ck_relationship_map_arrows_to"
        ),
        sa.CheckConstraint(
            "from_card_id IS DISTINCT FROM to_card_id OR from_card_id IS NULL",
            name="ck_relationship_map_arrows_card_ends_differ",
        ),
        sa.CheckConstraint(
            "from_group_id IS DISTINCT FROM to_group_id OR from_group_id IS NULL",
            name="ck_relationship_map_arrows_group_ends_differ",
        ),
        sa.ForeignKeyConstraint(
            ["from_card_id"], ["relationship_map_cards.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["from_group_id"], ["relationship_map_groups.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["map_id"], ["relationship_maps.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["to_card_id"], ["relationship_map_cards.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["to_group_id"], ["relationship_map_groups.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_relationship_map_arrows_map_id"),
        "relationship_map_arrows",
        ["map_id"],
        unique=False,
    )
    for table in _TABLES:
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY backend_only_deny_clients ON public.{table} "
            "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_relationship_map_arrows_map_id"), table_name="relationship_map_arrows")
    op.drop_table("relationship_map_arrows")
    op.drop_index(op.f("ix_relationship_map_cards_map_id"), table_name="relationship_map_cards")
    op.drop_index(
        op.f("ix_relationship_map_cards_document_id"), table_name="relationship_map_cards"
    )
    op.drop_table("relationship_map_cards")
    op.drop_index(op.f("ix_relationship_map_groups_map_id"), table_name="relationship_map_groups")
    op.drop_table("relationship_map_groups")
    op.drop_table("relationship_map_grants")
    op.drop_index(op.f("ix_relationship_maps_room_id"), table_name="relationship_maps")
    op.drop_table("relationship_maps")

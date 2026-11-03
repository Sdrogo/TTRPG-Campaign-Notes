"""add clocks

Spec `61 - Clocks.md`: a Room's progress clocks. One row of clock rules per
Room (`room_clock_rules`: who opens, who marks, whether marks can be
undone), its free labels and mark kinds, its templates, its clocks with
their Selective grants, labels, marks and history, and its groups (free,
race, turn, sequence). A Section gets a `clocks` block (its chips in
`room_section_block_clocks`, or `all_clocks`) and the landing page a
`page_clocks` card. Every new table is backend-only: RLS on, plus the
explicit deny policy for the client roles (code-standards.md -> Data and
Storage).

Revision ID: c1d7e3a9f5b2
Revises: e9c4a2f7b1d8
Create Date: 2026-11-03 14:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "c1d7e3a9f5b2"
down_revision: Union[str, Sequence[str], None] = "e9c4a2f7b1d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_TABLES = (
    "room_clock_rules",
    "room_clock_labels",
    "room_clock_mark_kinds",
    "room_clock_templates",
    "room_clock_groups",
    "room_clocks",
    "room_clock_grants",
    "room_clock_label_links",
    "room_clock_marks",
    "room_clock_events",
    "room_section_block_clocks",
)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "room_clock_rules",
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("open_policy", sa.String(length=10), nullable=False),
        sa.Column("mark_policy", sa.String(length=20), nullable=False),
        sa.Column("allow_unmark", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "open_policy IN ('master', 'everyone', 'propose')",
            name="ck_room_clock_rules_open_policy",
        ),
        sa.CheckConstraint(
            "mark_policy IN ('master', 'master_and_creator', 'everyone')",
            name="ck_room_clock_rules_mark_policy",
        ),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("room_id"),
    )
    op.create_table(
        "room_clock_labels",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=30), nullable=False),
        sa.Column("color", sa.String(length=10), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_room_clock_labels_name",
        "room_clock_labels",
        ["room_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_table(
        "room_clock_mark_kinds",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=30), nullable=False),
        sa.Column("color", sa.String(length=10), nullable=False),
        sa.Column("who", sa.String(length=10), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "who IN ('master', 'players', 'everyone')", name="ck_room_clock_mark_kinds_who"
        ),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_room_clock_mark_kinds_name",
        "room_clock_mark_kinds",
        ["room_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_table(
        "room_clock_templates",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("settings", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_room_clock_templates_room_id"), "room_clock_templates", ["room_id"], unique=False
    )
    op.create_table(
        "room_clock_groups",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("mode", sa.String(length=10), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.CheckConstraint(
            "mode IN ('free', 'race', 'turn', 'sequence')", name="ck_room_clock_groups_mode"
        ),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_room_clock_groups_room_id"), "room_clock_groups", ["room_id"], unique=False
    )
    op.create_table(
        "room_clocks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("description", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("segments", sa.SmallInteger(), nullable=False),
        sa.Column("filled", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("color", sa.String(length=10), nullable=False),
        sa.Column(
            "stage_labels",
            postgresql.ARRAY(sa.String(length=60)),
            server_default=sa.text("'{}'"),
            nullable=False,
        ),
        sa.Column("closing_condition", sa.String(length=140), nullable=True),
        sa.Column("consequence", sa.Text(), nullable=True),
        sa.Column("forward_only", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("mark_policy", sa.String(length=20), nullable=True),
        sa.Column("state", sa.String(length=10), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("group_id", sa.UUID(), nullable=True),
        sa.Column("group_position", sa.Integer(), nullable=True),
        sa.Column("decisive_label", sa.String(length=30), nullable=True),
        sa.Column("document_id", sa.UUID(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("visibility", sa.String(length=20), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.CheckConstraint("segments >= 2 AND segments <= 16", name="ck_room_clocks_segments"),
        sa.CheckConstraint("filled >= 0 AND filled <= segments", name="ck_room_clocks_filled"),
        sa.CheckConstraint(
            "state IN ('proposed', 'open', 'closed', 'lapsed')", name="ck_room_clocks_state"
        ),
        sa.CheckConstraint(
            "mark_policy IS NULL OR mark_policy IN ('master', 'master_and_creator', 'everyone')",
            name="ck_room_clocks_mark_policy",
        ),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["room_clock_groups.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_room_clocks_room_id"), "room_clocks", ["room_id"], unique=False)
    op.create_index(op.f("ix_room_clocks_group_id"), "room_clocks", ["group_id"], unique=False)
    op.create_index(
        op.f("ix_room_clocks_document_id"), "room_clocks", ["document_id"], unique=False
    )
    op.create_table(
        "room_clock_grants",
        sa.Column("clock_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(["clock_id"], ["room_clocks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("clock_id", "user_id"),
    )
    op.create_table(
        "room_clock_label_links",
        sa.Column("clock_id", sa.UUID(), nullable=False),
        sa.Column("label_id", sa.UUID(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["clock_id"], ["room_clocks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["label_id"], ["room_clock_labels.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("clock_id", "label_id"),
    )
    op.create_index(
        op.f("ix_room_clock_label_links_label_id"),
        "room_clock_label_links",
        ["label_id"],
        unique=False,
    )
    op.create_table(
        "room_clock_marks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("clock_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("kind_id", sa.UUID(), nullable=True),
        sa.Column("delta", sa.SmallInteger(), nullable=False),
        sa.Column("note", sa.String(length=200), nullable=True),
        sa.Column("undone_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["clock_id"], ["room_clocks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["kind_id"], ["room_clock_mark_kinds.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_room_clock_marks_clock_id"), "room_clock_marks", ["clock_id"], unique=False
    )
    op.create_index(
        op.f("ix_room_clock_marks_user_id"), "room_clock_marks", ["user_id"], unique=False
    )
    op.create_table(
        "room_clock_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("clock_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["clock_id"], ["room_clocks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_room_clock_events_clock_created",
        "room_clock_events",
        ["clock_id", "created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_room_clock_events_user_id"), "room_clock_events", ["user_id"], unique=False
    )

    op.add_column(
        "room_section_blocks",
        sa.Column("all_clocks", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.drop_constraint("ck_room_section_blocks_kind", "room_section_blocks", type_="check")
    op.create_check_constraint(
        "ck_room_section_blocks_kind",
        "room_section_blocks",
        "kind IN ('documents', 'maps', 'session_zero', 'tool', 'clocks')",
    )
    op.create_check_constraint(
        "ck_room_section_blocks_all_clocks",
        "room_section_blocks",
        "NOT all_clocks OR kind = 'clocks'",
    )
    op.create_table(
        "room_section_block_clocks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("block_id", sa.UUID(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("clock_id", sa.UUID(), nullable=True),
        sa.Column("group_id", sa.UUID(), nullable=True),
        sa.CheckConstraint(
            "(clock_id IS NULL) <> (group_id IS NULL)", name="ck_room_section_block_clocks_one"
        ),
        sa.ForeignKeyConstraint(["block_id"], ["room_section_blocks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["clock_id"], ["room_clocks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["room_clock_groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_room_section_block_clocks_block_id"),
        "room_section_block_clocks",
        ["block_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_room_section_block_clocks_clock_id"),
        "room_section_block_clocks",
        ["clock_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_room_section_block_clocks_group_id"),
        "room_section_block_clocks",
        ["group_id"],
        unique=False,
    )

    op.drop_constraint("ck_room_sections_kind", "room_sections", type_="check")
    op.create_check_constraint(
        "ck_room_sections_kind",
        "room_sections",
        "kind IN ('custom', 'page_documents', 'page_maps', 'page_session_zero', 'page_clocks')",
    )

    for table in _NEW_TABLES:
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY backend_only_deny_clients ON public.{table} "
            "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM room_sections WHERE kind = 'page_clocks'")
    op.drop_constraint("ck_room_sections_kind", "room_sections", type_="check")
    op.create_check_constraint(
        "ck_room_sections_kind",
        "room_sections",
        "kind IN ('custom', 'page_documents', 'page_maps', 'page_session_zero')",
    )

    op.drop_table("room_section_block_clocks")
    op.execute("DELETE FROM room_section_blocks WHERE kind = 'clocks'")
    op.drop_constraint("ck_room_section_blocks_all_clocks", "room_section_blocks", type_="check")
    op.drop_constraint("ck_room_section_blocks_kind", "room_section_blocks", type_="check")
    op.create_check_constraint(
        "ck_room_section_blocks_kind",
        "room_section_blocks",
        "kind IN ('documents', 'maps', 'session_zero', 'tool')",
    )
    op.drop_column("room_section_blocks", "all_clocks")

    op.drop_table("room_clock_events")
    op.drop_table("room_clock_marks")
    op.drop_table("room_clock_label_links")
    op.drop_table("room_clock_grants")
    op.drop_table("room_clocks")
    op.drop_table("room_clock_groups")
    op.drop_table("room_clock_templates")
    op.drop_table("room_clock_mark_kinds")
    op.drop_table("room_clock_labels")
    op.drop_table("room_clock_rules")

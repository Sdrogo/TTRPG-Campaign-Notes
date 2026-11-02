"""add room sections

Spec `55 - Room landing page.md`: the Room's landing page is a list of
Sections. A custom Section holds blocks (Documents with some Tags, maps,
Session 0 features), a Documents block optional groups of Tags; the three
page cards (Documents, Maps, Session 0) open the existing pages. Every
existing Room gets the three page cards, untitled so each viewer reads
their name in their own language. Backend-only, like every table.

Revision ID: d5b8e1f3a9c7
Revises: c8f2d6a4e1b7
Create Date: 2026-10-31 18:02:25.806296

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd5b8e1f3a9c7'
down_revision: Union[str, Sequence[str], None] = 'c8f2d6a4e1b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('room_sections',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('title', sa.String(length=100), nullable=True),
    sa.Column('description', sa.Text(), server_default=sa.text("''"), nullable=False),
    sa.Column('image_path', sa.String(length=300), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("kind <> 'custom' OR title IS NOT NULL", name='ck_room_sections_title'),
    sa.CheckConstraint("kind IN ('custom', 'page_documents', 'page_maps', 'page_session_zero')", name='ck_room_sections_kind'),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_room_sections_room_id'), 'room_sections', ['room_id'], unique=False)
    op.create_index('uq_room_sections_page_kind', 'room_sections', ['room_id', 'kind'], unique=True, postgresql_where=sa.text("kind <> 'custom'"))
    op.create_table('room_section_blocks',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('section_id', sa.UUID(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('heading', sa.String(length=100), nullable=True),
    sa.Column('map_kind', sa.String(length=12), nullable=True),
    sa.Column('features', postgresql.ARRAY(sa.String(length=20)), server_default=sa.text("'{}'"), nullable=False),
    sa.CheckConstraint("(kind = 'session_zero') = (cardinality(features) > 0)", name='ck_room_section_blocks_features'),
    sa.CheckConstraint("kind IN ('documents', 'maps', 'session_zero')", name='ck_room_section_blocks_kind'),
    sa.CheckConstraint("map_kind IS NULL OR kind = 'maps'", name='ck_room_section_blocks_map_kind'),
    sa.ForeignKeyConstraint(['section_id'], ['room_sections.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_room_section_blocks_section_id'), 'room_section_blocks', ['section_id'], unique=False)
    op.create_table('room_section_block_groups',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('block_id', sa.UUID(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['block_id'], ['room_section_blocks.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_room_section_block_groups_block_id'), 'room_section_block_groups', ['block_id'], unique=False)
    op.create_table('room_section_block_tags',
    sa.Column('block_id', sa.UUID(), nullable=False),
    sa.Column('tag_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['block_id'], ['room_section_blocks.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tag_id'], ['tags.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('block_id', 'tag_id')
    )
    op.create_index(op.f('ix_room_section_block_tags_tag_id'), 'room_section_block_tags', ['tag_id'], unique=False)
    op.create_table('room_section_block_group_tags',
    sa.Column('group_id', sa.UUID(), nullable=False),
    sa.Column('tag_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['group_id'], ['room_section_block_groups.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tag_id'], ['tags.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('group_id', 'tag_id')
    )
    op.create_index(op.f('ix_room_section_block_group_tags_tag_id'), 'room_section_block_group_tags', ['tag_id'], unique=False)
    for table in (
        'room_sections',
        'room_section_blocks',
        'room_section_block_groups',
        'room_section_block_tags',
        'room_section_block_group_tags',
    ):
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY backend_only_deny_clients ON public.{table} "
            "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
        )
    # The three page cards of every existing Room, in their default order.
    op.execute(
        "INSERT INTO room_sections (id, room_id, position, kind) "
        "SELECT gen_random_uuid(), rooms.id, pages.position, pages.kind FROM rooms "
        "CROSS JOIN (VALUES (0, 'page_documents'), (1, 'page_maps'), "
        "(2, 'page_session_zero')) AS pages(position, kind)"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_room_section_block_group_tags_tag_id'), table_name='room_section_block_group_tags')
    op.drop_table('room_section_block_group_tags')
    op.drop_index(op.f('ix_room_section_block_tags_tag_id'), table_name='room_section_block_tags')
    op.drop_table('room_section_block_tags')
    op.drop_index(op.f('ix_room_section_block_groups_block_id'), table_name='room_section_block_groups')
    op.drop_table('room_section_block_groups')
    op.drop_index(op.f('ix_room_section_blocks_section_id'), table_name='room_section_blocks')
    op.drop_table('room_section_blocks')
    op.drop_index('uq_room_sections_page_kind', table_name='room_sections', postgresql_where=sa.text("kind <> 'custom'"))
    op.drop_index(op.f('ix_room_sections_room_id'), table_name='room_sections')
    op.drop_table('room_sections')

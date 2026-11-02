"""add section tools

Spec `60 - Sections refinements and standalone tools.md`: a Section's
`tool` block holds one Session 0 step (Retro, Stars and Wishes, Questions,
DDI, polls) of its own, outside every session. The step lives in a round
of its own that names its Section (`section_id`): such a round is never
one of the Session 0's sessions, so the "one open round" and the numbering
only count the sessions; its `current_module_id` is set while the Players
see the tool. A block remembers whether it starts folded (`collapsed`).
The Documents page has no maps row any more (Decision 13), so
`rooms.maps_position` goes.

Revision ID: e8c4a2f6b1d9
Revises: d5b8e1f3a9c7
Create Date: 2026-11-02 18:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e8c4a2f6b1d9'
down_revision: Union[str, Sequence[str], None] = 'd5b8e1f3a9c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('session_zero_rounds', sa.Column('section_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'session_zero_rounds_section_id_fkey',
        'session_zero_rounds',
        'room_sections',
        ['section_id'],
        ['id'],
        ondelete='CASCADE',
    )
    op.create_index(
        op.f('ix_session_zero_rounds_section_id'), 'session_zero_rounds', ['section_id'], unique=False
    )
    op.drop_constraint('uq_session_zero_rounds_number', 'session_zero_rounds', type_='unique')
    op.create_index(
        'uq_session_zero_rounds_number',
        'session_zero_rounds',
        ['room_id', 'number'],
        unique=True,
        postgresql_where=sa.text('section_id IS NULL'),
    )
    op.drop_index('uq_session_zero_rounds_open', table_name='session_zero_rounds')
    op.create_index(
        'uq_session_zero_rounds_open',
        'session_zero_rounds',
        ['room_id'],
        unique=True,
        postgresql_where=sa.text('closed_at IS NULL AND section_id IS NULL'),
    )

    op.add_column('room_section_blocks', sa.Column('module_id', sa.UUID(), nullable=True))
    op.add_column(
        'room_section_blocks',
        sa.Column('collapsed', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )
    op.create_foreign_key(
        'room_section_blocks_module_id_fkey',
        'room_section_blocks',
        'session_zero_modules',
        ['module_id'],
        ['id'],
        ondelete='CASCADE',
    )
    op.create_index(
        op.f('ix_room_section_blocks_module_id'), 'room_section_blocks', ['module_id'], unique=True
    )
    op.drop_constraint('ck_room_section_blocks_kind', 'room_section_blocks', type_='check')
    op.create_check_constraint(
        'ck_room_section_blocks_kind',
        'room_section_blocks',
        "kind IN ('documents', 'maps', 'session_zero', 'tool')",
    )
    op.create_check_constraint(
        'ck_room_section_blocks_module',
        'room_section_blocks',
        "(kind = 'tool') = (module_id IS NOT NULL)",
    )

    op.drop_column('rooms', 'maps_position')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        'rooms',
        sa.Column('maps_position', sa.Integer(), server_default=sa.text('0'), nullable=False),
    )

    op.execute("DELETE FROM room_section_blocks WHERE kind = 'tool'")
    op.drop_constraint('ck_room_section_blocks_module', 'room_section_blocks', type_='check')
    op.drop_constraint('ck_room_section_blocks_kind', 'room_section_blocks', type_='check')
    op.create_check_constraint(
        'ck_room_section_blocks_kind',
        'room_section_blocks',
        "kind IN ('documents', 'maps', 'session_zero')",
    )
    op.drop_index(op.f('ix_room_section_blocks_module_id'), table_name='room_section_blocks')
    op.drop_constraint('room_section_blocks_module_id_fkey', 'room_section_blocks', type_='foreignkey')
    op.drop_column('room_section_blocks', 'collapsed')
    op.drop_column('room_section_blocks', 'module_id')

    op.execute('DELETE FROM session_zero_rounds WHERE section_id IS NOT NULL')
    op.drop_index('uq_session_zero_rounds_open', table_name='session_zero_rounds')
    op.create_index(
        'uq_session_zero_rounds_open',
        'session_zero_rounds',
        ['room_id'],
        unique=True,
        postgresql_where=sa.text('closed_at IS NULL'),
    )
    op.drop_index('uq_session_zero_rounds_number', table_name='session_zero_rounds')
    op.create_unique_constraint(
        'uq_session_zero_rounds_number', 'session_zero_rounds', ['room_id', 'number']
    )
    op.drop_index(op.f('ix_session_zero_rounds_section_id'), table_name='session_zero_rounds')
    op.drop_constraint('session_zero_rounds_section_id_fkey', 'session_zero_rounds', type_='foreignkey')
    op.drop_column('session_zero_rounds', 'section_id')

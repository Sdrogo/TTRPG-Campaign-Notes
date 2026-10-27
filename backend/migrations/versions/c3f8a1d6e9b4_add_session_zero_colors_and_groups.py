"""add session zero colors and groups

Spec `46c - Session 0 refinements.md`: a colour for each column (Decision 5,
a `MapColor`; existing columns keep `default`) and groups of related
post-its in a Retro column (Decision 9): `session_zero_groups`, and each
post-it's `group_id`, cleared when its group is deleted. The new table goes
with the Room and, like every table in `public`, is backend-only: RLS on
plus the explicit deny policy for the client roles (code-standards.md ->
Data and Storage).

Revision ID: c3f8a1d6e9b4
Revises: 4797859660e2
Create Date: 2026-10-27 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3f8a1d6e9b4'
down_revision: Union[str, Sequence[str], None] = '4797859660e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'session_zero_columns',
        sa.Column('color', sa.String(length=10), server_default=sa.text("'default'"), nullable=False),
    )
    op.create_table('session_zero_groups',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('column_id', sa.UUID(), nullable=False),
    sa.Column('title', sa.String(length=60), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['column_id'], ['session_zero_columns.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['room_id'], ['session_zero.room_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_session_zero_groups_column_id'), 'session_zero_groups', ['column_id'], unique=False)
    op.create_index(op.f('ix_session_zero_groups_room_id'), 'session_zero_groups', ['room_id'], unique=False)
    op.add_column('session_zero_cards', sa.Column('group_id', sa.UUID(), nullable=True))
    op.create_index(op.f('ix_session_zero_cards_group_id'), 'session_zero_cards', ['group_id'], unique=False)
    op.create_foreign_key(
        'session_zero_cards_group_id_fkey',
        'session_zero_cards',
        'session_zero_groups',
        ['group_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.execute("ALTER TABLE public.session_zero_groups ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY backend_only_deny_clients ON public.session_zero_groups "
        "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('session_zero_cards_group_id_fkey', 'session_zero_cards', type_='foreignkey')
    op.drop_index(op.f('ix_session_zero_cards_group_id'), table_name='session_zero_cards')
    op.drop_column('session_zero_cards', 'group_id')
    op.drop_index(op.f('ix_session_zero_groups_room_id'), table_name='session_zero_groups')
    op.drop_index(op.f('ix_session_zero_groups_column_id'), table_name='session_zero_groups')
    op.drop_table('session_zero_groups')
    op.drop_column('session_zero_columns', 'color')

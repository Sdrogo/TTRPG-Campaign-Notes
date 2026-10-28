"""add session zero modules

Spec `47 - Modular Session 0.md` (47_1): every session (round) is a chain
of modules the Master composes and walks through. `session_zero_modules`
holds each round's chain; `session_zero_rounds.current_module_id` the step
the table is on; a round's columns now belong to a module (Retro, or the
two fixed Stars and Wishes columns, `kind` `stars` / `wishes`). Lines &
Veils keeps its three Room-wide columns, in no round and no module.
Every existing round becomes a chain of one Retro module, made current,
holding its columns (Decision 13), so nothing changes on screen.

Revision ID: e5c1a8f3b7d2
Revises: d4a7e2c9f1b3
Create Date: 2026-10-27 23:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5c1a8f3b7d2'
down_revision: Union[str, Sequence[str], None] = 'd4a7e2c9f1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('session_zero_modules',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('round_id', sa.UUID(), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['room_id'], ['session_zero.room_id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['round_id'], ['session_zero_rounds.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_session_zero_modules_round_id'), 'session_zero_modules', ['round_id'], unique=False)
    op.execute("ALTER TABLE public.session_zero_modules ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY backend_only_deny_clients ON public.session_zero_modules "
        "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
    )
    op.add_column('session_zero_rounds', sa.Column('current_module_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'session_zero_rounds_current_module_id_fkey',
        'session_zero_rounds',
        'session_zero_modules',
        ['current_module_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.add_column('session_zero_columns', sa.Column('module_id', sa.UUID(), nullable=True))
    op.create_index(op.f('ix_session_zero_columns_module_id'), 'session_zero_columns', ['module_id'], unique=False)
    op.create_foreign_key(
        'session_zero_columns_module_id_fkey',
        'session_zero_columns',
        'session_zero_modules',
        ['module_id'],
        ['id'],
        ondelete='CASCADE',
    )
    # Decision 13: one current Retro module per existing round, holding its
    # columns.
    op.execute(
        """
        INSERT INTO session_zero_modules (id, room_id, round_id, kind, position, created_at)
        SELECT gen_random_uuid(), room_id, id, 'retro', 0, started_at
        FROM session_zero_rounds
        """
    )
    op.execute(
        """
        UPDATE session_zero_columns AS col SET module_id = module.id
        FROM session_zero_modules AS module WHERE module.round_id = col.round_id
        """
    )
    op.execute(
        """
        UPDATE session_zero_rounds AS round SET current_module_id = module.id
        FROM session_zero_modules AS module WHERE module.round_id = round.id
        """
    )
    op.drop_constraint('ck_session_zero_columns_board', 'session_zero_columns', type_='check')
    op.create_check_constraint(
        'ck_session_zero_columns_board',
        'session_zero_columns',
        "(round_id IS NOT NULL AND module_id IS NOT NULL"
        " AND (kind IS NULL OR kind IN ('stars', 'wishes')))"
        " OR (round_id IS NULL AND module_id IS NULL AND kind IN ('must', 'lines', 'veils'))",
    )
    # The Room-wide Lines & Veils kinds stay unique; Stars and Wishes ones
    # repeat in every module.
    op.drop_index('uq_session_zero_columns_kind', table_name='session_zero_columns')
    op.create_index(
        'uq_session_zero_columns_kind',
        'session_zero_columns',
        ['room_id', 'kind'],
        unique=True,
        postgresql_where=sa.text('round_id IS NULL'),
    )


def downgrade() -> None:
    """Downgrade schema. Stars and Wishes columns and every module but each
    round's first Retro one go; the Retro columns stay with their round."""
    op.execute("DELETE FROM session_zero_columns WHERE kind IN ('stars', 'wishes')")
    op.drop_index('uq_session_zero_columns_kind', table_name='session_zero_columns')
    op.create_index(
        'uq_session_zero_columns_kind',
        'session_zero_columns',
        ['room_id', 'kind'],
        unique=True,
        postgresql_where=sa.text('kind IS NOT NULL'),
    )
    op.drop_constraint('ck_session_zero_columns_board', 'session_zero_columns', type_='check')
    op.create_check_constraint(
        'ck_session_zero_columns_board',
        'session_zero_columns',
        "(round_id IS NOT NULL AND kind IS NULL)"
        " OR (round_id IS NULL AND kind IN ('must', 'lines', 'veils'))",
    )
    op.drop_constraint('session_zero_columns_module_id_fkey', 'session_zero_columns', type_='foreignkey')
    op.drop_index(op.f('ix_session_zero_columns_module_id'), table_name='session_zero_columns')
    op.drop_column('session_zero_columns', 'module_id')
    op.drop_constraint('session_zero_rounds_current_module_id_fkey', 'session_zero_rounds', type_='foreignkey')
    op.drop_column('session_zero_rounds', 'current_module_id')
    op.drop_index(op.f('ix_session_zero_modules_round_id'), table_name='session_zero_modules')
    op.drop_table('session_zero_modules')

"""add session zero polls

Spec `53 - Session 0 polls.md`: the Poll module. A Poll module holds up to
10 polls of 2 to 20 choices, each with its settings (votes per person,
whether the Master votes, who sees who voted what, a live or secret
tally), and the members' votes. Backend-only like the rest of Session 0.

Revision ID: b9e4c2a7d1f3
Revises: a7d3f9b2c6e1
Create Date: 2026-10-30 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b9e4c2a7d1f3'
down_revision: Union[str, Sequence[str], None] = 'a7d3f9b2c6e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('session_zero_polls',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('module_id', sa.UUID(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('body', sa.String(length=200), nullable=False),
    sa.Column('hint', sa.String(length=300), nullable=True),
    sa.Column('max_choices', sa.SmallInteger(), server_default=sa.text('1'), nullable=False),
    sa.Column('master_votes', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('voters_visible', sa.String(length=10), server_default=sa.text("'master'"), nullable=False),
    sa.Column('results', sa.String(length=10), server_default=sa.text("'live'"), nullable=False),
    sa.Column('revealed', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("results IN ('live', 'hidden')", name='ck_session_zero_polls_results'),
    sa.CheckConstraint("voters_visible IN ('master', 'everyone', 'nobody')", name='ck_session_zero_polls_voters_visible'),
    sa.CheckConstraint('max_choices >= 1', name='ck_session_zero_polls_max_choices'),
    sa.ForeignKeyConstraint(['module_id'], ['session_zero_modules.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['room_id'], ['session_zero.room_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_session_zero_polls_module_id'), 'session_zero_polls', ['module_id'], unique=False)
    op.create_table('session_zero_poll_options',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('poll_id', sa.UUID(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('body', sa.String(length=200), nullable=False),
    sa.ForeignKeyConstraint(['poll_id'], ['session_zero_polls.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_session_zero_poll_options_poll_id'), 'session_zero_poll_options', ['poll_id'], unique=False)
    op.create_table('session_zero_poll_votes',
    sa.Column('option_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('poll_id', sa.UUID(), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['option_id'], ['session_zero_poll_options.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['poll_id'], ['session_zero_polls.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['room_id'], ['session_zero.room_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('option_id', 'user_id')
    )
    op.create_index(op.f('ix_session_zero_poll_votes_poll_id'), 'session_zero_poll_votes', ['poll_id'], unique=False)
    op.create_index(op.f('ix_session_zero_poll_votes_user_id'), 'session_zero_poll_votes', ['user_id'], unique=False)
    for table in ('session_zero_polls', 'session_zero_poll_options', 'session_zero_poll_votes'):
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY backend_only_deny_clients ON public.{table} "
            "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
        )


def downgrade() -> None:
    """Downgrade schema. Poll modules go with their polls and votes."""
    op.drop_index(op.f('ix_session_zero_poll_votes_user_id'), table_name='session_zero_poll_votes')
    op.drop_index(op.f('ix_session_zero_poll_votes_poll_id'), table_name='session_zero_poll_votes')
    op.drop_table('session_zero_poll_votes')
    op.drop_index(op.f('ix_session_zero_poll_options_poll_id'), table_name='session_zero_poll_options')
    op.drop_table('session_zero_poll_options')
    op.drop_index(op.f('ix_session_zero_polls_module_id'), table_name='session_zero_polls')
    op.drop_table('session_zero_polls')
    # A round must keep a step: one made only of Poll modules gets a Lines &
    # Veils one in their place before they go.
    op.execute(
        """
        UPDATE session_zero_modules SET kind = 'lines_veils'
        WHERE kind = 'poll' AND id IN (
            SELECT DISTINCT ON (round_id) id FROM session_zero_modules
            WHERE round_id NOT IN (
                SELECT round_id FROM session_zero_modules WHERE kind <> 'poll'
            )
            ORDER BY round_id, position
        )
        """
    )
    op.execute(
        """
        UPDATE session_zero_rounds AS round SET current_module_id = (
            SELECT id FROM session_zero_modules AS module
            WHERE module.round_id = round.id AND module.kind <> 'poll'
            ORDER BY module.position LIMIT 1
        )
        WHERE current_module_id IN (SELECT id FROM session_zero_modules WHERE kind = 'poll')
        """
    )
    op.execute("DELETE FROM session_zero_modules WHERE kind = 'poll'")

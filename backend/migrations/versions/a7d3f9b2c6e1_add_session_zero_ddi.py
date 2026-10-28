"""add session zero ddi

Spec `47 - Modular Session 0.md` (47_3): the DDI module. A DDI module
shows one Document of the Room (`session_zero_modules.document_id`); each
Player accepts it once read, and a later revision of the Document makes
the acceptance out of date. Backend-only like the rest of Session 0.

Revision ID: a7d3f9b2c6e1
Revises: f3a9c1e7b5d4
Create Date: 2026-10-28 10:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7d3f9b2c6e1'
down_revision: Union[str, Sequence[str], None] = 'f3a9c1e7b5d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('session_zero_modules', sa.Column('document_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'session_zero_modules_document_id_fkey',
        'session_zero_modules',
        'documents',
        ['document_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_table('session_zero_acceptances',
    sa.Column('module_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['module_id'], ['session_zero_modules.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['room_id'], ['session_zero.room_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('module_id', 'user_id')
    )
    op.create_index(op.f('ix_session_zero_acceptances_user_id'), 'session_zero_acceptances', ['user_id'], unique=False)
    op.execute("ALTER TABLE public.session_zero_acceptances ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY backend_only_deny_clients ON public.session_zero_acceptances "
        "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
    )


def downgrade() -> None:
    """Downgrade schema. DDI modules and their acceptances go; their
    Documents stay."""
    op.drop_index(op.f('ix_session_zero_acceptances_user_id'), table_name='session_zero_acceptances')
    op.drop_table('session_zero_acceptances')
    # A round must keep a step: one made only of DDI modules gets a Lines &
    # Veils one in their place before they go.
    op.execute(
        """
        UPDATE session_zero_modules SET kind = 'lines_veils'
        WHERE kind = 'ddi' AND id IN (
            SELECT DISTINCT ON (round_id) id FROM session_zero_modules
            WHERE round_id NOT IN (
                SELECT round_id FROM session_zero_modules WHERE kind <> 'ddi'
            )
            ORDER BY round_id, position
        )
        """
    )
    op.execute(
        """
        UPDATE session_zero_rounds AS round SET current_module_id = (
            SELECT id FROM session_zero_modules AS module
            WHERE module.round_id = round.id AND module.kind <> 'ddi'
            ORDER BY module.position LIMIT 1
        )
        WHERE current_module_id IN (SELECT id FROM session_zero_modules WHERE kind = 'ddi')
        """
    )
    op.execute("DELETE FROM session_zero_modules WHERE kind = 'ddi'")
    op.drop_constraint('session_zero_modules_document_id_fkey', 'session_zero_modules', type_='foreignkey')
    op.drop_column('session_zero_modules', 'document_id')

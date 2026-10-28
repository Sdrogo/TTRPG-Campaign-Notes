"""add session zero questions

Spec `47 - Modular Session 0.md` (47_2): the Questions module. A Questions
module carries its settings on `session_zero_modules` (the Tag its
Documents get, whether the answers are revealed, whether Players create
their Documents even where the Room doesn't let them); its questions,
the Players' answers and the Documents made from them have their own
tables, backend-only like the rest of Session 0.

Revision ID: f3a9c1e7b5d4
Revises: e5c1a8f3b7d2
Create Date: 2026-10-28 01:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3a9c1e7b5d4'
down_revision: Union[str, Sequence[str], None] = 'e5c1a8f3b7d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ('session_zero_questions', 'session_zero_answers', 'session_zero_answer_documents')


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('session_zero_modules', sa.Column('tag_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'session_zero_modules_tag_id_fkey',
        'session_zero_modules',
        'tags',
        ['tag_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.add_column(
        'session_zero_modules',
        sa.Column('answers_revealed', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )
    op.add_column(
        'session_zero_modules',
        sa.Column(
            'players_bypass_creation_rule',
            sa.Boolean(),
            server_default=sa.text('true'),
            nullable=False,
        ),
    )
    op.create_table('session_zero_questions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('module_id', sa.UUID(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('body', sa.String(length=200), nullable=False),
    sa.Column('hint', sa.String(length=300), nullable=True),
    sa.Column('target', sa.String(length=20), nullable=False),
    sa.Column('tag_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint(
        "target IN ('name', 'subtitle', 'description', 'note', 'document', 'none')",
        name='ck_session_zero_questions_target',
    ),
    sa.ForeignKeyConstraint(['module_id'], ['session_zero_modules.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['room_id'], ['session_zero.room_id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tag_id'], ['tags.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_session_zero_questions_module_id'), 'session_zero_questions', ['module_id'], unique=False)
    op.create_table('session_zero_answers',
    sa.Column('question_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('note_private', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['question_id'], ['session_zero_questions.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['room_id'], ['session_zero.room_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('question_id', 'user_id')
    )
    op.create_index(op.f('ix_session_zero_answers_user_id'), 'session_zero_answers', ['user_id'], unique=False)
    op.create_table('session_zero_answer_documents',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('module_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('question_id', sa.UUID(), nullable=True),
    sa.Column('document_id', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['module_id'], ['session_zero_modules.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['question_id'], ['session_zero_questions.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['room_id'], ['session_zero.room_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_session_zero_answer_documents_document_id'), 'session_zero_answer_documents', ['document_id'], unique=False)
    op.create_index(op.f('ix_session_zero_answer_documents_module_id'), 'session_zero_answer_documents', ['module_id'], unique=False)
    op.create_index(op.f('ix_session_zero_answer_documents_user_id'), 'session_zero_answer_documents', ['user_id'], unique=False)
    op.create_index(
        'uq_session_zero_answer_documents_main',
        'session_zero_answer_documents',
        ['module_id', 'user_id'],
        unique=True,
        postgresql_where=sa.text('question_id IS NULL'),
    )
    op.create_index(
        'uq_session_zero_answer_documents_extra',
        'session_zero_answer_documents',
        ['module_id', 'user_id', 'question_id'],
        unique=True,
        postgresql_where=sa.text('question_id IS NOT NULL'),
    )
    for table in _TABLES:
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY backend_only_deny_clients ON public.{table} "
            "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
        )


def downgrade() -> None:
    """Downgrade schema. Questions modules, with their questions and
    answers, go; the Documents made from them stay."""
    op.drop_index('uq_session_zero_answer_documents_extra', table_name='session_zero_answer_documents')
    op.drop_index('uq_session_zero_answer_documents_main', table_name='session_zero_answer_documents')
    op.drop_index(op.f('ix_session_zero_answer_documents_user_id'), table_name='session_zero_answer_documents')
    op.drop_index(op.f('ix_session_zero_answer_documents_module_id'), table_name='session_zero_answer_documents')
    op.drop_index(op.f('ix_session_zero_answer_documents_document_id'), table_name='session_zero_answer_documents')
    op.drop_table('session_zero_answer_documents')
    op.drop_index(op.f('ix_session_zero_answers_user_id'), table_name='session_zero_answers')
    op.drop_table('session_zero_answers')
    op.drop_index(op.f('ix_session_zero_questions_module_id'), table_name='session_zero_questions')
    op.drop_table('session_zero_questions')
    # A round must keep a step: one made only of Questions modules gets a
    # Lines & Veils one in their place before they go.
    op.execute(
        """
        UPDATE session_zero_modules SET kind = 'lines_veils'
        WHERE kind = 'questions' AND id IN (
            SELECT DISTINCT ON (round_id) id FROM session_zero_modules
            WHERE round_id NOT IN (
                SELECT round_id FROM session_zero_modules WHERE kind <> 'questions'
            )
            ORDER BY round_id, position
        )
        """
    )
    op.execute(
        """
        UPDATE session_zero_rounds AS round SET current_module_id = (
            SELECT id FROM session_zero_modules AS module
            WHERE module.round_id = round.id AND module.kind <> 'questions'
            ORDER BY module.position LIMIT 1
        )
        WHERE current_module_id IN (SELECT id FROM session_zero_modules WHERE kind = 'questions')
        """
    )
    op.execute("DELETE FROM session_zero_modules WHERE kind = 'questions'")
    op.drop_column('session_zero_modules', 'players_bypass_creation_rule')
    op.drop_column('session_zero_modules', 'answers_revealed')
    op.drop_constraint('session_zero_modules_tag_id_fkey', 'session_zero_modules', type_='foreignkey')
    op.drop_column('session_zero_modules', 'tag_id')

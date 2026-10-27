"""add session zero positions

Spec `46d - Session 0 header and layout.md` Decision 7: post-its and groups
are put in order by drag and drop. `position` on `session_zero_groups` and
`session_zero_cards`: in a column, the post-its in no group and the groups
share one order; the post-its of a group have their own. Filled from today's
order, oldest first, a group standing where its oldest post-it does (as the
client drew it until now).

Revision ID: d4a7e2c9f1b3
Revises: c3f8a1d6e9b4
Create Date: 2026-10-27 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4a7e2c9f1b3'
down_revision: Union[str, Sequence[str], None] = 'c3f8a1d6e9b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'session_zero_cards',
        sa.Column('position', sa.Integer(), server_default=sa.text('0'), nullable=False),
    )
    op.add_column(
        'session_zero_groups',
        sa.Column('position', sa.Integer(), server_default=sa.text('0'), nullable=False),
    )
    # A group's post-its, oldest first.
    op.execute(
        """
        UPDATE session_zero_cards AS card SET position = ordered.position
        FROM (
            SELECT id, row_number() OVER (
                PARTITION BY group_id ORDER BY created_at, id
            ) - 1 AS position
            FROM session_zero_cards WHERE group_id IS NOT NULL
        ) AS ordered
        WHERE card.id = ordered.id
        """
    )
    # Each column's post-its in no group and its groups, a group at its
    # oldest post-it's place.
    op.execute(
        """
        WITH items AS (
            SELECT 'card' AS kind, id, column_id, created_at AS sort_at
            FROM session_zero_cards WHERE group_id IS NULL
            UNION ALL
            SELECT 'group', grp.id, grp.column_id,
                coalesce(min(card.created_at), grp.created_at)
            FROM session_zero_groups AS grp
            LEFT JOIN session_zero_cards AS card ON card.group_id = grp.id
            GROUP BY grp.id
        ), ordered AS (
            SELECT kind, id, row_number() OVER (
                PARTITION BY column_id ORDER BY sort_at, id
            ) - 1 AS position
            FROM items
        ), cards AS (
            UPDATE session_zero_cards AS card SET position = ordered.position
            FROM ordered WHERE ordered.kind = 'card' AND card.id = ordered.id
        )
        UPDATE session_zero_groups AS grp SET position = ordered.position
        FROM ordered WHERE ordered.kind = 'group' AND grp.id = ordered.id
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('session_zero_groups', 'position')
    op.drop_column('session_zero_cards', 'position')

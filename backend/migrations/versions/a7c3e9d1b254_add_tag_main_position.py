"""add tag main_position

Spec `11 - Add Room Menagment Page.md`: a Room's Administrators choose which
Tags are its Main Tags and in what order they group the Documents list, so
"Main Tag" stops being "category 'Type'" and becomes `tags.main_position`
(NULL = not a Main Tag, otherwise the ascending order). Existing Rooms keep
what they see today: every Tag with category 'Type' becomes a Main Tag,
ordered by name within its Room, which is how the list was sorted.

Revision ID: a7c3e9d1b254
Revises: f3b8e2a71c94
Create Date: 2026-09-30 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a7c3e9d1b254'
down_revision: Union[str, Sequence[str], None] = 'f3b8e2a71c94'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('tags', sa.Column('main_position', sa.Integer(), nullable=True))
    op.execute(
        """
        UPDATE tags SET main_position = ranked.position
        FROM (
            SELECT id, (row_number() OVER (
                PARTITION BY room_id ORDER BY lower(name), id
            ) - 1) AS position
            FROM tags WHERE category = 'Type'
        ) AS ranked
        WHERE tags.id = ranked.id
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('tags', 'main_position')

"""add user profile fields

Revision ID: 7a4d2c9e1b58
Revises: 5c1f7e2a9b30
Create Date: 2026-09-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7a4d2c9e1b58'
down_revision: Union[str, Sequence[str], None] = '5c1f7e2a9b30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('display_name', sa.String(length=60), nullable=True))
    op.add_column('users', sa.Column('pronouns', sa.String(length=40), nullable=True))
    op.add_column('users', sa.Column('bio', sa.Text(), nullable=True))
    op.add_column('users', sa.Column('avatar_path', sa.String(length=500), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'avatar_path')
    op.drop_column('users', 'bio')
    op.drop_column('users', 'pronouns')
    op.drop_column('users', 'display_name')

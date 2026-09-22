"""add profile prefilled at

Revision ID: b2e6f1a8c4d9
Revises: 7a4d2c9e1b58
Create Date: 2026-09-22 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2e6f1a8c4d9'
down_revision: Union[str, Sequence[str], None] = '7a4d2c9e1b58'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('profile_prefilled_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'profile_prefilled_at')

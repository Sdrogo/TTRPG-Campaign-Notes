"""add storage cleanup

Revision ID: 5c1f7e2a9b30
Revises: 9e29c43313a1
Create Date: 2026-09-22 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5c1f7e2a9b30'
down_revision: Union[str, Sequence[str], None] = '9e29c43313a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'storage_cleanup',
        sa.Column('storage_path', sa.String(length=500), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('storage_path'),
    )
    op.create_index(op.f('ix_storage_cleanup_created_at'), 'storage_cleanup', ['created_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_storage_cleanup_created_at'), table_name='storage_cleanup')
    op.drop_table('storage_cleanup')

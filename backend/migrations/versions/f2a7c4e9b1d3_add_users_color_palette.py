"""add users.color_palette

Ticket `78 - Color-blind palettes.md`: the map palette a user sees,
chosen on the Account page. Null is the standard palette; otherwise
'protan', 'deutan' or 'tritan'. Stored map colors are names, so nothing
else changes.

Revision ID: f2a7c4e9b1d3
Revises: c6f1a9d3e7b2
Create Date: 2026-11-27 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2a7c4e9b1d3"
down_revision: Union[str, Sequence[str], None] = "c6f1a9d3e7b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("users", sa.Column("color_palette", sa.String(length=10), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "color_palette")

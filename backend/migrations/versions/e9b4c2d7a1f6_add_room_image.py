"""add room image

Spec `26 - Room image.md`: a Room can have an image, the default cover of
its PDF. `rooms.image_path` holds its private Storage path, like
`users.avatar_path`; null without one.

Revision ID: e9b4c2d7a1f6
Revises: c7d3e9a1f5b2
Create Date: 2026-10-07 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e9b4c2d7a1f6"
down_revision: Union[str, Sequence[str], None] = "c7d3e9a1f5b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("rooms", sa.Column("image_path", sa.String(length=500), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("rooms", "image_path")

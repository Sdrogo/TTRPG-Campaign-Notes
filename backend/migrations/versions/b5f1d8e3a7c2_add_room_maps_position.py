"""add room maps_position

The Room page shows a row with the Room's maps (Andrea, 2026-10-25); an
Administrator places it among the Main items the Documents page groups by,
in the Room setup's Grouping list. The column counts the Main items shown
before the row: 0, above them all, for every existing Room (where it was
first shown).

Revision ID: b5f1d8e3a7c2
Revises: e2b7c4f9a1d6
Create Date: 2026-10-25 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5f1d8e3a7c2"
down_revision: str | Sequence[str] | None = "e2b7c4f9a1d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "rooms",
        sa.Column("maps_position", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("rooms", "maps_position")

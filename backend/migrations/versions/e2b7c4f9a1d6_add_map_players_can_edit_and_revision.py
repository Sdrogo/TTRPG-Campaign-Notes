"""add map players_can_edit and revision

Spec `42 - Maps editable by players.md` (unit 42_1): a map can be unlocked so
every member who sees it edits its board (Decision 1, off for every existing
map), and every map counts its writes so a board save based on an old state
is refused instead of overwriting someone else's (Decision 7).

Revision ID: e2b7c4f9a1d6
Revises: a4d9e2c7f1b6
Create Date: 2026-10-24 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e2b7c4f9a1d6"
down_revision: str | Sequence[str] | None = "a4d9e2c7f1b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "relationship_maps",
        sa.Column("players_can_edit", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "relationship_maps",
        sa.Column("revision", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("relationship_maps", "revision")
    op.drop_column("relationship_maps", "players_can_edit")

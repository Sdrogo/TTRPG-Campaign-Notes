"""add poll option description

Spec `54 - Poll choices as cards.md` Decision 11: a poll's choice takes an
optional description (Markdown with mentions, up to 2000 characters,
checked by the domain).

Revision ID: c8f2d6a4e1b7
Revises: b9e4c2a7d1f3
Create Date: 2026-10-30 14:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c8f2d6a4e1b7"
down_revision: Union[str, Sequence[str], None] = "b9e4c2a7d1f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("session_zero_poll_options", sa.Column("description", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("session_zero_poll_options", "description")

"""add note relational link

Spec `41 - Relational link Notes.md` (unit 41_1): a Note can be flagged as a
Relational link, and only the mentions written in flagged Notes draw
relations on a mention map (spec 36). Every existing Note starts unflagged
(Decision 2).

Revision ID: a4d9e2c7f1b6
Revises: d7c1f5a9e3b8
Create Date: 2026-10-21 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a4d9e2c7f1b6"
down_revision: str | Sequence[str] | None = "d7c1f5a9e3b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "document_notes",
        sa.Column("relational_link", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("document_notes", "relational_link")

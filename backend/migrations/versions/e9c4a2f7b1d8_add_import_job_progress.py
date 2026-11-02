"""add import job progress

Spec `59 - Large imports in image blocks.md`: an import's image phase
keeps its work list and how far it got in `progress`, and `updated_at`
says when it last saved, so a job is taken as lost only when it stops
progressing and a restart can resume its images.

Revision ID: e9c4a2f7b1d8
Revises: e8c4a2f6b1d9
Create Date: 2026-11-02 15:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "e9c4a2f7b1d8"
down_revision: Union[str, Sequence[str], None] = "e8c4a2f6b1d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "import_jobs", sa.Column("progress", postgresql.JSONB(astext_type=sa.Text()), nullable=True)
    )
    op.add_column(
        "import_jobs",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("import_jobs", "updated_at")
    op.drop_column("import_jobs", "progress")

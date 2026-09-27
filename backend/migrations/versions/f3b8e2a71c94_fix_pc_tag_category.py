"""fix pc tag category

A Room created before spec 10 could already have its own "PC" Tag (e.g.
created manually to mark player characters), with no category. The
previous migration (`d8a2f5c1b976`) skips a Room that already has a Tag
named "PC" - it only backfills a *missing* one - so it never touched
these, and without category "Type" that pre-existing Tag isn't
recognized as a Main Tag (`frontend/src/lib/tags.ts::MAIN_TAG_CATEGORY`),
so Documents tagged with it don't group under "#PC" (confirmed live: a
Room named "Bassifondi Scarlatti" had exactly this - its NPC/Place/
Event/Artifact Tags all had category "Type", only "PC" didn't).

Sets category to "Type" on every Tag literally named "PC", regardless of
Room or current category, since "PC" is meant to behave as a Main Tag
everywhere per spec 10.

Revision ID: f3b8e2a71c94
Revises: d8a2f5c1b976
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f3b8e2a71c94'
down_revision: Union[str, Sequence[str], None] = 'd8a2f5c1b976'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        """
        UPDATE tags SET category = 'Type'
        WHERE name = 'PC' AND category IS DISTINCT FROM 'Type'
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Data-only fix: a Tag's previous category (if any) wasn't recorded
    # anywhere, so there is nothing safe to restore.
    pass

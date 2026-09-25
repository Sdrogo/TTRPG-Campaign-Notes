"""backfill pc tag

Spec `10 - UX Refinment.md` adds "PC" (Playing Character) to the Room's Main
Tags. `DEFAULT_TAGS` (app/domain/rooms.py) now seeds it into every *new*
Room, but a Room's default Tags are only created at Room-creation time (see
architecture.md), so this backfills a "PC" Tag (category "Type") into every
existing Room that doesn't already have one with that name.

Revision ID: d8a2f5c1b976
Revises: a4f7b2c8e015
Create Date: 2026-09-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd8a2f5c1b976'
down_revision: Union[str, Sequence[str], None] = 'a4f7b2c8e015'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        """
        INSERT INTO tags (id, room_id, name, category)
        SELECT gen_random_uuid(), r.id, 'PC', 'Type'
        FROM rooms r
        WHERE NOT EXISTS (
            SELECT 1 FROM tags t WHERE t.room_id = r.id AND t.name = 'PC'
        )
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Data-only backfill: a backfilled "PC" Tag is indistinguishable from one
    # a Room's Master created themselves, so there is nothing safe to undo.
    pass

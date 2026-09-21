"""backfill users mirror emails

Members who created or joined a Room before the `users` mirror existed
(migration 1ef429c1f702) never got a row, so the members list returned
`email = null` for them and the UI fell back to the raw user id. This copies
their email from Supabase Auth once. New members get a row as before, through
the opportunistic upsert in app/db/users_repo.py.

Revision ID: d3e8a1f4c2b7
Revises: ba03b9ea5f44
Create Date: 2026-09-21 23:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd3e8a1f4c2b7'
down_revision: Union[str, Sequence[str], None] = 'ba03b9ea5f44'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        """
        INSERT INTO users (id, email)
        SELECT a.id, a.email
        FROM auth.users a
        WHERE a.id IN (SELECT user_id FROM memberships)
        ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email
        WHERE users.email IS NULL
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Data-only backfill: the rows are indistinguishable from ones written by
    # the normal upsert, so there is nothing safe to undo.
    pass

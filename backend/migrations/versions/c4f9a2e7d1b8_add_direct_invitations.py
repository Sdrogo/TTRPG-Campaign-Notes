"""add direct invitations

Spec `18 - Friends.md` (D-26, FR-F5), unit 18_1b: an invitation can be
addressed to one user, a Friend of the Administrator who sent it. Only that
user may accept it, and it is listed for them. NULL keeps today's shareable
links. Only a column and its index are added, so RLS is unchanged.

Revision ID: c4f9a2e7d1b8
Revises: b7e1d4f8a2c6
Create Date: 2026-10-02 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4f9a2e7d1b8"
down_revision: Union[str, Sequence[str], None] = "b7e1d4f8a2c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("invitations", sa.Column("invitee_user_id", sa.UUID(), nullable=True))
    op.create_index(
        op.f("ix_invitations_invitee_user_id"), "invitations", ["invitee_user_id"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_invitations_invitee_user_id"), table_name="invitations")
    op.drop_column("invitations", "invitee_user_id")

"""add arrow bend

Spec `67 - Adjustable relationship arc.md`: a free map's arrow may carry its
own bend (how far its curve's middle leaves the straight line, in board
pixels, positive to the right of the arrow's way), as a geographic link does.
Null keeps the automatic curve of spec 62, so no existing arrow changes.

Revision ID: d4a8f2c6b9e1
Revises: c1d7e3a9f5b2
Create Date: 2026-11-09 12:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d4a8f2c6b9e1"
down_revision: Union[str, Sequence[str], None] = "c1d7e3a9f5b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("relationship_map_arrows", sa.Column("bend", sa.Float(), nullable=True))
    op.create_check_constraint(
        "ck_relationship_map_arrows_bend",
        "relationship_map_arrows",
        "bend IS NULL OR (bend >= -5000 AND bend <= 5000)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_relationship_map_arrows_bend", "relationship_map_arrows", type_="check")
    op.drop_column("relationship_map_arrows", "bend")

"""add map label positions

Spec `28 - Relationship maps.md`: the editor can drag a relationship's label
along the relation. `label_position` and `reverse_label_position` hold where
each label sits, as a fraction of the way from the relation's `from` end (0) to
its `to` end (1); null keeps the board's automatic placement, so every existing
relation is unchanged. Each position needs its label.

Revision ID: a9e3c5d7b1f4
Revises: d5a1c8e3f2b7
Create Date: 2026-10-13 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a9e3c5d7b1f4"
down_revision: Union[str, Sequence[str], None] = "d5a1c8e3f2b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("relationship_map_arrows", sa.Column("label_position", sa.Float(), nullable=True))
    op.add_column(
        "relationship_map_arrows", sa.Column("reverse_label_position", sa.Float(), nullable=True)
    )
    op.create_check_constraint(
        "ck_relationship_map_arrows_label_position",
        "relationship_map_arrows",
        "label_position IS NULL"
        " OR (label IS NOT NULL AND label_position >= 0 AND label_position <= 1)",
    )
    op.create_check_constraint(
        "ck_relationship_map_arrows_reverse_label_position",
        "relationship_map_arrows",
        "reverse_label_position IS NULL"
        " OR (reverse_label IS NOT NULL AND reverse_label_position >= 0"
        " AND reverse_label_position <= 1)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_relationship_map_arrows_reverse_label_position",
        "relationship_map_arrows",
        type_="check",
    )
    op.drop_constraint(
        "ck_relationship_map_arrows_label_position", "relationship_map_arrows", type_="check"
    )
    op.drop_column("relationship_map_arrows", "reverse_label_position")
    op.drop_column("relationship_map_arrows", "label_position")

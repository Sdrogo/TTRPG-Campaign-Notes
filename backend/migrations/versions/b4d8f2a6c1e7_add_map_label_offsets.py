"""add map label offsets

Spec `28 - Relationship maps.md`: a dragged label can also sit to the side of
its relation. `label_offset` and `reverse_label_offset` hold how far, in board
pixels, each label sits from the relation (negative to the other side); null
leaves the label on the relation, so every existing relation is unchanged. An
offset needs its label's position.

Revision ID: b4d8f2a6c1e7
Revises: a9e3c5d7b1f4
Create Date: 2026-10-13 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b4d8f2a6c1e7"
down_revision: Union[str, Sequence[str], None] = "a9e3c5d7b1f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("relationship_map_arrows", sa.Column("label_offset", sa.Float(), nullable=True))
    op.add_column(
        "relationship_map_arrows", sa.Column("reverse_label_offset", sa.Float(), nullable=True)
    )
    op.create_check_constraint(
        "ck_relationship_map_arrows_label_offset",
        "relationship_map_arrows",
        "label_offset IS NULL"
        " OR (label_position IS NOT NULL AND label_offset >= -2000 AND label_offset <= 2000)",
    )
    op.create_check_constraint(
        "ck_relationship_map_arrows_reverse_label_offset",
        "relationship_map_arrows",
        "reverse_label_offset IS NULL"
        " OR (reverse_label_position IS NOT NULL AND reverse_label_offset >= -2000"
        " AND reverse_label_offset <= 2000)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_relationship_map_arrows_reverse_label_offset",
        "relationship_map_arrows",
        type_="check",
    )
    op.drop_constraint(
        "ck_relationship_map_arrows_label_offset", "relationship_map_arrows", type_="check"
    )
    op.drop_column("relationship_map_arrows", "reverse_label_offset")
    op.drop_column("relationship_map_arrows", "label_offset")

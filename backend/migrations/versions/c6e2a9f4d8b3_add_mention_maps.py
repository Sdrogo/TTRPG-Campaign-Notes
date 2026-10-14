"""add mention maps

Spec `36 - Mention map.md`: a Document can have one live mention map, a
`relationship_maps` row tied to it. `source_document_id` names the Document
(unique: one map per Document, deleted with it) and `mention_depth` how many
steps past the first level the map follows mentions (0 to 3). Both are null
on every existing map, so nothing existing changes.

Revision ID: c6e2a9f4d8b3
Revises: b4d8f2a6c1e7
Create Date: 2026-10-14 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c6e2a9f4d8b3"
down_revision: Union[str, Sequence[str], None] = "b4d8f2a6c1e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "relationship_maps",
        sa.Column("source_document_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column("relationship_maps", sa.Column("mention_depth", sa.SmallInteger(), nullable=True))
    op.create_foreign_key(
        "fk_relationship_maps_source_document",
        "relationship_maps",
        "documents",
        ["source_document_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint(
        "uq_relationship_maps_source_document", "relationship_maps", ["source_document_id"]
    )
    op.create_check_constraint(
        "ck_relationship_maps_mention_depth",
        "relationship_maps",
        "(source_document_id IS NULL AND mention_depth IS NULL)"
        " OR (source_document_id IS NOT NULL AND mention_depth >= 0 AND mention_depth <= 3)",
    )


def downgrade() -> None:
    op.execute("DELETE FROM relationship_maps WHERE source_document_id IS NOT NULL")
    op.drop_constraint("ck_relationship_maps_mention_depth", "relationship_maps", type_="check")
    op.drop_constraint(
        "uq_relationship_maps_source_document", "relationship_maps", type_="unique"
    )
    op.drop_constraint(
        "fk_relationship_maps_source_document", "relationship_maps", type_="foreignkey"
    )
    op.drop_column("relationship_maps", "mention_depth")
    op.drop_column("relationship_maps", "source_document_id")

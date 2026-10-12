"""add relationship map card image

Spec `28 - Relationship maps.md` follow-up: a Document card on a map can show
one of its Document's images instead of the favorite
(`relationship_map_cards.image_id`, NULL = the Document's lead image). The
choice is on the map only; deleting the image sets it back to NULL. No table
is created, so RLS is unchanged.

Revision ID: d5a1c8e3f2b7
Revises: b3f7d1e9c5a2
Create Date: 2026-10-12 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5a1c8e3f2b7"
down_revision: str | Sequence[str] | None = "b3f7d1e9c5a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("relationship_map_cards", sa.Column("image_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "relationship_map_cards_image_id_fkey",
        "relationship_map_cards",
        "document_images",
        ["image_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "relationship_map_cards_image_id_fkey", "relationship_map_cards", type_="foreignkey"
    )
    op.drop_column("relationship_map_cards", "image_id")

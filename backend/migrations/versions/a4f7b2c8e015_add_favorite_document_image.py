"""add favorite document image

Revision ID: a4f7b2c8e015
Revises: f1c8a2e6d493
Create Date: 2026-09-23 10:12:41.552103

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a4f7b2c8e015'
down_revision: Union[str, Sequence[str], None] = 'f1c8a2e6d493'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Spec 07: the one image an Owner picked to lead the Document. No new
    # table, so no RLS statements here - `document_images` is already
    # backend-only (migrations c9d4e7b1f352 and f1c8a2e6d493).
    op.add_column(
        'document_images',
        sa.Column('is_favorite', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )

    # "Only one can be the favorite" is enforced by the database, not just by
    # the route: two concurrent PUTs would otherwise both leave their flag set.
    op.create_index(
        'uq_document_images_one_favorite',
        'document_images',
        ['document_id'],
        unique=True,
        postgresql_where=sa.text('is_favorite'),
    )

    # Existing Documents get the same default as new ones - the first image
    # uploaded leads - so no Document with images is left without a favorite.
    op.execute(
        """
        UPDATE document_images SET is_favorite = true
        WHERE id IN (
            SELECT DISTINCT ON (document_id) id
            FROM document_images
            ORDER BY document_id, created_at, id
        )
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('uq_document_images_one_favorite', table_name='document_images')
    op.drop_column('document_images', 'is_favorite')

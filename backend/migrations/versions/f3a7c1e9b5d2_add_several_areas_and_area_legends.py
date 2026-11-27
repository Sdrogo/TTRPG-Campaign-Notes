"""several areas per Document and area color legends

Spec `77 - Several areas for one Document.md`: a Document may have several
areas on a geographic map, so `relationship_map_areas` loses its unique
`(map_id, document_id)`; `relationship_maps.area_labels` says where a
Document's name goes when it has several areas (`every`, the default when
null, or `largest`). Spec `77b - Area color legend.md`: a legend preset has a
`kind` (`relations`, every existing one, or `areas`) and its name is unique
per Room and kind. Additive for existing data.

Revision ID: f3a7c1e9b5d2
Revises: f2a7c4e9b1d3
Create Date: 2026-11-27 15:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f3a7c1e9b5d2"
down_revision: Union[str, Sequence[str], None] = "f2a7c4e9b1d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint(
        "uq_relationship_map_areas_document", "relationship_map_areas", type_="unique"
    )
    op.add_column("relationship_maps", sa.Column("area_labels", sa.String(length=8), nullable=True))
    op.create_check_constraint(
        "ck_relationship_maps_area_labels",
        "relationship_maps",
        "area_labels IS NULL OR area_labels IN ('every', 'largest')",
    )
    op.add_column(
        "relationship_map_legend_presets",
        sa.Column("kind", sa.String(length=10), nullable=False, server_default="relations"),
    )
    op.create_check_constraint(
        "ck_relationship_map_legend_presets_kind",
        "relationship_map_legend_presets",
        "kind IN ('relations', 'areas')",
    )
    op.drop_constraint(
        "uq_relationship_map_legend_presets_name", "relationship_map_legend_presets", type_="unique"
    )
    op.create_unique_constraint(
        "uq_relationship_map_legend_presets_name",
        "relationship_map_legend_presets",
        ["room_id", "kind", "name"],
    )


def downgrade() -> None:
    # Refuse rather than delete: a downgrade never drops a user's areas or presets.
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM relationship_map_areas WHERE document_id IS NOT NULL
            GROUP BY map_id, document_id HAVING count(*) > 1
          ) THEN
            RAISE EXCEPTION 'a map has a Document on several areas: remove the extra areas first';
          END IF;
          IF EXISTS (
            SELECT 1 FROM relationship_map_legend_presets
            GROUP BY room_id, name HAVING count(*) > 1
          ) THEN
            RAISE EXCEPTION 'a Room has a relation preset and an area preset with the same name: rename one first';
          END IF;
        END $$;
        """
    )
    op.drop_constraint(
        "uq_relationship_map_legend_presets_name", "relationship_map_legend_presets", type_="unique"
    )
    op.create_unique_constraint(
        "uq_relationship_map_legend_presets_name",
        "relationship_map_legend_presets",
        ["room_id", "name"],
    )
    op.drop_constraint(
        "ck_relationship_map_legend_presets_kind", "relationship_map_legend_presets", type_="check"
    )
    op.drop_column("relationship_map_legend_presets", "kind")
    op.drop_constraint("ck_relationship_maps_area_labels", "relationship_maps", type_="check")
    op.drop_column("relationship_maps", "area_labels")
    op.create_unique_constraint(
        "uq_relationship_map_areas_document", "relationship_map_areas", ["map_id", "document_id"]
    )

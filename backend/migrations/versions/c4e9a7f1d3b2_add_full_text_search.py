"""add full-text search

Spec `21 - Full-text search.md`, unit 21_1:

- The `unaccent` extension, in Supabase's `extensions` schema, and a text
  search configuration `public.search_simple_unaccent`: `simple` (lower case,
  no stemming, no stop words) behind `unaccent`, one for every language since
  a Room mixes Italian and English. "citta" finds "Città".
- A generated, stored `search_vector` with a GIN index on `documents` (name
  weighted above description), `document_notes` (title above text), `posts`
  (body; NULL once the Comment is deleted) and `tags` (name). Mention tokens
  are indexed by their names, not their syntax.

No table is created, so RLS is unchanged. Existing rows get their vectors when
the columns are added (Postgres computes generated columns on ALTER).

Revision ID: c4e9a7f1d3b2
Revises: b8d2f6a4c9e1
Create Date: 2026-10-05 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c4e9a7f1d3b2"
down_revision: Union[str, Sequence[str], None] = "b8d2f6a4c9e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONFIG = "public.search_simple_unaccent"

# A mention token (`#[Name](doc:<uuid>)`, `@[Name](user:<uuid>)`), replaced by
# its name. Frozen here; app/db/models.py holds the same expression.
_TOKEN = r"'[@#]\[((?:[^]\\]|\\.)*)\]\((user|doc|tag):[0-9a-fA-F-]{36}\)'"


def _vector(column: str, weight: str | None = None) -> str:
    """The `tsvector` of `column`, mention tokens read as their names."""
    vector = f"to_tsvector('{CONFIG}'::regconfig, regexp_replace({column}, {_TOKEN}, '\\1', 'g'))"
    return vector if weight is None else f"setweight({vector}, '{weight}')"


_VECTORS = {
    "documents": f"{_vector('name', 'A')} || {_vector('description', 'B')}",
    "document_notes": f"{_vector('title', 'A')} || {_vector('description', 'B')}",
    "posts": f"CASE WHEN deleted_at IS NULL THEN {_vector('body')} END",
    "tags": _vector("name"),
}


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("CREATE SCHEMA IF NOT EXISTS extensions")
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions")
    op.execute(f"CREATE TEXT SEARCH CONFIGURATION {CONFIG} (COPY = pg_catalog.simple)")
    op.execute(
        f"ALTER TEXT SEARCH CONFIGURATION {CONFIG} "
        "ALTER MAPPING FOR word, hword, hword_part, numword, numhword "
        "WITH extensions.unaccent, pg_catalog.simple"
    )
    for table, expression in _VECTORS.items():
        op.add_column(
            table,
            sa.Column(
                "search_vector",
                postgresql.TSVECTOR(),
                sa.Computed(expression, persisted=True),
                nullable=True,
            ),
        )
        op.create_index(
            f"ix_{table}_search_vector",
            table,
            ["search_vector"],
            unique=False,
            postgresql_using="gin",
        )


def downgrade() -> None:
    """Downgrade schema."""
    for table in _VECTORS:
        op.drop_index(f"ix_{table}_search_vector", table_name=table, postgresql_using="gin")
        op.drop_column(table, "search_vector")
    op.execute(f"DROP TEXT SEARCH CONFIGURATION {CONFIG}")
    op.execute("DROP EXTENSION IF EXISTS unaccent")

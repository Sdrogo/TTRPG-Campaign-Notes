"""add document subtitle

Spec `28 - Relationship maps.md`, unit 28_0: a Document gets an optional
one-line subtitle under its name (`documents.subtitle`, at most 120
characters, NULL when unset). The version history records it with the name
(`document_versions.subtitle`), and full-text search matches it with the
name's weight (A): the generated `documents.search_vector` is dropped and
added again with the subtitle, which rewrites `documents` under an ACCESS
EXCLUSIVE lock and recomputes every row's vector (quick at this size).

No table is created, so RLS is unchanged.

Revision ID: a8c4e2f6b1d3
Revises: f7a2d8c4e1b9
Create Date: 2026-10-12 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a8c4e2f6b1d3"
down_revision: Union[str, Sequence[str], None] = "f7a2d8c4e1b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONFIG = "public.search_simple_unaccent"

# A mention token, replaced by its name. Frozen here, as in c4e9a7f1d3b2;
# app/db/models.py holds the same expression.
_TOKEN = r"'[@#]\[((?:[^]\\]|\\.)*)\]\((user|doc|tag):[0-9a-fA-F-]{36}\)'"


def _vector(column: str, weight: str) -> str:
    """The weighted `tsvector` of `column`, mention tokens read as names."""
    return (
        f"setweight(to_tsvector('{CONFIG}'::regconfig, "
        f"regexp_replace({column}, {_TOKEN}, '\\1', 'g')), '{weight}')"
    )


_WITHOUT_SUBTITLE = f"{_vector('name', 'A')} || {_vector('description', 'B')}"
# NULL when unset, which would make the whole `||` NULL.
_SUBTITLE = "coalesce(subtitle, '')"
_WITH_SUBTITLE = (
    f"{_vector('name', 'A')} || {_vector(_SUBTITLE, 'A')} || {_vector('description', 'B')}"
)


def _set_vector(expression: str) -> None:
    """Replaces `documents.search_vector` and its GIN index."""
    op.drop_index("ix_documents_search_vector", table_name="documents", postgresql_using="gin")
    op.drop_column("documents", "search_vector")
    op.add_column(
        "documents",
        sa.Column(
            "search_vector",
            postgresql.TSVECTOR(),
            sa.Computed(expression, persisted=True),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_documents_search_vector",
        "documents",
        ["search_vector"],
        unique=False,
        postgresql_using="gin",
    )


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("documents", sa.Column("subtitle", sa.String(length=120), nullable=True))
    op.add_column(
        "document_versions", sa.Column("subtitle", sa.String(length=120), nullable=True)
    )
    _set_vector(_WITH_SUBTITLE)


def downgrade() -> None:
    """Downgrade schema."""
    _set_vector(_WITHOUT_SUBTITLE)
    op.drop_column("document_versions", "subtitle")
    op.drop_column("documents", "subtitle")

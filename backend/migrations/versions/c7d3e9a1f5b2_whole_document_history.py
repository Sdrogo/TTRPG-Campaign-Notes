"""whole-document history

Spec `24b - Whole-Document history.md` (FR-D5): a Document's history covers
its Notes, so `document_versions` gains `notes` (JSONB, the Notes in display
order: `{id, title, description, visibility, selective_user_ids}`) and
`note_versions` is folded into it and dropped. For each Document, every
`document_versions` and `note_versions` row is replayed in time order on a
running state, one revision per row whose text changes something. Notes get
their current position and visibility (neither was recorded before). A Note
is in the state from its `created_at` on, with its oldest known text: the
first migration dated a Note's first version at its last update, so without
this a revision from before that date would leave out a Note that existed
then, and restoring it would delete the Note. The
downgrade is lossy: it recreates `note_versions` with each Note's current
text, as the first migration did.

Revision ID: c7d3e9a1f5b2
Revises: a2e6c9f4b8d1
Create Date: 2026-10-06 00:00:00.000000

"""

import json
import uuid
from collections import defaultdict
from typing import Any, Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "c7d3e9a1f5b2"
down_revision: Union[str, Sequence[str], None] = "a2e6c9f4b8d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _replay(
    document: Any,
    document_rows: list[Any],
    note_rows: list[Any],
    notes: dict[uuid.UUID, Any],
    order: list[uuid.UUID],
    grants: dict[uuid.UUID, list[str]],
) -> list[dict[str, Any]]:
    """The revisions of one Document, oldest first."""
    first_rows: dict[uuid.UUID, Any] = {}
    for row in sorted(note_rows, key=lambda row: (row.created_at, str(row.id))):
        first_rows.setdefault(row.note_id, row)
    # A Note's oldest known text, from its creation (kind -1: it changes the
    # state, but the revision it shows up in is the next row's).
    seeds = []
    for note_id, note in notes.items():
        first_row = first_rows.get(note_id)
        if first_row is None or note.created_at < first_row.created_at:
            text = note if first_row is None else first_row
            seeds.append((note.created_at, -1, text, note_id))
    events = sorted(
        [(seed[0], seed[1], seed[2], seed[3]) for seed in seeds]
        + [(row.created_at, 0, row, None) for row in document_rows]
        + [(row.created_at, 1, row, row.note_id) for row in note_rows],
        key=lambda event: (event[0], event[1], str(event[2].id)),
    )
    first = min(document_rows, key=lambda row: row.created_at, default=None)
    name = document.name if first is None else first.name
    description = document.description if first is None else first.description
    texts: dict[uuid.UUID, tuple[str, str]] = {}
    revisions: list[dict[str, Any]] = []
    previous: Any = None
    for _, kind, row, note_id in events:
        if kind == 0:
            name, description = row.name, row.description
        else:
            texts[note_id] = (row.title, row.description)
        if kind == -1:
            continue
        state = (
            name,
            description,
            [(note_id, *texts[note_id]) for note_id in order if note_id in texts],
        )
        if state == previous:
            continue
        previous = state
        revisions.append(
            {
                "id": uuid.uuid4(),
                "document_id": document.id,
                "name": name,
                "description": description,
                "notes": json.dumps(
                    [
                        {
                            "id": str(note_id),
                            "title": title,
                            "description": text,
                            "visibility": notes[note_id].visibility,
                            "selective_user_ids": sorted(grants.get(note_id, [])),
                        }
                        for note_id, title, text in state[2]
                    ]
                ),
                "edited_by": row.edited_by,
                "created_at": row.created_at,
                "updated_at": row.updated_at,
            }
        )
    return revisions


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "document_versions",
        sa.Column("notes", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    bind = op.get_bind()
    documents = bind.execute(sa.text("SELECT id, name, description FROM documents")).all()
    notes_by_document: dict[uuid.UUID, list[Any]] = defaultdict(list)
    for note in bind.execute(
        sa.text(
            "SELECT id, document_id, title, description, visibility, created_at "
            "FROM document_notes "
            "ORDER BY position, created_at, id"
        )
    ).all():
        notes_by_document[note.document_id].append(note)
    grants: dict[uuid.UUID, list[str]] = defaultdict(list)
    for grant in bind.execute(
        sa.text("SELECT note_id, user_id FROM document_note_visibility_grants")
    ).all():
        grants[grant.note_id].append(str(grant.user_id))
    document_rows: dict[uuid.UUID, list[Any]] = defaultdict(list)
    for row in bind.execute(sa.text("SELECT * FROM document_versions")).all():
        document_rows[row.document_id].append(row)
    note_rows: dict[uuid.UUID, list[Any]] = defaultdict(list)
    for row in bind.execute(
        sa.text(
            "SELECT v.*, n.document_id FROM note_versions v "
            "JOIN document_notes n ON n.id = v.note_id"
        )
    ).all():
        note_rows[row.document_id].append(row)

    revisions: list[dict[str, Any]] = []
    for document in documents:
        notes = notes_by_document[document.id]
        revisions.extend(
            _replay(
                document,
                document_rows[document.id],
                note_rows[document.id],
                {note.id: note for note in notes},
                [note.id for note in notes],
                grants,
            )
        )

    op.execute("DELETE FROM document_versions")
    if revisions:
        bind.execute(
            sa.text(
                "INSERT INTO document_versions "
                "(id, document_id, name, description, notes, edited_by, created_at, updated_at) "
                "VALUES (:id, :document_id, :name, :description, CAST(:notes AS jsonb), "
                ":edited_by, :created_at, :updated_at)"
            ),
            revisions,
        )

    op.drop_index(op.f("ix_note_versions_note_id"), table_name="note_versions")
    op.drop_table("note_versions")


def downgrade() -> None:
    """Downgrade schema."""
    op.create_table(
        "note_versions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("note_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("edited_by", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["note_id"], ["document_notes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_note_versions_note_id"), "note_versions", ["note_id"])
    op.execute(
        "INSERT INTO note_versions "
        "(id, note_id, title, description, edited_by, created_at, updated_at) "
        "SELECT gen_random_uuid(), id, title, description, created_by, updated_at, updated_at "
        "FROM document_notes"
    )
    op.execute("ALTER TABLE public.note_versions ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY backend_only_deny_clients ON public.note_versions "
        "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
    )
    op.drop_column("document_versions", "notes")

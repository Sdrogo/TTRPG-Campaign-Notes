"""add import jobs

Spec `27 - Document export and import.md` (unit 27_2): importing Documents from
a file runs in the background, so each import is a row that tracks its status.
`payload` holds the parsed files and the importer's choices while the job is
queued or running and is cleared when it ends (nothing of the uploaded content
is kept); `result` holds what the import created, replaced and skipped. A
partial unique index allows one queued or running import per user and Room.
The row cascades with the Room. Like every table in `public` it is
backend-only: RLS on, plus the explicit deny policy for the client roles
(code-standards.md -> Data and Storage).

Revision ID: f7a2d8c4e1b9
Revises: e9b4c2d7a1f6
Create Date: 2026-10-08 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "f7a2d8c4e1b9"
down_revision: Union[str, Sequence[str], None] = "e9b4c2d7a1f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "import_jobs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("requested_by", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=True),
        sa.Column("result", postgresql.JSONB(), nullable=True),
        sa.Column("error", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'done', 'failed')",
            name="ck_import_jobs_status",
        ),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_import_jobs_room_id"), "import_jobs", ["room_id"], unique=False)
    op.create_index(
        "uq_import_jobs_one_active",
        "import_jobs",
        ["room_id", "requested_by"],
        unique=True,
        postgresql_where=sa.text("status IN ('queued', 'running')"),
    )
    op.execute("ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY backend_only_deny_clients ON public.import_jobs "
        "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("uq_import_jobs_one_active", table_name="import_jobs")
    op.drop_index(op.f("ix_import_jobs_room_id"), table_name="import_jobs")
    op.drop_table("import_jobs")

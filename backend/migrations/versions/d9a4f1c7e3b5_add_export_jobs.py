"""add export jobs

Spec `23b - Room PDF manual.md` (unit 23b_1c): a Room PDF is generated in the
background, so each request is a row that tracks its status and, once done, the
Storage path of the file (a private `exports/` prefix, removed after 24 hours
through `storage_cleanup`). A partial unique index allows one queued or running
job per user and Room. The row cascades with the Room; deleting a Room queues
the files for removal first. Like every table in `public` it is backend-only:
RLS on, plus the explicit deny policy for the client roles
(code-standards.md -> Data and Storage).

Revision ID: d9a4f1c7e3b5
Revises: c4e9a7f1d3b2
Create Date: 2026-10-05 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "d9a4f1c7e3b5"
down_revision: Union[str, Sequence[str], None] = "c4e9a7f1d3b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "export_jobs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("requested_by", sa.UUID(), nullable=False),
        sa.Column("options", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=True),
        sa.Column("error", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'done', 'failed', 'expired')",
            name="ck_export_jobs_status",
        ),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_export_jobs_room_id"), "export_jobs", ["room_id"], unique=False)
    op.create_index(
        "uq_export_jobs_one_active",
        "export_jobs",
        ["room_id", "requested_by"],
        unique=True,
        postgresql_where=sa.text("status IN ('queued', 'running')"),
    )
    op.execute("ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY backend_only_deny_clients ON public.export_jobs "
        "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("uq_export_jobs_one_active", table_name="export_jobs")
    op.drop_index(op.f("ix_export_jobs_room_id"), table_name="export_jobs")
    op.drop_table("export_jobs")

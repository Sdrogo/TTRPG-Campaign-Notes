"""add request stats and error events

Ticket `75 - Monitoring dashboards.md`, unit 75_3: `request_stats_hourly`
holds one row per hour and route group (requests, 4xx, 5xx, a latency
histogram), `error_events` one row per server error (route template,
method, status, exception class, request id). Neither stores a user, a path
with ids, an IP or an exception message. Backend-only like every table in
`public`: RLS on, plus the explicit deny policy for the client roles.

Revision ID: c6f1a9d3e7b2
Revises: b5e2c8f1a4d7
Create Date: 2026-11-17 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c6f1a9d3e7b2"
down_revision: Union[str, Sequence[str], None] = "b5e2c8f1a4d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _backend_only(table: str) -> None:
    op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY backend_only_deny_clients ON public.{table} "
        "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
    )


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "request_stats_hourly",
        sa.Column("hour", sa.DateTime(timezone=True), nullable=False),
        sa.Column("route_group", sa.String(length=30), nullable=False),
        sa.Column("requests", sa.Integer(), nullable=False),
        sa.Column("client_errors", sa.Integer(), nullable=False),
        sa.Column("server_errors", sa.Integer(), nullable=False),
        sa.Column("latency", postgresql.ARRAY(sa.Integer()), nullable=False),
        sa.PrimaryKeyConstraint("hour", "route_group"),
    )
    _backend_only("request_stats_hourly")

    op.create_table(
        "error_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("route", sa.String(length=300), nullable=False),
        sa.Column("method", sa.String(length=10), nullable=False),
        sa.Column("status", sa.Integer(), nullable=False),
        sa.Column("exc_type", sa.String(length=100), nullable=True),
        sa.Column("request_id", sa.String(length=32), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_error_events_occurred_at", "error_events", ["occurred_at"])
    _backend_only("error_events")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("error_events")
    op.drop_table("request_stats_hourly")

"""add friendships

Spec `18 - Friends.md` (D-26, D-27), unit 18_1a: Friendships between users and
personal Friend codes, the first tables not tied to a Room. `friendships`
keeps one row per pair (ids stored ordered, unique together); a declined row
stays for the 30-day request cooldown. `friend_codes` holds one code per user,
unique across users. Like every table in `public` both are backend-only: RLS
on, plus the explicit deny policy for the client roles (code-standards.md ->
Data and Storage).

Revision ID: b7e1d4f8a2c6
Revises: a3d9c5e7f210
Create Date: 2026-10-02 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7e1d4f8a2c6"
down_revision: Union[str, Sequence[str], None] = "a3d9c5e7f210"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DENY_POLICY = (
    "CREATE POLICY backend_only_deny_clients ON public.{table} "
    "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "friendships",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_low", sa.UUID(), nullable=False),
        sa.Column("user_high", sa.UUID(), nullable=False),
        sa.Column("requested_by", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "hidden_from_sender", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.CheckConstraint("user_low < user_high", name="ck_friendships_ordered_pair"),
        sa.CheckConstraint(
            "requested_by IN (user_low, user_high)", name="ck_friendships_requested_by_in_pair"
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'accepted', 'declined')", name="ck_friendships_status"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_low", "user_high", name="uq_friendships_pair"),
    )
    op.create_index(op.f("ix_friendships_user_high"), "friendships", ["user_high"], unique=False)
    op.create_table(
        "friend_codes",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id"),
        sa.UniqueConstraint("code"),
    )
    for table in ("friendships", "friend_codes"):
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(_DENY_POLICY.format(table=table))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("friend_codes")
    op.drop_index(op.f("ix_friendships_user_high"), table_name="friendships")
    op.drop_table("friendships")

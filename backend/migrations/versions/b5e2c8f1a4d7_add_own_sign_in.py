"""add own sign-in

Ticket `73 - Leave Vercel and Supabase.md`, step 3: the backend runs the OAuth
sign-in itself instead of Supabase Auth.

`auth_identities` maps a provider account (provider + the provider's user id)
to a user, with what the provider last said about it (email, whether
verified, name, picture). `auth_sessions` holds one row per signed-in browser:
the hash of its current refresh token, the hash of the one before it (a
second tab may still send it for a minute after a rotation), when it expires
and whether it was signed out. No foreign key to `users`, like every user
reference here (a `users` row exists only once someone uses the app).

When Supabase's `auth.identities` exists (both Supabase databases), its Google,
Discord and GitHub rows are copied with the same user ids, so everyone keeps
their account and only signs in once more. Copying is idempotent and only
adds missing rows. Like every table in `public` both are backend-only: RLS on,
plus the explicit deny policy for the client roles.

Revision ID: b5e2c8f1a4d7
Revises: e7b3d9a1c5f2
Create Date: 2026-11-17 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5e2c8f1a4d7"
down_revision: Union[str, Sequence[str], None] = "e7b3d9a1c5f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COPY_FROM_SUPABASE = """
DO $$
BEGIN
  IF to_regclass('auth.identities') IS NOT NULL THEN
    INSERT INTO public.auth_identities
      (id, provider, provider_user_id, user_id, email, email_verified, name, avatar_url,
       created_at, last_sign_in_at)
    SELECT gen_random_uuid(), i.provider, i.provider_id, i.user_id,
           NULLIF(i.identity_data->>'email', ''),
           COALESCE((i.identity_data->>'email_verified')::boolean, false),
           LEFT(COALESCE(NULLIF(i.identity_data->>'full_name', ''),
                         NULLIF(i.identity_data->>'name', ''),
                         NULLIF(i.identity_data->>'user_name', '')), 200),
           LEFT(COALESCE(NULLIF(i.identity_data->>'avatar_url', ''),
                         NULLIF(i.identity_data->>'picture', '')), 1000),
           COALESCE(i.created_at, now()), i.last_sign_in_at
    FROM auth.identities i
    WHERE i.provider IN ('google', 'discord', 'github')
      AND i.provider_id IS NOT NULL
    ON CONFLICT (provider, provider_user_id) DO NOTHING;
  END IF;
END
$$;
"""


def _backend_only(table: str) -> None:
    op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY backend_only_deny_clients ON public.{table} "
        "AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)"
    )


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "auth_identities",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("provider_user_id", sa.String(length=255), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("email_verified", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=True),
        sa.Column("avatar_url", sa.String(length=1000), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("last_sign_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "provider_user_id", name="uq_auth_identities_provider_user"),
    )
    op.create_index("ix_auth_identities_user_id", "auth_identities", ["user_id"])
    op.create_index(
        "ix_auth_identities_email_lower", "auth_identities", [sa.text("lower(email)")]
    )
    _backend_only("auth_identities")

    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("identity_id", sa.UUID(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("previous_token_hash", sa.String(length=64), nullable=True),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("user_agent", sa.String(length=300), nullable=True),
        sa.ForeignKeyConstraint(["identity_id"], ["auth_identities.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_auth_sessions_token_hash"),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_index(
        "ix_auth_sessions_previous_token_hash", "auth_sessions", ["previous_token_hash"]
    )
    _backend_only("auth_sessions")

    op.execute(_COPY_FROM_SUPABASE)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("auth_sessions")
    op.drop_table("auth_identities")

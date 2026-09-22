"""lock down public schema

Supabase exposes the `public` schema through its Data API, and tables
created there are granted to the `anon` and `authenticated` roles by
default. The publishable key ships in the frontend bundle, so with RLS off
anyone could read and write every table directly, bypassing the backend's
visibility rules (confirmed live on 2026-09-22).

The app never uses the Data API: the backend connects as `postgres`, which
owns these tables and is therefore not subject to RLS. So every table is
backend-only: RLS on with no policies, and no privileges for the client
roles. The default privileges are changed too, so tables created by later
migrations start locked down instead of exposed.

Revision ID: c9d4e7b1f352
Revises: b2e6f1a8c4d9
Create Date: 2026-09-22 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c9d4e7b1f352'
down_revision: Union[str, Sequence[str], None] = 'b2e6f1a8c4d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        """
        DO $$
        DECLARE t record;
        BEGIN
          FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
            EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t.tablename);
          END LOOP;
        END
        $$;
        """
    )
    op.execute("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated")
    for object_type in ("TABLES", "SEQUENCES", "FUNCTIONS"):
        op.execute(
            f"ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public "
            f"REVOKE ALL ON {object_type} FROM anon, authenticated"
        )


def downgrade() -> None:
    """Deliberately a no-op: going back would re-expose every table to
    anyone holding the public key. Re-running upgrade() is harmless."""

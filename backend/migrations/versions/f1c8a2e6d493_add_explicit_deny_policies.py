"""add explicit deny policies

Every public table is backend-only (migration c9d4e7b1f352: RLS on, no
privileges for the client roles). Supabase still flags "RLS enabled, no
policy" on each one, because with no policy the intent is only implicit.
This adds a restrictive policy denying the client roles everything, so the
intent is written in the database itself. It changes nothing for the
backend: it connects as `postgres`, the tables' owner, which RLS doesn't
apply to.

Revision ID: f1c8a2e6d493
Revises: e5a3b8d2c671
Create Date: 2026-09-22 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f1c8a2e6d493'
down_revision: Union[str, Sequence[str], None] = 'e5a3b8d2c671'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

POLICY = 'backend_only_deny_clients'


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        f"""
        DO $$
        DECLARE t record;
        BEGIN
          FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
            IF NOT EXISTS (
              SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = t.tablename AND policyname = '{POLICY}'
            ) THEN
              EXECUTE format(
                'CREATE POLICY {POLICY} ON public.%I AS RESTRICTIVE FOR ALL '
                'TO anon, authenticated USING (false) WITH CHECK (false)',
                t.tablename
              );
            END IF;
          END LOOP;
        END
        $$;
        """
    )


def downgrade() -> None:
    """Downgrade schema. Tables stay locked (RLS on, no client privileges);
    only the explicit statement of that goes away."""
    op.execute(
        f"""
        DO $$
        DECLARE t record;
        BEGIN
          FOR t IN SELECT tablename FROM pg_policies
                   WHERE schemaname = 'public' AND policyname = '{POLICY}' LOOP
            EXECUTE format('DROP POLICY {POLICY} ON public.%I', t.tablename);
          END LOOP;
        END
        $$;
        """
    )

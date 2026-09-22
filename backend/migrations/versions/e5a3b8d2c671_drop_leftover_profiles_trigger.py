"""drop leftover profiles trigger

`on_auth_user_created` (on auth.users) and its function
`public.handle_new_user` were created outside this repo's migrations,
apparently from a Supabase quickstart. They insert into `public.profiles`,
which doesn't exist, so a new user's first sign-in would fail. The app
doesn't need them: the backend keeps its own `users` mirror and copies the
Google name/picture itself (app/api/account.py).

Revision ID: e5a3b8d2c671
Revises: c9d4e7b1f352
Create Date: 2026-09-22 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e5a3b8d2c671'
down_revision: Union[str, Sequence[str], None] = 'c9d4e7b1f352'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users")
    op.execute("DROP FUNCTION IF EXISTS public.handle_new_user()")


def downgrade() -> None:
    """Downgrade schema: restores the trigger exactly as it was found."""
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.handle_new_user()
         RETURNS trigger
         LANGUAGE plpgsql
         SECURITY DEFINER
        AS $function$
        BEGIN
          INSERT INTO public.profiles (id, full_name, avatar_url, email)
          VALUES (
            NEW.id,
            NEW.raw_user_meta_data->>'full_name',
            NEW.raw_user_meta_data->>'avatar_url',
            NEW.email
          );
          RETURN NEW;
        END;
        $function$
        """
    )
    op.execute(
        "CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users "
        "FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()"
    )

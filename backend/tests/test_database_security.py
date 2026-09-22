"""Guards the database against the Supabase Data API: every table in `public`
must be backend-only (RLS on, no privileges for the client roles), including
tables added by future migrations. See migration c9d4e7b1f352."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

CLIENT_ROLES = ("anon", "authenticated")


async def test_every_public_table_has_rls_enabled(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity")
    )
    assert list(result.scalars()) == []


async def test_client_roles_have_no_table_privileges(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text(
            "SELECT table_name || ': ' || grantee || ' ' || privilege_type "
            "FROM information_schema.role_table_grants "
            "WHERE table_schema = 'public' AND grantee = ANY(:roles)"
        ).bindparams(roles=list(CLIENT_ROLES))
    )
    assert list(result.scalars()) == []


async def test_new_tables_are_not_granted_to_client_roles(db_session: AsyncSession) -> None:
    # The default privileges tables created by our migrations (owned by
    # `postgres`) start with.
    result = await db_session.execute(
        text(
            "SELECT defaclobjtype::text || ' ' || defaclacl::text FROM pg_default_acl "
            "WHERE defaclnamespace = 'public'::regnamespace "
            "AND defaclrole = 'postgres'::regrole"
        )
    )
    leaks = [acl for acl in result.scalars() if any(f"{role}=" in acl for role in CLIENT_ROLES)]
    assert leaks == []

"""Guards the database against the Supabase Data API: every table in `public`
must be backend-only (RLS on, an explicit deny policy, no privileges for the
client roles), including tables added by future migrations. See migrations
c9d4e7b1f352 and f1c8a2e6d493."""

from collections.abc import Sequence

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

CLIENT_ROLES = ("anon", "authenticated")
DENY_POLICY = "backend_only_deny_clients"


async def test_every_public_table_has_rls_enabled(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity")
    )
    assert list(result.scalars()) == []


async def test_every_public_table_explicitly_denies_client_roles(
    db_session: AsyncSession,
) -> None:
    result = await db_session.execute(
        text(
            "SELECT t.tablename FROM pg_tables t "
            "WHERE t.schemaname = 'public' AND NOT EXISTS ("
            "  SELECT 1 FROM pg_policies p"
            "  WHERE p.schemaname = 'public' AND p.tablename = t.tablename"
            "    AND p.policyname = :policy AND p.permissive = 'RESTRICTIVE'"
            "    AND p.cmd = 'ALL' AND p.roles @> CAST(:roles AS name[])"
            "    AND p.qual = 'false' AND p.with_check = 'false')"
        ).bindparams(policy=DENY_POLICY, roles=list(CLIENT_ROLES))
    )
    assert list(result.scalars()) == []


async def test_no_policy_lets_client_roles_in(db_session: AsyncSession) -> None:
    # E.g. a "to authenticated using (true)" policy pasted from a dashboard
    # suggestion. Restrictive policies only narrow access, so only
    # permissive ones can open a table.
    result = await db_session.execute(
        text(
            "SELECT tablename || ': ' || policyname FROM pg_policies "
            "WHERE schemaname = 'public' AND permissive = 'PERMISSIVE' "
            "AND (roles && CAST(:roles AS name[]) OR roles @> ARRAY['public']::name[])"
        ).bindparams(roles=list(CLIENT_ROLES))
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
    # `defaclacl` is NULL when no default ACL was ever set for that
    # (role, object type) pair - the safe case, not a leak - so it's
    # filtered out before the substring check rather than stringified.
    rows: Sequence[str | None] = result.scalars().all()
    acls = [row for row in rows if row is not None]
    leaks = [acl for acl in acls if any(f"{role}=" in acl for role in CLIENT_ROLES)]
    assert leaks == []

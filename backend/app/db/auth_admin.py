"""Supabase Auth's admin API, with the backend's secret key: only used to
delete a user's sign-in account when they delete their account (spec 31_1).
The auth account holds their email and provider identity, which the app's
own tables can't erase."""

import httpx

from app.config import settings


class AuthAdminError(Exception):
    """Supabase Auth answered with an error."""


async def delete_auth_user(user_id: str) -> None:  # pragma: no cover - real Auth HTTP only
    """Deletes the user from Supabase Auth, which also ends their sessions.
    Idempotent: a user who is already gone counts as deleted."""
    headers = {
        "apikey": settings.supabase_secret_key,
        "Authorization": f"Bearer {settings.supabase_secret_key}",
    }
    url = f"{settings.supabase_url}/auth/v1/admin/users/{user_id}"
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.delete(url, headers=headers)
    if response.is_error and response.status_code != 404:
        raise AuthAdminError(f"Failed to delete auth user: {response.status_code}")

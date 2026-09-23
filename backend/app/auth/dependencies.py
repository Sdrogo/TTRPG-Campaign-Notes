"""The `CurrentUserDep` dependency: every protected route takes the caller from
here, never by parsing the token itself."""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.auth.jwt import InvalidTokenError, decode_supabase_jwt

_bearer_scheme = HTTPBearer(auto_error=False)


class CurrentUser(BaseModel):
    """The authenticated caller, as the verified token describes them."""

    id: str
    email: str | None = None
    # From the OAuth identity (Google, Discord, Facebook, GitHub or X) that
    # Supabase puts in `user_metadata`; only used to pre-fill the profile the
    # first time (see app/api/account.py). Named for Google, the first provider.
    google_name: str | None = None
    google_picture_url: str | None = None


def _first_string(metadata: object, *keys: str) -> str | None:
    """The first non-blank string among `keys` in the token's `user_metadata`.
    The same claim goes by different names across providers."""
    if not isinstance(metadata, dict):
        return None
    for key in keys:
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
) -> CurrentUser:
    """Resolves the caller from the `Authorization: Bearer` header. 401 when
    it's missing, invalid or expired."""
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    try:
        payload = decode_supabase_jwt(credentials.credentials)
    except InvalidTokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token") from exc
    metadata = payload.get("user_metadata")
    return CurrentUser(
        id=payload["sub"],
        email=payload.get("email"),
        # GitHub and X users may have no display name, only a handle.
        google_name=_first_string(metadata, "full_name", "name", "user_name", "preferred_username"),
        google_picture_url=_first_string(metadata, "avatar_url", "picture"),
    )


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]

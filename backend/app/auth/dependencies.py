from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.auth.jwt import InvalidTokenError, decode_supabase_jwt

_bearer_scheme = HTTPBearer(auto_error=False)


class CurrentUser(BaseModel):
    id: str
    email: str | None = None
    # From the Google identity Supabase puts in `user_metadata`; only used
    # to pre-fill the profile the first time (see app/api/account.py).
    google_name: str | None = None
    google_picture_url: str | None = None


def _first_string(metadata: object, *keys: str) -> str | None:
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
        google_name=_first_string(metadata, "full_name", "name"),
        google_picture_url=_first_string(metadata, "avatar_url", "picture"),
    )


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]

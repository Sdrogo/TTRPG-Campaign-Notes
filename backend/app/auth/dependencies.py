"""The `CurrentUserDep` dependency: every protected route takes the caller from
here, never by parsing the token itself. It is also where "view as" (spec
22b) swaps the caller for the member the Master previews, so every read path
filters for that member without repeating a visibility rule."""

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.auth.jwt import InvalidTokenError, decode_supabase_jwt
from app.db import rooms_repo
from app.db.session import SessionDep
from app.domain.errors import DomainError
from app.domain.view_as import ensure_can_view_as, ensure_read_only
from app.i18n.dependencies import LocaleDep
from app.i18n.translator import translate

VIEW_AS_HEADER = "X-View-As"

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


def authenticated_user(
    credentials: HTTPAuthorizationCredentials | None, locale: str
) -> CurrentUser:
    """Resolves the caller from the `Authorization: Bearer` header. 401 when
    it's missing, invalid or expired."""
    if credentials is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, translate("errors.auth.missingToken", locale)
        )
    try:
        payload = decode_supabase_jwt(credentials.credentials)
    except InvalidTokenError as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, translate("errors.auth.invalidToken", locale)
        ) from exc
    metadata = payload.get("user_metadata")
    return CurrentUser(
        id=payload["sub"],
        email=payload.get("email"),
        # GitHub and X users may have no display name, only a handle.
        google_name=_first_string(metadata, "full_name", "name", "user_name", "preferred_username"),
        google_picture_url=_first_string(metadata, "avatar_url", "picture"),
    )


def _forbidden(exc: DomainError, locale: str) -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, translate(exc.key, locale, **exc.params))


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
    locale: LocaleDep,
    session: SessionDep,
) -> CurrentUser:
    """The caller, or the member they view the Room as (spec 22b). With an
    `X-View-As: <user_id>` header, any write is refused (403) whatever the
    route; on a Room's route (`/rooms/{room_id}/...`) the caller must be its
    Master and the user a member (403 otherwise), and the route then runs as
    that member. Routes outside a Room ignore the header."""
    caller = authenticated_user(credentials, locale)
    view_as = request.headers.get(VIEW_AS_HEADER)
    if view_as is None:
        return caller
    try:
        ensure_read_only(request.method)
    except DomainError as exc:
        raise _forbidden(exc, locale) from exc
    room_id = request.path_params.get("room_id")
    if room_id is None:
        return caller
    try:
        target_id = uuid.UUID(view_as)
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, translate("errors.viewAs.invalidUser", locale)
        ) from exc
    try:
        room_uuid = uuid.UUID(str(room_id))
    except ValueError:
        return caller  # The route itself answers 422 for a malformed Room id.
    viewer = await rooms_repo.get_membership(session, room_uuid, uuid.UUID(caller.id))
    if viewer is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, translate("errors.room.notAMember", locale))
    try:
        target = ensure_can_view_as(
            viewer, await rooms_repo.get_membership(session, room_uuid, target_id)
        )
    except DomainError as exc:
        raise _forbidden(exc, locale) from exc
    # The member's identity only: no email or sign-in metadata of theirs.
    return CurrentUser(id=str(target.user_id))


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]

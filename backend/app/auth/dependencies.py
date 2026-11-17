"""The `CurrentUserDep` dependency: every protected route takes the caller from
here, never by parsing the token itself. It is also where "view as" (spec
22b) swaps the caller for the member the Master previews, so every read path
filters for that member without repeating a visibility rule."""

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.auth.tokens import InvalidTokenError, decode_access_token
from app.db import rooms_repo
from app.db.session import SessionDep
from app.domain.errors import DomainError
from app.domain.throttle import RateLimitedError, Throttle
from app.domain.view_as import ensure_can_view_as, ensure_read_only
from app.i18n.dependencies import LocaleDep
from app.i18n.translator import translate

VIEW_AS_HEADER = "X-View-As"

# Spec 72 Decision 10: every write (any method but GET and HEAD) counts here,
# per user; the heavier routes add their own group limit (`app/api/rate_limits.py`).
WRITE_THROTTLE = Throttle(limit=600, window=60.0)
_READ_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

_bearer_scheme = HTTPBearer(auto_error=False)


class CurrentUser(BaseModel):
    """The authenticated caller, as the verified token describes them."""

    id: str
    email: str | None = None
    # From the provider profile (Google, Discord or GitHub) the session was
    # opened with; only used to pre-fill the profile the first time (see
    # app/api/account.py). Named for Google, the first provider.
    google_name: str | None = None
    google_picture_url: str | None = None


def _string_claim(payload: dict[str, object], key: str) -> str | None:
    value = payload.get(key)
    return value if isinstance(value, str) and value.strip() else None


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
        payload = decode_access_token(credentials.credentials)
    except InvalidTokenError as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, translate("errors.auth.invalidToken", locale)
        ) from exc
    return CurrentUser(
        id=payload["sub"],
        email=_string_claim(payload, "email"),
        google_name=_string_claim(payload, "name"),
        google_picture_url=_string_claim(payload, "picture"),
    )


def rate_limited(exc: RateLimitedError, locale: str) -> HTTPException:
    """429 for a user over a limit, with the seconds to wait (spec 72)."""
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        translate(exc.key, locale),
        headers={"Retry-After": str(exc.retry_after)},
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
        if request.method not in _READ_METHODS:
            try:
                WRITE_THROTTLE.check(caller.id)
            except RateLimitedError as exc:
                raise rate_limited(exc, locale) from exc
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

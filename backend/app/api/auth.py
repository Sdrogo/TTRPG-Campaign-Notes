"""Sign-in, run by the backend itself since ticket 73 step 3 (it was Supabase
Auth before). The browser goes to `/auth/{provider}/start`, signs in at the
provider and comes back to `/auth/{provider}/callback`, which opens a
session: a refresh token in an `HttpOnly` cookie on the API's host. The SPA
then calls `/auth/refresh` for a short access token, which every other route
reads from the `Authorization: Bearer` header as before."""

import logging
import secrets
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.auth import providers
from app.auth.dependencies import CurrentUserDep, rate_limited
from app.auth.tokens import (
    ACCESS_TOKEN_TTL,
    InvalidTokenError,
    decode_sign_in_state,
    hash_refresh_token,
    issue_access_token,
    issue_sign_in_state,
    new_refresh_token,
)
from app.config import settings
from app.db import auth_repo, users_repo
from app.db.models import AuthIdentityRow
from app.db.session import SessionDep
from app.domain.sign_in import SESSION_TTL, RefreshOutcome, allowed_return_origin, refresh_outcome
from app.domain.throttle import RateLimitedError, Throttle
from app.i18n.dependencies import LocaleDep
from app.i18n.translator import translate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

SESSION_COOKIE = "exlibris_session"
SIGN_IN_COOKIE = "exlibris_sign_in"
_COOKIE_PATH = "/auth"
# Per client address: a sign-in is two requests, a page load one refresh.
SIGN_IN_THROTTLE = Throttle(limit=30, window=60.0)
REFRESH_THROTTLE = Throttle(limit=120, window=60.0)


class MeResponse(BaseModel):
    """Who the token belongs to. The user's profile lives at /account."""

    id: str
    email: str | None


class SessionUser(BaseModel):
    """The signed-in user, as the SPA keeps it next to the access token."""

    id: str
    email: str | None
    provider: str


class SessionResponse(BaseModel):
    """A fresh access token for the session in the cookie."""

    access_token: str
    expires_in: int
    user: SessionUser


@router.get("/me")
def get_me(current_user: CurrentUserDep) -> MeResponse:
    """The authenticated user's id and email, straight from the token."""
    return MeResponse(id=current_user.id, email=current_user.email)


def _client_address(request: Request) -> str:
    """The browser's address: Caddy's `X-Forwarded-For` (only Caddy reaches
    the backend), or the socket's peer locally."""
    forwarded = request.headers.get("x-forwarded-for", "")
    last = forwarded.split(",")[-1].strip()
    if last:
        return last
    return request.client.host if request.client else "unknown"


def _throttle(throttle: Throttle, request: Request, locale: str) -> None:
    try:
        throttle.check(_client_address(request))
    except RateLimitedError as exc:
        raise rate_limited(exc, locale) from exc


def _provider(provider_id: str, locale: str) -> providers.Provider:
    provider = providers.PROVIDERS.get(provider_id)
    if provider is None or not provider.enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, translate("errors.auth.noProvider", locale))
    return provider


def _return_origin(value: str | None) -> str | None:
    return allowed_return_origin(value, settings.cors_origins, settings.cors_origin_regex)


def _set_cookie(response: Response, name: str, value: str, max_age: int) -> None:
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        path=_COOKIE_PATH,
        secure=settings.auth_cookie_secure,
        httponly=True,
        samesite="lax",
    )


def _clear_cookie(response: Response, name: str) -> None:
    response.delete_cookie(
        name, path=_COOKIE_PATH, secure=settings.auth_cookie_secure, httponly=True, samesite="lax"
    )


@router.get("/{provider_id}/start")
def start_sign_in(
    provider_id: str,
    request: Request,
    locale: LocaleDep,
    return_to: Annotated[str | None, Query()] = None,
) -> RedirectResponse:
    """Sends the browser to the provider, remembering in a short signed
    cookie the `state` it must come back with, the PKCE verifier and the
    frontend origin to return to (one of the CORS origins)."""
    _throttle(SIGN_IN_THROTTLE, request, locale)
    provider = _provider(provider_id, locale)
    origin = _return_origin(return_to)
    if origin is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, translate("errors.auth.badReturnAddress", locale)
        )
    state = secrets.token_urlsafe(32)
    verifier = providers.new_code_verifier()
    cookie = issue_sign_in_state(
        {"state": state, "verifier": verifier, "provider": provider.id, "return_to": origin}
    )
    response = RedirectResponse(
        provider.authorization_url(state, verifier), status_code=status.HTTP_302_FOUND
    )
    _set_cookie(response, SIGN_IN_COOKIE, cookie, max_age=600)
    return response


def _back_to(origin: str, failed: bool) -> RedirectResponse:
    target = f"{origin}/?signInError=1" if failed else f"{origin}/"
    return RedirectResponse(target, status_code=status.HTTP_302_FOUND)


async def _user_for(
    session: SessionDep, provider_id: str, identity: providers.ProviderIdentity
) -> tuple[AuthIdentityRow | None, uuid.UUID]:
    """The identity already known for this provider account and its user,
    else the user with the same verified email, else a new user."""
    existing = await auth_repo.find_identity(session, provider_id, identity.provider_user_id)
    if existing is not None:
        return existing, existing.user_id
    if identity.email and identity.email_verified:
        linked = await auth_repo.find_user_by_verified_email(session, identity.email)
        if linked is not None:
            return None, linked
    return None, uuid.uuid4()


@router.get("/{provider_id}/callback")
async def finish_sign_in(
    provider_id: str,
    request: Request,
    session: SessionDep,
    locale: LocaleDep,
    code: Annotated[str | None, Query()] = None,
    state: Annotated[str | None, Query()] = None,
) -> RedirectResponse:
    """Checks the provider's answer against the sign-in cookie, reads who
    signed in, finds or creates their user and opens a session. Any failure
    sends the browser back to the frontend with `?signInError=1`."""
    _throttle(SIGN_IN_THROTTLE, request, locale)
    try:
        claims = decode_sign_in_state(request.cookies.get(SIGN_IN_COOKIE, ""))
    except InvalidTokenError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, translate("errors.auth.signInExpired", locale)
        ) from exc
    origin = _return_origin(claims.get("return_to"))
    if origin is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, translate("errors.auth.badReturnAddress", locale)
        )
    provider = providers.PROVIDERS.get(provider_id)
    if (
        provider is None
        or claims.get("provider") != provider_id
        or not code
        or not state
        or not secrets.compare_digest(state, str(claims.get("state", "")))
    ):
        failed = _back_to(origin, failed=True)
        _clear_cookie(failed, SIGN_IN_COOKIE)
        return failed
    try:
        identity = await providers.fetch_identity(provider, code, str(claims.get("verifier", "")))
    except providers.ProviderError:
        logger.warning("Sign-in with %s failed at the provider", provider_id, exc_info=True)
        failed = _back_to(origin, failed=True)
        _clear_cookie(failed, SIGN_IN_COOKIE)
        return failed

    now = datetime.now(UTC)
    existing, user_id = await _user_for(session, provider_id, identity)
    row = await auth_repo.save_identity(session, existing, provider_id, user_id, identity, now)
    await users_repo.upsert_user(session, row.user_id, identity.email)
    refresh_token = new_refresh_token()
    await auth_repo.create_session(
        session, row, hash_refresh_token(refresh_token), request.headers.get("user-agent"), now
    )
    response = _back_to(origin, failed=False)
    _clear_cookie(response, SIGN_IN_COOKIE)
    _set_cookie(response, SESSION_COOKIE, refresh_token, int(SESSION_TTL.total_seconds()))
    return response


def _check_origin(request: Request, locale: str) -> None:
    """A cookie-authenticated POST must come from one of the frontend's
    origins: SameSite=Lax already keeps other sites' requests from carrying
    the cookie, this refuses them outright."""
    origin = request.headers.get("origin")
    if origin is not None and _return_origin(origin) is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, translate("errors.auth.badOrigin", locale))


def _signed_out(locale: str) -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, translate("errors.auth.signedOut", locale))


@router.post("/refresh")
async def refresh(
    request: Request, response: Response, session: SessionDep, locale: LocaleDep
) -> SessionResponse:
    """A new access token for the session in the cookie, rotating its
    refresh token (see `refresh_outcome`). 401 when there is no live
    session: the SPA then shows the signed-out home page."""
    _throttle(REFRESH_THROTTLE, request, locale)
    _check_origin(request, locale)
    token = request.cookies.get(SESSION_COOKIE)
    found = await auth_repo.find_session(session, hash_refresh_token(token)) if token else None
    if found is None:
        raise _signed_out(locale)
    row, identity, matched_current = found
    now = datetime.now(UTC)
    outcome = refresh_outcome(
        matched_current=matched_current,
        revoked_at=row.revoked_at,
        expires_at=row.expires_at,
        rotated_at=row.rotated_at,
        now=now,
    )
    if outcome is RefreshOutcome.REUSE:
        auth_repo.revoke(row, now)
        await session.commit()
        logger.warning("An old refresh token was reused: session %s signed out", row.id)
    if outcome in (RefreshOutcome.REUSE, RefreshOutcome.REFUSE):
        raise _signed_out(locale)
    if outcome is RefreshOutcome.ROTATE:
        new_token = new_refresh_token()
        auth_repo.rotate(row, hash_refresh_token(new_token), now)
        _set_cookie(response, SESSION_COOKIE, new_token, int(SESSION_TTL.total_seconds()))
    access_token = issue_access_token(
        str(row.user_id), identity.email, identity.provider, identity.name, identity.avatar_url
    )
    return SessionResponse(
        access_token=access_token,
        expires_in=int(ACCESS_TOKEN_TTL.total_seconds()),
        user=SessionUser(id=str(row.user_id), email=identity.email, provider=identity.provider),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, session: SessionDep, locale: LocaleDep) -> Response:
    """Ends the session in the cookie, if any, and clears the cookie."""
    _check_origin(request, locale)
    token = request.cookies.get(SESSION_COOKIE)
    found = await auth_repo.find_session(session, hash_refresh_token(token)) if token else None
    if found is not None:
        auth_repo.revoke(found[0], datetime.now(UTC))
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_cookie(response, SESSION_COOKIE)
    return response

"""The backend's own tokens (ticket 73 step 3): short access tokens the SPA
sends as `Bearer`, the signed cookie that carries an OAuth sign-in from its
start to its callback, and the random refresh tokens behind the session
cookie. Everything is signed or hashed with `AUTH_TOKEN_SECRET`."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from app.config import settings

ISSUER = "exlibris"
ACCESS_AUDIENCE = "exlibris-api"
SIGN_IN_AUDIENCE = "exlibris-sign-in"
ACCESS_TOKEN_TTL = timedelta(minutes=15)
SIGN_IN_TTL = timedelta(minutes=10)
_ALGORITHM = "HS256"
_MIN_SECRET_LENGTH = 32


class InvalidTokenError(Exception):
    """The token failed verification: bad signature, wrong audience or
    issuer, expired, or malformed."""


class MissingSecretError(RuntimeError):
    """`AUTH_TOKEN_SECRET` is unset or too short to sign anything with."""


def _secret() -> str:
    secret = settings.auth_token_secret
    if len(secret) < _MIN_SECRET_LENGTH:
        raise MissingSecretError(
            f"AUTH_TOKEN_SECRET must be at least {_MIN_SECRET_LENGTH} characters"
        )
    return secret


def require_secret() -> None:
    """Fails at startup when `AUTH_TOKEN_SECRET` is missing, so a deploy
    without it stops at the health check instead of answering 500s."""
    _secret()


def _encode(claims: dict[str, Any], audience: str, ttl: timedelta) -> str:
    now = datetime.now(UTC)
    payload = {**claims, "iss": ISSUER, "aud": audience, "iat": now, "exp": now + ttl}
    return jwt.encode(payload, _secret(), algorithm=_ALGORITHM)


def _decode(token: str, audience: str) -> dict[str, Any]:
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            _secret(),
            algorithms=[_ALGORITHM],
            audience=audience,
            issuer=ISSUER,
            options={"require": ["exp", "iss", "aud"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidTokenError(str(exc)) from exc
    return payload


def issue_access_token(
    user_id: str,
    email: str | None,
    provider: str,
    name: str | None = None,
    picture: str | None = None,
) -> str:
    """An access token for `user_id`, valid for `ACCESS_TOKEN_TTL`. The
    name and picture come from the provider's profile and only pre-fill
    the profile the first time (app/api/account.py)."""
    claims = {
        "sub": user_id,
        "email": email,
        "provider": provider,
        "name": name,
        "picture": picture,
    }
    return _encode(claims, ACCESS_AUDIENCE, ACCESS_TOKEN_TTL)


def decode_access_token(token: str) -> dict[str, Any]:
    """The claims of a valid access token. Raises `InvalidTokenError`."""
    payload = _decode(token, ACCESS_AUDIENCE)
    if not isinstance(payload.get("sub"), str):
        raise InvalidTokenError("missing subject")
    return payload


def issue_sign_in_state(claims: dict[str, str]) -> str:
    """The value of the short cookie that ties an OAuth callback to the
    browser that started it: the `state`, the PKCE verifier, the provider
    and where to send the user back."""
    return _encode(claims, SIGN_IN_AUDIENCE, SIGN_IN_TTL)


def decode_sign_in_state(token: str) -> dict[str, Any]:
    """The claims of a sign-in cookie still valid. Raises `InvalidTokenError`."""
    return _decode(token, SIGN_IN_AUDIENCE)


def new_refresh_token() -> str:
    """A random refresh token (256 bits), only ever stored hashed."""
    return secrets.token_urlsafe(32)


def hash_refresh_token(token: str) -> str:
    """What `auth_sessions` stores instead of the token itself."""
    return hashlib.sha256(token.encode()).hexdigest()

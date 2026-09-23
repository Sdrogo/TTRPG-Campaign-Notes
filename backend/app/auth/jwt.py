"""Verifying Supabase access tokens against the project's published signing
keys."""

from functools import lru_cache
from typing import Any

import jwt
from jwt import PyJWKClient

from app.config import settings


class InvalidTokenError(Exception):
    """The token failed verification: bad signature, wrong audience or issuer,
    expired, or malformed."""


@lru_cache
def _jwk_client() -> PyJWKClient:
    """One key client per process, which caches the signing keys for five
    minutes instead of fetching them on every request."""
    return PyJWKClient(settings.supabase_jwks_url, cache_keys=True, lifespan=300)


def decode_supabase_jwt(token: str) -> dict[str, Any]:
    """Verifies `token` (ES256, audience `authenticated`, this project's
    issuer) and returns its claims. Raises `InvalidTokenError` on any
    failure."""
    try:
        signing_key = _jwk_client().get_signing_key_from_jwt(token)
        payload: dict[str, Any] = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256"],
            audience="authenticated",
            issuer=settings.supabase_issuer,
        )
    except jwt.PyJWTError as exc:
        raise InvalidTokenError(str(exc)) from exc
    return payload

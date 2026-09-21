from functools import lru_cache
from typing import Any

import jwt
from jwt import PyJWKClient

from app.config import settings


class InvalidTokenError(Exception):
    pass


@lru_cache
def _jwk_client() -> PyJWKClient:
    return PyJWKClient(settings.supabase_jwks_url, cache_keys=True, lifespan=300)


def decode_supabase_jwt(token: str) -> dict[str, Any]:
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

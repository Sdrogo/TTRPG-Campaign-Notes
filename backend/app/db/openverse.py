"""The Openverse API (spec 29): one page of image results for a query, called
anonymously or, when `OPENVERSE_CLIENT_ID` and `OPENVERSE_CLIENT_SECRET` are
set, with a cached OAuth token for higher limits. The query is sent with the
backend's identity, never the user's (Decision 6)."""

import time
from typing import Any

import httpx

from app.config import settings
from app.domain.image_search import PAGE_SIZE, ImageSearchError

API_URL = "https://api.openverse.org/v1"
TIMEOUT_SECONDS = 10
USER_AGENT = "ExLibris/1.0 (TTRPG campaign notes; image search)"
# A token is renewed this many seconds before Openverse says it expires.
TOKEN_MARGIN_SECONDS = 60

# Tests swap in an `httpx.MockTransport`.
transport: httpx.AsyncBaseTransport | None = None

_token: str | None = None
_token_expires_at = 0.0


def reset_token() -> None:
    """Forgets the cached token (tests, or after Openverse refused it)."""
    global _token, _token_expires_at
    _token = None
    _token_expires_at = 0.0


async def _access_token(client: httpx.AsyncClient) -> str | None:
    """A bearer token when credentials are configured, fetched once and
    reused until shortly before it expires; None to call anonymously."""
    global _token, _token_expires_at
    if not (settings.openverse_client_id and settings.openverse_client_secret):
        return None
    if _token is not None and time.monotonic() < _token_expires_at:
        return _token
    response = await client.post(
        f"{API_URL}/auth_tokens/token/",
        data={
            "grant_type": "client_credentials",
            "client_id": settings.openverse_client_id,
            "client_secret": settings.openverse_client_secret,
        },
    )
    response.raise_for_status()
    body = response.json()
    _token = str(body["access_token"])
    _token_expires_at = time.monotonic() + float(body["expires_in"]) - TOKEN_MARGIN_SECONDS
    return _token


async def search_images(query: str, page: int) -> dict[str, Any]:
    """The raw Openverse response for `query`, page `page` (`PAGE_SIZE`
    results, none marked mature). Any failure, throttling included, is
    `errors.imageSearch.unavailable`: the picker can only say "try later"."""
    async with httpx.AsyncClient(
        timeout=TIMEOUT_SECONDS, transport=transport, headers={"User-Agent": USER_AGENT}
    ) as client:
        try:
            token = await _access_token(client)
            headers = {"Authorization": f"Bearer {token}"} if token else {}
            response = await client.get(
                f"{API_URL}/images/",
                params={"q": query, "page": page, "page_size": PAGE_SIZE, "mature": "false"},
                headers=headers,
            )
            if response.status_code == httpx.codes.UNAUTHORIZED:
                # A revoked or expired token: the next search fetches a new one.
                reset_token()
            response.raise_for_status()
            body = response.json()
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise ImageSearchError("errors.imageSearch.unavailable") from exc
    if not isinstance(body, dict):
        raise ImageSearchError("errors.imageSearch.unavailable")
    return body

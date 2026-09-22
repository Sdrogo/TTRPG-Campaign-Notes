import logging
import time
from collections.abc import Collection

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class StorageError(Exception):
    pass


def _headers() -> dict[str, str]:
    return {
        "apikey": settings.supabase_secret_key,
        "Authorization": f"Bearer {settings.supabase_secret_key}",
    }


def _object_url(path: str) -> str:
    return f"{settings.supabase_url}/storage/v1/object/{settings.storage_bucket}/{path}"


async def upload(path: str, data: bytes, content_type: str) -> None:
    """Server-side upload with the backend's secret key: the client never
    touches Storage itself (architecture.md, Invariant 2), and only bytes
    that already went through `app/domain/images.normalize_image` land in
    the bucket."""
    headers = {**_headers(), "Content-Type": content_type, "x-upsert": "false"}
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(_object_url(path), headers=headers, content=data)
    if response.is_error:
        raise StorageError(f"Failed to upload {path}: {response.text}")


async def remove(path: str) -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.delete(_object_url(path), headers=_headers())
    # A 404 means the object is already gone, which is the state we want.
    if response.is_error and response.status_code != 404:
        raise StorageError(f"Failed to delete {path}: {response.text}")


# The bucket is private: every image URL a response carries is a signed link
# that expires. Links are reused while they have a while left, so the same
# image keeps the same URL (and stays in the browser's cache) between
# requests instead of changing on every response.
SIGNED_URL_TTL_SECONDS = 3600
SIGNED_URL_MIN_REMAINING_SECONDS = 900

_now = time.monotonic
_signed_cache: dict[str, tuple[str, float]] = {}


async def create_signed_urls(paths: Collection[str], expires_in: int) -> dict[str, str]:
    """Asks Storage to sign `paths` in one request. A path Storage can't sign
    (e.g. the object is gone) is left out."""
    url = f"{settings.supabase_url}/storage/v1/object/sign/{settings.storage_bucket}"
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            url, headers=_headers(), json={"expiresIn": expires_in, "paths": list(paths)}
        )
    if response.is_error:
        raise StorageError(f"Failed to sign URLs: {response.text}")
    signed: dict[str, str] = {}
    for item in response.json():
        if item.get("error") is None and item.get("signedURL"):
            signed[item["path"]] = f"{settings.supabase_url}/storage/v1{item['signedURL']}"
    return signed


async def signed_urls(paths: Collection[str]) -> dict[str, str]:
    """Signed read URLs for `paths`, from the cache when a link still has
    enough time left. Callers must only pass paths the requester is allowed
    to see - a signed link works for whoever holds it until it expires.

    If Storage can't sign right now, the missing paths are simply absent
    from the result: an image is left out of the response and an avatar
    falls back to initials, rather than failing the whole request."""
    now = _now()
    for path, (_, expires_at) in list(_signed_cache.items()):
        if expires_at <= now:
            del _signed_cache[path]

    result: dict[str, str] = {}
    missing: list[str] = []
    for path in dict.fromkeys(paths):
        cached = _signed_cache.get(path)
        if cached is not None and cached[1] - now >= SIGNED_URL_MIN_REMAINING_SECONDS:
            result[path] = cached[0]
        else:
            missing.append(path)
    if not missing:
        return result

    try:
        fresh = await create_signed_urls(missing, SIGNED_URL_TTL_SECONDS)
    except (StorageError, httpx.HTTPError):
        logger.warning("Could not sign %d image URL(s)", len(missing), exc_info=True)
        return result
    for path, url in fresh.items():
        _signed_cache[path] = (url, now + SIGNED_URL_TTL_SECONDS)
    return result | fresh


def forget_signed_urls(paths: Collection[str]) -> None:
    """Stops handing out cached links for removed objects. Links already
    given out keep working until they expire."""
    for path in paths:
        _signed_cache.pop(path, None)

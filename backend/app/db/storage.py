"""The images bucket: Garage, an S3 service on the VPS, when `S3_ENDPOINT` is
set (ticket 73 step 4), otherwise Supabase Storage over its REST API with the
backend's secret key. The bucket is private either way, so every image a
response carries is a signed, expiring link.

On S3, botocore signs each request and httpx sends it to the internal
endpoint (`http://garage:3900`). Read links are presigned GETs for the public
host (`S3_PUBLIC_URL`, served by Caddy), path-style: signing them needs no
request at all."""

import logging
import time
from collections.abc import Collection, Mapping
from urllib.parse import quote, unquote, urlsplit

import httpx
from botocore.auth import S3SigV4Auth, S3SigV4QueryAuth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials

from app.config import settings

logger = logging.getLogger(__name__)


class StorageError(Exception):
    """Storage answered with an error."""


def _headers() -> dict[str, str]:  # pragma: no cover - real Storage HTTP only
    """Auth headers for the Storage API. The secret key bypasses Storage
    policies, so it never leaves the backend."""
    return {
        "apikey": settings.supabase_secret_key,
        "Authorization": f"Bearer {settings.supabase_secret_key}",
    }


def _object_url(path: str) -> str:  # pragma: no cover - real Storage HTTP only
    """The Storage API URL of one object in the images bucket."""
    return f"{settings.supabase_url}/storage/v1/object/{settings.storage_bucket}/{path}"


def uses_s3() -> bool:
    """Whether the bucket is the S3 one (Garage) rather than Supabase's."""
    return bool(settings.s3_endpoint)


# How long a browser may keep an object it fetched through a signed link,
# as Supabase Storage told it (its default `cacheControl` of 3600 seconds).
OBJECT_CACHE_CONTROL = "max-age=3600"


def _s3_credentials() -> Credentials:
    return Credentials(settings.s3_access_key_id, settings.s3_secret_access_key)


def _s3_object_url(base: str, path: str) -> str:
    """Path-style URL of one object of the bucket under `base`."""
    return f"{base.rstrip('/')}/{settings.storage_bucket}/{quote(path)}"


def s3_signed_headers(
    method: str, path: str, body: bytes = b"", headers: Mapping[str, str] | None = None
) -> dict[str, str]:
    """The headers that authorize one request on `path` at the internal
    endpoint (AWS Signature V4, payload hash included)."""
    request = AWSRequest(
        method=method,
        url=_s3_object_url(settings.s3_endpoint, path),
        data=body,
        headers=dict(headers or {}),
    )
    S3SigV4Auth(_s3_credentials(), "s3", settings.s3_region).add_auth(request)
    return dict(request.headers.items())


def content_disposition(file_name: str) -> str:
    """`attachment` with the name twice: an ASCII stand-in for old clients,
    and the exact UTF-8 name (RFC 6266)."""
    fallback = "".join(
        char if 32 <= ord(char) < 127 and char not in '"\\' else "_" for char in file_name
    )
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(file_name, safe='')}"


def s3_presigned_url(path: str, expires_in: int, download_name: str | None = None) -> str:
    """A GET link to `path` on the public host, valid for `expires_in`
    seconds. With `download_name`, Garage serves it as an attachment of that
    name; the override is part of the signature, so it can't be changed."""
    params = (
        {}
        if download_name is None
        else {"response-content-disposition": content_disposition(download_name)}
    )
    request = AWSRequest(
        method="GET", url=_s3_object_url(settings.s3_public_url, path), params=params
    )
    S3SigV4QueryAuth(_s3_credentials(), "s3", settings.s3_region, expires=expires_in).add_auth(
        request
    )
    return str(request.url)


async def upload(path: str, data: bytes, content_type: str) -> None:
    """Server-side upload with the backend's own key: the client never
    touches the bucket itself (architecture.md, Invariant 2), and only bytes
    that already went through `app/domain/images.normalize_image` land in
    it."""
    if uses_s3():
        await _s3_upload(path, data, content_type)
    else:
        await _supabase_upload(path, data, content_type)


async def _s3_upload(  # pragma: no cover - real Storage HTTP only
    path: str, data: bytes, content_type: str
) -> None:
    headers = s3_signed_headers(
        "PUT", path, data, {"Content-Type": content_type, "Cache-Control": OBJECT_CACHE_CONTROL}
    )
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.put(
            _s3_object_url(settings.s3_endpoint, path), headers=headers, content=data
        )
    if response.is_error:
        raise StorageError(f"Failed to upload {path}: {response.status_code}")


async def _supabase_upload(  # pragma: no cover - real Storage HTTP only
    path: str, data: bytes, content_type: str
) -> None:
    headers = {**_headers(), "Content-Type": content_type, "x-upsert": "false"}
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(_object_url(path), headers=headers, content=data)
    if response.is_error:
        raise StorageError(f"Failed to upload {path}: {response.text}")


async def remove(path: str) -> None:
    """Deletes one object. Idempotent: an object that is already gone counts as
    removed."""
    if uses_s3():
        await _s3_remove(path)
    else:
        await _supabase_remove(path)


async def _s3_remove(path: str) -> None:  # pragma: no cover - real Storage HTTP only
    # S3 answers 204 whether or not the object was there.
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.delete(
            _s3_object_url(settings.s3_endpoint, path), headers=s3_signed_headers("DELETE", path)
        )
    if response.is_error and response.status_code != 404:
        raise StorageError(f"Failed to delete {path}: {response.status_code}")


async def _supabase_remove(path: str) -> None:  # pragma: no cover - real Storage HTTP only
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
    """Signed read links for `paths`. On S3 they are signed here, with no
    request (so a missing object gets a link that answers 404). Supabase
    signs them in one request and leaves out a path it can't sign (e.g. the
    object is gone)."""
    if uses_s3():
        return {path: s3_presigned_url(path, expires_in) for path in paths}
    return await _supabase_create_signed_urls(paths, expires_in)


async def _supabase_create_signed_urls(  # pragma: no cover - real Storage HTTP only
    paths: Collection[str], expires_in: int
) -> dict[str, str]:
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


def own_object_path(url: str) -> str | None:
    """The object path behind a signed link of this app's own images bucket,
    or None for any other URL. Both shapes count, so an export made before
    the move to Garage still finds its images (the objects keep their paths):
    - S3: `<s3_public_url>/<bucket>/<path>?X-Amz-...`;
    - Supabase: `<supabase_url>/storage/v1/object/sign/<bucket>/<path>?token=...`.

    Only reads the URL: whether the link's signature is still valid, and
    whether anyone may see that object, is the caller's business."""
    prefixes = []
    if settings.s3_public_url:
        prefixes.append(f"{settings.s3_public_url.rstrip('/')}/{settings.storage_bucket}/")
    if settings.supabase_url:
        prefixes.append(
            f"{settings.supabase_url.rstrip('/')}/storage/v1/object/sign/{settings.storage_bucket}/"
        )
    parts = urlsplit(url)
    bare = f"{parts.scheme}://{parts.netloc}{parts.path}"
    for prefix in prefixes:
        if bare.startswith(prefix):
            path = unquote(bare.removeprefix(prefix))
            if not path or ".." in path.split("/"):
                return None
            return path
    return None


async def download(path: str, max_bytes: int) -> bytes:
    """The bytes of one object of the images bucket, read with the backend's
    own key (no signed link, so nothing expires). Callers must have checked
    the requester may see it. A body over `max_bytes` is refused as it streams
    in; raises `StorageError` on any failure."""
    if uses_s3():
        return await _read_limited(
            _s3_object_url(settings.s3_endpoint, path), s3_signed_headers("GET", path), max_bytes
        )
    return await _read_limited(_object_url(path), _headers(), max_bytes)


async def _read_limited(  # pragma: no cover - real Storage HTTP only
    url: str, headers: Mapping[str, str], max_bytes: int
) -> bytes:
    """GETs `url` without following redirects, refusing a body over
    `max_bytes` as it streams in."""
    try:
        async with (
            httpx.AsyncClient(timeout=30) as client,
            client.stream("GET", url, headers=dict(headers)) as response,
        ):
            if response.is_error:
                raise StorageError(f"Storage answered {response.status_code}")
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > max_bytes:
                    raise StorageError("The object is larger than the limit")
            return bytes(body)
    except httpx.HTTPError as exc:
        raise StorageError(f"Could not download: {exc}") from exc


def as_download(signed_url: str, file_name: str) -> str:
    """A signed link that makes the bucket serve the object as an attachment
    named `file_name` (`Content-Disposition: attachment`), so the browser
    downloads it instead of rendering it. PDF Attachments are always served
    this way (D-22): a PDF can carry scripts and must never open as a page.
    On S3 the override is part of the signature, so the link is signed again
    with it, for the time a fresh link gets. Supabase reads the `download`
    query parameter of a signed link; the link already carries `?token=`."""
    if uses_s3():
        path = own_object_path(signed_url)
        if path is not None:
            return s3_presigned_url(path, SIGNED_URL_TTL_SECONDS, download_name=file_name)
    return f"{signed_url}&download={quote(file_name, safe='')}"


async def download_signed(url: str, max_bytes: int) -> bytes:
    """The bytes behind a signed link the backend itself created, for the Room
    PDF job (spec 23b): images to downscale, PDF Attachments to append. A
    link of this app's own bucket is read inside the server, with the
    backend's key; any other is fetched as it is. Redirects aren't followed,
    and a body over `max_bytes` is refused as it streams in. Raises
    `StorageError` on any failure, so the job can leave that one file out."""
    path = own_object_path(url) if uses_s3() else None
    if path is not None:
        return await download(path, max_bytes)
    return await _read_limited(url, {}, max_bytes)

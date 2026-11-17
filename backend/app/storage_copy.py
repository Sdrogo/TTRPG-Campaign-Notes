"""Copies the images bucket from Supabase Storage into the S3 bucket (ticket
73 step 4, Garage). Run on the server, with both set in backend.env:

    docker compose run --rm --no-deps backend python -m app.storage_copy

Only objects missing from S3, or there with another size, are copied, so it
is safe to run again: once before the backend switches to S3, once after for
anything uploaded meanwhile. Nothing is deleted from Supabase (that is step
6). Exits with 1 when any object failed, after trying all of them."""

import asyncio
import logging
import sys
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.config import settings
from app.db import storage

logger = logging.getLogger(__name__)

# Supabase lists at most this many entries per request.
PAGE_SIZE = 1000
# Larger than anything the app stores (a vault import is capped at 150 MB).
MAX_OBJECT_BYTES = 200 * 1024 * 1024


@dataclass(frozen=True)
class SourceObject:
    """One object of the Supabase bucket, as its listing describes it."""

    path: str
    size: int
    content_type: str


ListPage = Callable[[str, int], Awaitable[list[dict[str, Any]]]]


async def walk(list_page: ListPage, prefix: str = "") -> AsyncIterator[SourceObject]:
    """Every object under `prefix`. Supabase lists one folder level at a
    time, a page at a time; a folder is an entry with no `id`."""
    offset = 0
    while True:
        entries = await list_page(prefix, offset)
        for entry in entries:
            path = f"{prefix}{entry['name']}"
            if entry.get("id") is None:
                async for found in walk(list_page, f"{path}/"):
                    yield found
            else:
                metadata = entry.get("metadata") or {}
                yield SourceObject(
                    path=path,
                    size=int(metadata.get("size", 0)),
                    content_type=metadata.get("mimetype") or "application/octet-stream",
                )
        if len(entries) < PAGE_SIZE:
            return
        offset += PAGE_SIZE


@dataclass
class Report:
    """What a run did with each object path."""

    copied: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)


async def copy_missing(
    objects: AsyncIterator[SourceObject],
    s3_size: Callable[[str], Awaitable[int | None]],
    copy: Callable[[SourceObject], Awaitable[None]],
) -> Report:
    """Copies each object S3 lacks (or holds with another size), then checks
    the size S3 reports. A failure is reported and the copy goes on."""
    report = Report()
    async for item in objects:
        try:
            if await s3_size(item.path) == item.size:
                report.skipped.append(item.path)
                continue
            await copy(item)
            if await s3_size(item.path) != item.size:
                raise storage.StorageError("size differs after the copy")
        except (storage.StorageError, httpx.HTTPError) as exc:
            logger.error("%s: %s", item.path, exc)
            report.failed.append(item.path)
        else:
            report.copied.append(item.path)
    return report


async def _list_supabase(  # pragma: no cover - real Storage HTTP only
    prefix: str, offset: int
) -> list[dict[str, Any]]:
    url = f"{settings.supabase_url}/storage/v1/object/list/{settings.storage_bucket}"
    body = {
        "prefix": prefix,
        "limit": PAGE_SIZE,
        "offset": offset,
        "sortBy": {"column": "name", "order": "asc"},
    }
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(url, headers=storage._headers(), json=body)
    if response.is_error:
        raise storage.StorageError(f"Supabase listing answered {response.status_code}")
    entries: list[dict[str, Any]] = response.json()
    return entries


async def _s3_size(path: str) -> int | None:  # pragma: no cover - real Storage HTTP only
    url = storage._s3_object_url(settings.s3_endpoint, path)
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.head(url, headers=storage.s3_signed_headers("HEAD", path))
    if response.status_code == 404:
        return None
    if response.is_error:
        raise storage.StorageError(f"S3 answered {response.status_code}")
    return int(response.headers["content-length"])


async def _copy(item: SourceObject) -> None:  # pragma: no cover - real Storage HTTP only
    data = await storage._read_limited(
        storage._object_url(item.path), storage._headers(), MAX_OBJECT_BYTES
    )
    await storage._s3_upload(item.path, data, item.content_type)


async def main() -> int:  # pragma: no cover - real Storage HTTP only
    """Copies, prints a summary and returns the exit code."""
    if not (settings.s3_endpoint and settings.supabase_url and settings.supabase_secret_key):
        print("Needs SUPABASE_URL, SUPABASE_SECRET_KEY and the S3_* settings.", file=sys.stderr)
        return 2
    report = await copy_missing(walk(_list_supabase), _s3_size, _copy)
    print(
        f"copied {len(report.copied)}, already there {len(report.skipped)}, "
        f"failed {len(report.failed)}"
    )
    for path in report.failed:
        print(f"failed: {path}", file=sys.stderr)
    return 1 if report.failed else 0


if __name__ == "__main__":  # pragma: no cover
    logging.basicConfig(level=logging.INFO)
    # One line per request would bury the summary.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    sys.exit(asyncio.run(main()))

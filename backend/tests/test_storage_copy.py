"""The copy from Supabase Storage to S3 (ticket 73 step 4): listing every
folder level and page, and copying only what S3 lacks. The HTTP is checked
live against Garage."""

from collections.abc import AsyncIterator
from typing import Any

import pytest

from app import storage_copy
from app.db import storage
from app.storage_copy import SourceObject


def file(name: str, size: int = 3, mimetype: str | None = "image/webp") -> dict[str, Any]:
    metadata = {"size": size} if mimetype is None else {"size": size, "mimetype": mimetype}
    return {"name": name, "id": f"id-{name}", "metadata": metadata}


def folder(name: str) -> dict[str, Any]:
    return {"name": name, "id": None, "metadata": None}


async def collect(objects: AsyncIterator[SourceObject]) -> list[SourceObject]:
    return [item async for item in objects]


async def test_walk_goes_into_folders_and_through_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(storage_copy, "PAGE_SIZE", 2)
    pages = {
        ("", 0): [folder("rooms"), file("top.png", 5, "image/png")],
        ("", 2): [file("last.pdf", 7, None)],
        ("rooms/", 0): [file("a.webp")],
    }
    asked: list[tuple[str, int]] = []

    async def list_page(prefix: str, offset: int) -> list[dict[str, Any]]:
        asked.append((prefix, offset))
        return pages[(prefix, offset)]

    found = await collect(storage_copy.walk(list_page))

    assert found == [
        SourceObject("rooms/a.webp", 3, "image/webp"),
        SourceObject("top.png", 5, "image/png"),
        SourceObject("last.pdf", 7, "application/octet-stream"),
    ]
    assert asked == [("", 0), ("rooms/", 0), ("", 2)]


async def objects(*items: SourceObject) -> AsyncIterator[SourceObject]:
    for item in items:
        yield item


async def test_only_missing_or_different_objects_are_copied() -> None:
    there = SourceObject("there.webp", 3, "image/webp")
    missing = SourceObject("missing.webp", 4, "image/webp")
    wrong_size = SourceObject("half.webp", 9, "image/webp")
    s3 = {"there.webp": 3, "half.webp": 1}
    copied: list[str] = []

    async def s3_size(path: str) -> int | None:
        return s3.get(path)

    async def copy(item: SourceObject) -> None:
        copied.append(item.path)
        s3[item.path] = item.size

    report = await storage_copy.copy_missing(objects(there, missing, wrong_size), s3_size, copy)

    assert copied == ["missing.webp", "half.webp"]
    assert report.copied == ["missing.webp", "half.webp"]
    assert report.skipped == ["there.webp"]
    assert report.failed == []


async def test_a_failed_or_short_copy_is_reported_and_the_rest_go_on() -> None:
    broken = SourceObject("broken.webp", 3, "image/webp")
    short = SourceObject("short.webp", 3, "image/webp")
    fine = SourceObject("fine.webp", 3, "image/webp")
    s3: dict[str, int] = {}

    async def s3_size(path: str) -> int | None:
        return s3.get(path)

    async def copy(item: SourceObject) -> None:
        if item.path == "broken.webp":
            raise storage.StorageError("Storage answered 500")
        s3[item.path] = 1 if item.path == "short.webp" else item.size

    report = await storage_copy.copy_missing(objects(broken, short, fine), s3_size, copy)

    assert report.failed == ["broken.webp", "short.webp"]
    assert report.copied == ["fine.webp"]

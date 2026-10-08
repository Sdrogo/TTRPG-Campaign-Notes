"""Image search over Openverse (spec 29): the query rule, how a raw Openverse
result becomes one the picker can show, and the per-user throttle that keeps
one tab from spending the server's shared quota. No I/O here; the HTTP call
lives in `app/db/openverse.py`."""

import time
import uuid
from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from app.domain.errors import DomainError

# Results per page. Openverse serves at most 20 to an anonymous client.
PAGE_SIZE = 20
# Openverse serves an anonymous client only the first 240 results
# (`page * page_size <= 240`), so pages past this are never asked for.
MAX_PAGE = 12
# The longest query accepted, in characters.
MAX_QUERY_LENGTH = 200
# Searches one user may run per `THROTTLE_WINDOW_SECONDS` (Decision 6).
THROTTLE_LIMIT = 30
THROTTLE_WINDOW_SECONDS = 60.0

# Where every thumbnail is loaded from (Decision 6): Openverse's own
# endpoint, never the upstream host, whatever the result says.
THUMBNAIL_URL = "https://api.openverse.org/v1/images/{id}/thumb/"

_LICENSE_NAMES = {
    "cc0": "CC0",
    "pdm": "Public Domain Mark",
}


class ImageSearchError(DomainError):
    """The search can't be run: an empty query, the throttle, or Openverse
    failing. The key is safe to translate and show."""


@dataclass(frozen=True)
class ImageResult:
    """One image the picker can show and import."""

    id: uuid.UUID
    thumbnail_url: str
    url: str
    width: int | None
    height: int | None
    title: str | None
    creator: str | None
    license: str | None
    license_url: str | None
    source_url: str | None


@dataclass(frozen=True)
class ImagePage:
    """A page of results, and whether a next one can be asked for."""

    results: list[ImageResult]
    page: int
    has_more: bool


def normalize_query(query: str) -> str:
    """The query as sent to Openverse: trimmed, inner whitespace collapsed.
    Nothing left is an error rather than a search for everything."""
    text = " ".join(query.split())
    if not text:
        raise ImageSearchError("errors.imageSearch.emptyQuery")
    return text


def _http_url(value: object) -> str | None:
    """`value` if it is an http(s) URL, else None: what Openverse sends is
    shown and followed, so anything else is dropped."""
    if isinstance(value, str) and value.startswith(("https://", "http://")):
        return value
    return None


def _text(value: object) -> str | None:
    """A non-empty string, trimmed, or None."""
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _size(value: object) -> int | None:
    """A positive pixel size, or None (bools are not sizes)."""
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return None


def license_label(code: object, version: object) -> str | None:
    """How a license reads in the picker: "CC BY-SA 4.0", "CC0 1.0",
    "Public Domain Mark 1.0"."""
    name = _text(code)
    if name is None:
        return None
    label = _LICENSE_NAMES.get(name.lower(), f"CC {name.upper()}")
    version_text = _text(version)
    return f"{label} {version_text}" if version_text else label


def parse_result(raw: Mapping[str, Any]) -> ImageResult | None:
    """One Openverse result, or None when it lacks what the picker needs (a
    valid id and an http(s) image URL) or is marked mature (Decision 6 asks
    Openverse for none; this drops any that slip through)."""
    try:
        image_id = uuid.UUID(str(raw.get("id")))
    except ValueError:
        return None
    url = _http_url(raw.get("url"))
    if url is None or raw.get("mature") is True:
        return None
    return ImageResult(
        id=image_id,
        thumbnail_url=THUMBNAIL_URL.format(id=image_id),
        url=url,
        width=_size(raw.get("width")),
        height=_size(raw.get("height")),
        title=_text(raw.get("title")),
        creator=_text(raw.get("creator")),
        license=license_label(raw.get("license"), raw.get("license_version")),
        license_url=_http_url(raw.get("license_url")),
        source_url=_http_url(raw.get("foreign_landing_url")),
    )


def parse_page(raw: Mapping[str, Any], page: int) -> ImagePage:
    """An Openverse response body as a page of results. A next page exists
    when Openverse counts more pages and `MAX_PAGE` isn't reached."""
    items = raw.get("results")
    results = [
        result
        for item in (items if isinstance(items, list) else [])
        if isinstance(item, Mapping) and (result := parse_result(item)) is not None
    ]
    page_count = raw.get("page_count")
    more = isinstance(page_count, int) and page < min(page_count, MAX_PAGE)
    return ImagePage(results=results, page=page, has_more=more)


class Throttle:
    """At most `limit` calls per `window` seconds for each key, counted in
    this process (Decision 6: one uvicorn process per environment, so the
    count is exact; it resets on deploy)."""

    def __init__(
        self,
        limit: int = THROTTLE_LIMIT,
        window: float = THROTTLE_WINDOW_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._limit = limit
        self._window = window
        self._clock = clock
        self._calls: dict[uuid.UUID, deque[float]] = {}

    def check(self, key: uuid.UUID) -> None:
        """Counts a call for `key`, or raises when its window is full (the
        refused call isn't counted)."""
        now = self._clock()
        calls = self._calls.setdefault(key, deque())
        while calls and calls[0] <= now - self._window:
            calls.popleft()
        if len(calls) >= self._limit:
            raise ImageSearchError("errors.imageSearch.throttled")
        calls.append(now)
        # Forget users idle for a whole window, so the map doesn't grow.
        for other in [k for k, v in self._calls.items() if not v or v[-1] <= now - self._window]:
            del self._calls[other]

    def reset(self) -> None:
        """Forgets every count (tests)."""
        self._calls.clear()

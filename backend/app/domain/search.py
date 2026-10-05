"""Full-text search in a Room (FR-N5, spec 21): how a query becomes a
Postgres prefix query, which kinds a request searches, how many results a kind
returns, and how an excerpt marked up by Postgres becomes plain text with
highlight offsets. Matching runs in SQL (`app/db/search_repo.py`); what the
viewer may see is decided by the visibility functions, after the match and
before any excerpt is built (VR-07, Invariant 1)."""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum

from app.domain.mentions import display_text


class SearchKind(StrEnum):
    """What a result is (spec 21 Decision 1). The Glossary joins once it
    exists."""

    DOCUMENT = "document"
    NOTE = "note"
    COMMENT = "comment"
    TAG = "tag"


# A query shorter than this, letters and digits only, finds nothing.
MIN_QUERY_LENGTH = 2
# Results per kind when the request names no limit (Decision 3), and the most
# it may ask for ("show more").
RESULTS_PER_KIND = 10
MAX_RESULTS_PER_KIND = 50
# The best-ranked matches per kind that go through the visibility check, so a
# two-letter prefix in a large Room stays cheap. A visible match ranked below
# this many others (hidden ones included) is not found until the query gets
# more specific. Only visible rows are paged and counted, so the cap reveals
# nothing about hidden content.
MAX_CANDIDATES_PER_KIND = 500

# The markers Postgres wraps a matched word in (`ts_headline`). Control
# characters, removed from the text beforehand, so they can't come from it.
START_MARK = "\x02"
STOP_MARK = "\x03"
_ELLIPSIS = "…"

# A search term: a run of letters and digits. Everything else separates
# terms, so nothing in a query can reach `to_tsquery`'s own syntax.
_TERM = re.compile(r"[^\W_]+")
_SPACES = re.compile(r"\s+")


def prefix_query(query: str) -> str | None:
    """`query` as a Postgres `to_tsquery` text: every term as a prefix
    (`dra:*` finds "drago"), all of them required. None when the terms add up
    to fewer than `MIN_QUERY_LENGTH` characters, so a stray letter doesn't
    list the whole Room (Decision 4)."""
    terms = _TERM.findall(query)
    if sum(len(term) for term in terms) < MIN_QUERY_LENGTH:
        return None
    return " & ".join(f"{term}:*" for term in terms)


def kinds_to_search(kind: SearchKind | None, filtered_by_tag: bool) -> set[SearchKind]:
    """The kinds a request searches: the one it names, or all of them. A Tag
    filter keeps results from the Documents carrying the Tags (Decision 6),
    which a Tag itself isn't, so it leaves Tags out."""
    kinds = set(SearchKind) if kind is None else {kind}
    if filtered_by_tag:
        kinds.discard(SearchKind.TAG)
    return kinds


def first_page[T](items: Sequence[T], limit: int) -> tuple[list[T], bool]:
    """The first `limit` of `items`, already filtered and ranked, and whether
    more were left out. Only visible results are ever counted, so `has_more`
    can't hint at hidden content (VR-07)."""
    return list(items[:limit]), len(items) > limit


def searchable_text(text: str) -> str:
    """`text` as the reader sees it, ready for an excerpt: mention tokens as
    their names (spec 20), whitespace collapsed, and the highlight markers
    removed so only Postgres can add them."""
    shown = display_text(text).replace(START_MARK, "").replace(STOP_MARK, "")
    return _SPACES.sub(" ", shown).strip()


@dataclass(frozen=True)
class Highlighted:
    """Text with the matched words marked as `(start, end)` offsets, end
    exclusive, counted in UTF-16 code units like a JavaScript string, so the
    client can slice it as is. Never HTML (spec 21_1)."""

    text: str
    highlights: tuple[tuple[int, int], ...]


def _utf16_length(text: str) -> int:
    """How long `text` is as a JavaScript string."""
    return len(text.encode("utf-16-le")) // 2


def read_headline(headline: str, source: str) -> Highlighted:
    """An excerpt `ts_headline` built from `source` (a `searchable_text`),
    with its markers turned into offsets. An ellipsis marks each end where
    the excerpt stops short of the text."""
    plain = headline.replace(START_MARK, "").replace(STOP_MARK, "").strip()
    prefix = "" if source.startswith(plain) else _ELLIPSIS + " "
    suffix = "" if source.endswith(plain) else " " + _ELLIPSIS

    highlights: list[tuple[int, int]] = []
    position = _utf16_length(prefix)
    start: int | None = None
    for part in re.split(f"([{START_MARK}{STOP_MARK}])", headline.strip()):
        if part == START_MARK:
            start = position
        elif part == STOP_MARK:
            if start is not None and position > start:
                highlights.append((start, position))
            start = None
        else:
            position += _utf16_length(part)
    return Highlighted(text=prefix + plain + suffix, highlights=tuple(highlights))

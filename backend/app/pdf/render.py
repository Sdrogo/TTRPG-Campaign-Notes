"""Typesets a `Manual` (spec 23b): Jinja renders one template per style to
HTML, WeasyPrint turns it into a PDF with CSS Paged Media (page counters, running
headers, page references).

The HTML never contains an author's markup: every name and text goes through
Jinja's autoescape. The renderer also fetches only what the pages need, so a
template can't be made to read anything else: its own stylesheets, fonts and
ornaments (under this package), `data:` URLs, and exactly the image links of the
`Manual`."""

import os
import uuid
from collections.abc import Collection, Mapping, Sequence
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.request import url2pathname

from jinja2 import Environment, FileSystemLoader

from app.domain.manual import Manual, ManualStyle, PageSize
from app.i18n.translator import DEFAULT_LOCALE, SUPPORTED_LOCALES

ASSETS_DIR = Path(__file__).resolve().parent
__all__ = [
    "ASSETS_DIR",
    "ManualStyle",
    "PageSize",
    "render_manual_html",
    "one_page",
    "page_pairs",
    "page_units",
    "side_by_side",
    "lower_priority",
    "render_manual_pdf",
    "url_allowed",
]


_ENVIRONMENT = Environment(
    loader=FileSystemLoader(ASSETS_DIR / "templates"),
    autoescape=True,
    trim_blocks=True,
    lstrip_blocks=True,
)


def render_manual_html(
    manual: Manual,
    style: ManualStyle,
    page_size: PageSize,
    locale: str = DEFAULT_LOCALE,
    shared: Collection[uuid.UUID] = frozenset(),
    single: Collection[uuid.UUID] = frozenset(),
    beside: Collection[uuid.UUID] = frozenset(),
) -> str:
    """The manual as one HTML document in `style`, linking its stylesheets
    relative to this package (`ASSETS_DIR` is the base URL when it is turned
    into a PDF). `locale` sets the page language, which hyphenation follows.

    The Documents in `single` are set in one column instead of two; one in
    `beside` (also in `single`, after another of them) takes the column next to
    the one before it. A page unit (a Document in two columns, or a row of one
    or two in one column) whose first Document is in `shared` continues the
    page of the one before it instead of starting a new one."""
    template = _ENVIRONMENT.get_template(f"{style.value}.html.j2")
    lang = locale if locale in SUPPORTED_LOCALES else DEFAULT_LOCALE
    return template.render(
        manual=manual,
        style=style.value,
        page_size=page_size.value,
        lang=lang,
        shared=frozenset(shared),
        single=frozenset(single),
        beside=frozenset(beside),
    ).lstrip()


Unit = tuple[str, ...]
"""The anchors of what starts a page together: one Document in two columns, or
a row of one or two Documents in one column each."""


def page_units(manual: Manual, beside: Collection[uuid.UUID]) -> list[list[Unit]]:
    """Each chapter's units in page order: a Document in `beside` joins the
    unit of the one before it."""
    chapters: list[list[Unit]] = []
    for chapter in manual.chapters:
        units: list[Unit] = []
        for document in chapter.documents:
            if document.id in beside and units:
                units[-1] = (*units[-1], document.anchor)
            else:
                units.append((document.anchor,))
        chapters.append(units)
    return chapters


def side_by_side(manual: Manual, single: Collection[uuid.UUID]) -> set[uuid.UUID]:
    """The Documents that take the right column of a row: of two neighbours of
    one chapter that each fit one column (`single`), the second, paired left to
    right so a row holds two at most."""
    beside: set[uuid.UUID] = set()
    for chapter in manual.chapters:
        alone = False  # the row before holds one Document in one column
        for document in chapter.documents:
            if document.id in single and alone:
                beside.add(document.id)
                alone = False
            else:
                alone = document.id in single
    return beside


def one_page(unit: Unit, spans: Mapping[str, tuple[int, int]]) -> int | None:
    """The page every Document of `unit` starts and ends on, or None when the
    unit takes more than one (or an anchor isn't laid out). `spans` maps an
    anchor to the first and last page it is on."""
    pages = {spans.get(anchor) for anchor in unit}
    if len(pages) != 1:
        return None
    (span,) = pages
    if span is None or span[0] != span[1]:
        return None
    return span[0]


def _pair_fits(
    unit: Unit, position: int, spans: Mapping[str, tuple[int, int]], chapter: tuple[int, int] | None
) -> bool:
    """Whether a row of two (`unit`, the `position`th of its chapter, which
    starts on `chapter`'s first page) is on one page. A row never breaks, so a
    first one too tall for what the chapter title leaves moves to the next
    page, which counts as spilling."""
    page = one_page(unit, spans)
    return page is not None and (position > 0 or (chapter is not None and page == chapter[0]))


def page_pairs(
    chapters: Sequence[Sequence[Unit]], spans: Mapping[str, tuple[int, int]]
) -> list[tuple[Unit, Unit]]:
    """The units that could share a page, from a layout where each starts its
    own: two neighbours of one chapter that each took a single page, paired
    left to right so a unit is in one pair at most. `chapters` is
    `page_units`'s."""
    pairs: list[tuple[Unit, Unit]] = []
    for units in chapters:
        position = 0
        while position + 1 < len(units):
            first, second = units[position], units[position + 1]
            if one_page(first, spans) is not None and one_page(second, spans) is not None:
                pairs.append((first, second))
                position += 2
            else:
                position += 1
    return pairs


def url_allowed(url: str, image_urls: Collection[str], media_dir: Path | None = None) -> bool:
    """Whether the renderer may fetch `url`: a `data:` URL, a file inside
    `ASSETS_DIR` or `media_dir` (the folder a job put its downscaled images in),
    or one of `image_urls` exactly (compared as parsed URLs, so a re-serialized
    query doesn't matter). Anything else, an `http://` address or a `file:` path
    elsewhere included, is refused."""
    parts = urlsplit(url)
    if parts.scheme.lower() == "data":
        return True
    if parts.scheme.lower() == "file":
        path = Path(url2pathname(parts.path)).resolve()
        return path.is_relative_to(ASSETS_DIR) or (
            media_dir is not None and path.is_relative_to(media_dir.resolve())
        )
    return parts.geturl() in {urlsplit(image).geturl() for image in image_urls}


def _fetcher(image_urls: Collection[str], media_dir: Path | None = None) -> Any:
    """A WeasyPrint URL fetcher that applies `url_allowed`. WeasyPrint is
    imported here, not at module level, so importing the app never needs
    Pango (a refused URL is logged by WeasyPrint and left out of the page)."""
    from weasyprint import URLFetcher

    class ManualFetcher(URLFetcher):  # type: ignore[misc]
        """`URLFetcher` limited to the URLs the manual needs."""

        def fetch(self, url: str, headers: Any = None) -> Any:
            """Fetches `url` or raises `ValueError` when it isn't allowed."""
            if not url_allowed(url, image_urls, media_dir):
                raise ValueError(f"URL not allowed in the Room PDF: {url}")
            return super().fetch(url, headers)

    # No redirects: `fetch` checks the URL it is given, so following one
    # would let an allowed link lead to a host that isn't.
    return ManualFetcher(
        timeout=20, allowed_protocols=("file", "https", "data"), allow_redirects=False
    )


def lower_priority() -> None:
    """Makes the calling process yield the CPU to the API (initializer of the
    process that typesets a Room PDF, which keeps a core busy for minutes)."""
    try:
        os.nice(10)
    except (AttributeError, OSError):
        pass


def render_manual_pdf(
    manual: Manual,
    style: ManualStyle,
    page_size: PageSize,
    locale: str = DEFAULT_LOCALE,
    media_dir: Path | None = None,
) -> bytes:
    """The manual as PDF bytes. CPU-bound and blocking: a caller on the event
    loop runs it in a thread. Images may be `file:` URLs inside `media_dir`,
    which keeps them out of the HTML (a big Room's images as `data:` URLs took
    over a gigabyte of memory).

    A Document that fits in one column is set in one column, and two such
    neighbours sit side by side (product owner, 2026-10-19); two short page
    units share a page when together they fit on it (product owner,
    2026-10-06). Only a layout can tell, so the manual is laid out with every
    Document alone in one column on its own page, to see which fit; then with
    those rows and the other Documents in two columns, a page each; then with
    the units that each took one page paired on one page, a row that spilled
    split in two; and a pair that no longer fits on one page is split again in
    a last layout. Each unit and pair starts its own page, so splitting one
    never moves another."""
    from weasyprint import HTML

    def layout(
        single: Collection[uuid.UUID],
        beside: Collection[uuid.UUID],
        shared: Collection[uuid.UUID] = frozenset(),
    ) -> Any:
        html = render_manual_html(manual, style, page_size, locale, shared, single, beside)
        return HTML(
            string=html,
            base_url=ASSETS_DIR.as_uri() + "/",
            url_fetcher=_fetcher(manual.image_urls, media_dir),
        ).render()

    def anchor_spans(document: Any) -> dict[str, tuple[int, int]]:
        spans: dict[str, tuple[int, int]] = {}
        for number, page in enumerate(document.pages):
            for anchor in page.anchors:
                spans[anchor] = (spans.get(anchor, (number, number))[0], number)
        return spans

    ids = {
        document.anchor: document.id
        for chapter in manual.chapters
        for document in chapter.documents
    }
    spans = anchor_spans(layout(set(ids.values()), frozenset()))
    single = {ids[anchor] for anchor in ids if one_page((anchor,), spans) is not None}
    beside = side_by_side(manual, single)
    document = layout(single, beside)
    spans = anchor_spans(document)
    spilled = {
        ids[unit[1]]
        for chapter, units in zip(manual.chapters, page_units(manual, beside), strict=True)
        for position, unit in enumerate(units)
        if len(unit) == 2 and not _pair_fits(unit, position, spans, spans.get(chapter.id))
    }
    pairs = page_pairs(page_units(manual, beside), spans)
    if pairs or spilled:
        beside -= spilled
        document = layout(single, beside, {ids[second[0]] for _first, second in pairs})
        spans = anchor_spans(document)
        kept = [pair for pair in pairs if one_page((*pair[0], *pair[1]), spans) is not None]
        if len(kept) < len(pairs):
            document = layout(single, beside, {ids[second[0]] for _first, second in kept})
    pdf: bytes = document.write_pdf()
    return pdf

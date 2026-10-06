"""Typesets a `Manual` (spec 23b): Jinja renders one template per style to
HTML, WeasyPrint turns it into a PDF with CSS Paged Media (page counters, running
headers, page references).

The HTML never contains an author's markup: every name and text goes through
Jinja's autoescape. The renderer also fetches only what the pages need, so a
template can't be made to read anything else: its own stylesheets, fonts and
ornaments (under this package), `data:` URLs, and exactly the image links of the
`Manual`."""

import uuid
from collections.abc import Collection, Mapping, Sequence
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.request import url2pathname

from jinja2 import Environment, FileSystemLoader

from app.domain.manual import Manual, ManualDocument, ManualStyle, PageSize
from app.i18n.translator import DEFAULT_LOCALE, SUPPORTED_LOCALES

ASSETS_DIR = Path(__file__).resolve().parent
__all__ = [
    "ASSETS_DIR",
    "ManualStyle",
    "PageSize",
    "render_manual_html",
    "page_pairs",
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
) -> str:
    """The manual as one HTML document in `style`, linking its stylesheets
    relative to this package (`ASSETS_DIR` is the base URL when it is turned
    into a PDF). `locale` sets the page language, which hyphenation follows.
    The Documents in `shared` continue the page of the one before them instead
    of starting a new one."""
    template = _ENVIRONMENT.get_template(f"{style.value}.html.j2")
    lang = locale if locale in SUPPORTED_LOCALES else DEFAULT_LOCALE
    return template.render(
        manual=manual,
        style=style.value,
        page_size=page_size.value,
        lang=lang,
        shared=frozenset(shared),
    ).lstrip()


def _page_order(manual: Manual) -> list[tuple[str, list[str]]]:
    """Each chapter's anchor with the anchors of the Documents printed in it,
    in page order. The glossary closes the list as a chapter of its own."""
    order = [
        (chapter.id, [document.anchor for document in chapter.documents])
        for chapter in manual.chapters
    ]
    return [*order, ("glossary", [])]


def _following(order: Sequence[tuple[str, Sequence[str]]]) -> dict[str, str]:
    """Each anchor of `order` mapped to the one after it."""
    starts = [anchor for chapter, documents in order for anchor in (chapter, *documents)]
    return dict(zip(starts, starts[1:], strict=False))


def page_pairs(
    order: Sequence[tuple[str, Sequence[str]]], pages: Mapping[str, int]
) -> list[tuple[str, str]]:
    """The Documents that could share a page, from a layout where each starts
    its own: two neighbours of one chapter that each took a single page, paired
    left to right so a Document is in one pair at most. `order` is
    `_page_order`'s; `pages` maps an anchor to the page it is on (an anchor
    that isn't there, a glossary without entries, ends nothing)."""
    following = _following(order)

    def single_page(anchor: str) -> bool:
        after = following.get(anchor)
        return after is not None and pages.get(after) == pages[anchor] + 1

    pairs: list[tuple[str, str]] = []
    for _chapter, documents in order:
        position = 0
        while position + 1 < len(documents):
            first, second = documents[position], documents[position + 1]
            if single_page(first) and single_page(second):
                pairs.append((first, second))
                position += 2
            else:
                position += 1
    return pairs


def _shares_one_page(pair: tuple[str, str], following: str, pages: Mapping[str, int]) -> bool:
    """Whether, laid out together, `pair` ended up on one page with `following`
    (the next anchor) starting the page after it."""
    first, second = pair
    return pages[second] == pages[first] and pages.get(following) == pages[first] + 1


def url_allowed(url: str, image_urls: Collection[str]) -> bool:
    """Whether the renderer may fetch `url`: a `data:` URL, a file inside
    `ASSETS_DIR`, or one of `image_urls` exactly (compared as parsed URLs, so a
    re-serialized query doesn't matter). Anything else, an `http://` address or a
    `file:` path elsewhere included, is refused."""
    parts = urlsplit(url)
    if parts.scheme.lower() == "data":
        return True
    if parts.scheme.lower() == "file":
        return Path(url2pathname(parts.path)).resolve().is_relative_to(ASSETS_DIR)
    return parts.geturl() in {urlsplit(image).geturl() for image in image_urls}


def _fetcher(image_urls: Collection[str]) -> Any:
    """A WeasyPrint URL fetcher that applies `url_allowed`. WeasyPrint is
    imported here, not at module level, so importing the app never needs
    Pango (a refused URL is logged by WeasyPrint and left out of the page)."""
    from weasyprint import URLFetcher

    class ManualFetcher(URLFetcher):  # type: ignore[misc]
        """`URLFetcher` limited to the URLs the manual needs."""

        def fetch(self, url: str, headers: Any = None) -> Any:
            """Fetches `url` or raises `ValueError` when it isn't allowed."""
            if not url_allowed(url, image_urls):
                raise ValueError(f"URL not allowed in the Room PDF: {url}")
            return super().fetch(url, headers)

    # No redirects: `fetch` checks the URL it is given, so following one
    # would let an allowed link lead to a host that isn't.
    return ManualFetcher(
        timeout=20, allowed_protocols=("file", "https", "data"), allow_redirects=False
    )


def render_manual_pdf(
    manual: Manual, style: ManualStyle, page_size: PageSize, locale: str = DEFAULT_LOCALE
) -> bytes:
    """The manual as PDF bytes. CPU-bound and blocking: a caller on the event
    loop runs it in a thread.

    Two short Documents share a page when together they fit on it (product
    owner, 2026-10-06). Only a layout can tell, so the manual is laid out with
    a page per Document, then again with the pairs that each took one page
    joined; a pair that no longer fits on one page is split again in a last
    layout. Each pair starts its own page, so splitting one never moves
    another."""
    from weasyprint import HTML

    def layout(shared: Collection[uuid.UUID]) -> Any:
        html = render_manual_html(manual, style, page_size, locale, shared)
        return HTML(
            string=html,
            base_url=ASSETS_DIR.as_uri() + "/",
            url_fetcher=_fetcher(manual.image_urls),
        ).render()

    def anchor_pages(document: Any) -> dict[str, int]:
        return {
            anchor: number for number, page in enumerate(document.pages) for anchor in page.anchors
        }

    ids = {
        entry.anchor: entry.id
        for chapter in manual.chapters
        for entry in chapter.entries
        if isinstance(entry, ManualDocument)
    }
    order = _page_order(manual)
    document = layout(frozenset())
    pairs = page_pairs(order, anchor_pages(document))
    if pairs:
        document = layout({ids[second] for _first, second in pairs})
        pages = anchor_pages(document)
        following = _following(order)
        kept = [pair for pair in pairs if _shares_one_page(pair, following[pair[1]], pages)]
        if len(kept) < len(pairs):
            document = layout({ids[second] for _first, second in kept})
    pdf: bytes = document.write_pdf()
    return pdf

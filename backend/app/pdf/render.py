"""Typesets a `Manual` (spec 23b): Jinja renders one template per style to
HTML, WeasyPrint turns it into a PDF with CSS Paged Media (page counters, running
headers, page references).

The HTML never contains an author's markup: every name and text goes through
Jinja's autoescape. The renderer also fetches only what the pages need, so a
template can't be made to read anything else: its own stylesheets, fonts and
ornaments (under this package), `data:` URLs, and exactly the image links of the
`Manual`."""

from collections.abc import Collection
from enum import StrEnum
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.request import url2pathname

from jinja2 import Environment, FileSystemLoader

from app.domain.manual import Manual
from app.i18n.translator import DEFAULT_LOCALE, SUPPORTED_LOCALES

ASSETS_DIR = Path(__file__).resolve().parent


class ManualStyle(StrEnum):
    """The built-in looks (spec 23b Decision 4), in the order they were built.
    Each has a template `<value>.html.j2` and a stylesheet `<value>.css`."""

    GOTHIC = "gothic"
    MODERN = "modern"
    PRINT = "print"


class PageSize(StrEnum):
    """The paper sizes (Decision 5); the value is the CSS `size` keyword."""

    A4 = "A4"
    LETTER = "Letter"


_ENVIRONMENT = Environment(
    loader=FileSystemLoader(ASSETS_DIR / "templates"),
    autoescape=True,
    trim_blocks=True,
    lstrip_blocks=True,
)


def render_manual_html(
    manual: Manual, style: ManualStyle, page_size: PageSize, locale: str = DEFAULT_LOCALE
) -> str:
    """The manual as one HTML document in `style`, linking its stylesheets
    relative to this package (`ASSETS_DIR` is the base URL when it is turned
    into a PDF). `locale` sets the page language, which hyphenation follows."""
    template = _ENVIRONMENT.get_template(f"{style.value}.html.j2")
    lang = locale if locale in SUPPORTED_LOCALES else DEFAULT_LOCALE
    return template.render(
        manual=manual, style=style.value, page_size=page_size.value, lang=lang
    ).lstrip()


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

    return ManualFetcher(timeout=20, allowed_protocols=("file", "https", "data"))


def render_manual_pdf(
    manual: Manual, style: ManualStyle, page_size: PageSize, locale: str = DEFAULT_LOCALE
) -> bytes:
    """The manual as PDF bytes. CPU-bound and blocking: a caller on the event
    loop runs it in a thread."""
    from weasyprint import HTML

    html = render_manual_html(manual, style, page_size, locale)
    document = HTML(
        string=html,
        base_url=ASSETS_DIR.as_uri() + "/",
        url_fetcher=_fetcher(manual.image_urls),
    )
    pdf: bytes = document.write_pdf()
    return pdf

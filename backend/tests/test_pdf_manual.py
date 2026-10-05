"""The Room PDF's typesetting (spec 23b): the three styles' templates and
stylesheets, what the renderer may fetch, and a smoke render of a small Room to
a PDF. The HTML tests need no system library; the PDF test, like the one in
`test_pdf_rendering.py`, is skipped where Pango is missing and fails in CI
(`REQUIRE_WEASYPRINT=1`) instead of skipping."""

import importlib
import io
import os
import re
from dataclasses import replace
from typing import Any

import pytest
from manual_fixtures import (
    ALICE,
    CASTLE,
    IRENA,
    LABELS,
    comment,
    document,
    make_export,
    text,
)
from pypdf import PdfReader

from app.domain.export import ExportImage
from app.domain.manual import Manual, ManualOptions, build_manual
from app.pdf.labels import manual_labels
from app.pdf.render import (
    ASSETS_DIR,
    ManualStyle,
    PageSize,
    _fetcher,
    render_manual_html,
    render_manual_pdf,
    url_allowed,
)

# A 1x1 PNG, so a PDF can hold an image without the network.
PIXEL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg=="
)


def _manual(**options: Any) -> Manual:
    return build_manual(make_export(), ManualOptions(**options), LABELS)


@pytest.mark.parametrize("style", list(ManualStyle))
@pytest.mark.parametrize("size", list(PageSize))
def test_every_style_and_size_renders_the_whole_structure(
    style: ManualStyle, size: PageSize
) -> None:
    html = render_manual_html(_manual(include_comments=True), style, size)

    assert html.startswith("<!doctype html>")
    assert f"@page {{ size: {size.value}; }}" in html
    assert f'href="styles/{style.value}.css"' in html
    for expected in (
        'class="cover-title">Barovia<',
        "Contents",
        'id="chapter-1"',
        'id="chapter-3"',
        f'id="doc-{CASTLE}"',
        'class="note"',
        'id="index"',
    ):
        assert expected in html
    # A mention printed with its page: the link and the localized "p.".
    assert f'href="#doc-{IRENA}" data-page="p."' in html


def test_only_the_gothic_cover_carries_the_original_ornament() -> None:
    manual = _manual()

    assert "cover-ornament" in render_manual_html(manual, ManualStyle.GOTHIC, PageSize.A4)
    assert "cover-ornament" not in render_manual_html(manual, ManualStyle.MODERN, PageSize.A4)
    assert "cover-ornament" not in render_manual_html(manual, ManualStyle.PRINT, PageSize.A4)


def test_text_is_escaped_and_paragraphs_stay_on_one_line() -> None:
    export = make_export(
        room_name="<script>alert(1)</script>",
        documents=[
            document(
                CASTLE,
                "A & B",
                description=(text("one <b>two</b>\n\nthree"),),
                comments=(comment(1, ALICE, "<i>x</i>"),),
            )
        ],
    )
    html = render_manual_html(
        build_manual(export, ManualOptions(include_comments=True), LABELS),
        ManualStyle.PRINT,
        PageSize.A4,
    )

    assert "<script>" not in html and "<b>" not in html and "<i>" not in html
    assert "&lt;script&gt;" in html and "A &amp; B" in html
    # The CSS keeps line breaks inside <p>, so markup mustn't add any.
    assert "<p>one &lt;b&gt;two&lt;/b&gt;</p>" in html
    assert "<p>three</p>" in html


def test_a_reference_and_the_index_link_to_where_the_document_is_printed() -> None:
    html = render_manual_html(_manual(), ManualStyle.MODERN, PageSize.A4)

    assert f'<a class="xref" href="#doc-{CASTLE}" data-page="p.">Castle</a>' in html
    assert f'<a class="index-link" href="#doc-{CASTLE}">Castle</a>' in html


def test_the_language_follows_the_requester_with_english_as_the_fallback() -> None:
    manual = _manual()

    assert '<html lang="it">' in render_manual_html(manual, ManualStyle.PRINT, PageSize.A4, "it")
    assert '<html lang="en">' in render_manual_html(manual, ManualStyle.PRINT, PageSize.A4, "fr")


def test_the_labels_follow_the_locale_and_keep_the_comment_template() -> None:
    english, italian = manual_labels("en"), manual_labels("it")

    assert (english.contents, english.index, english.other) == ("Contents", "Index", "Other")
    assert (italian.contents, italian.index, italian.other) == (
        "Indice",
        "Indice analitico",
        "Altro",
    )
    assert manual_labels("fr") == english
    for labels in (english, italian):
        assert "{character}" in labels.played_by and "{player}" in labels.played_by


@pytest.mark.parametrize("style", list(ManualStyle))
def test_every_style_has_its_files_and_every_font_it_names_is_bundled(style: ManualStyle) -> None:
    assert (ASSETS_DIR / "templates" / f"{style.value}.html.j2").is_file()
    css = (ASSETS_DIR / "styles" / f"{style.value}.css").read_text(encoding="utf-8")
    fonts = re.findall(r"url\(\.\./fonts/([^)]+)\)", css)

    assert fonts or style is ManualStyle.PRINT
    for name in fonts:
        assert (ASSETS_DIR / "fonts" / name).is_file(), name
    # No font or stylesheet is loaded from the web (spec 23b Backend).
    assert "http" not in css


def test_each_bundled_family_ships_its_license() -> None:
    licenses = {p.name for p in (ASSETS_DIR / "fonts").glob("OFL-*.txt")}

    assert licenses == {"OFL-imfellenglish.txt", "OFL-crimsontext.txt", "OFL-lato.txt"}


def test_the_renderer_fetches_its_own_files_data_urls_and_the_manuals_images_only() -> None:
    images = {"https://storage.example/img/1.webp?token=a&download=x"}

    assert url_allowed((ASSETS_DIR / "styles" / "base.css").as_uri(), images)
    assert url_allowed((ASSETS_DIR / "fonts" / "Lato-Bold.ttf").as_uri(), images)
    assert url_allowed("data:image/png;base64,AAAA", images)
    assert url_allowed("DATA:text/plain,hi", images)
    assert url_allowed("https://storage.example/img/1.webp?token=a&download=x", images)

    assert not url_allowed("https://storage.example/img/2.webp", images)
    assert not url_allowed("https://storage.example/img/1.webp?token=b", images)
    assert not url_allowed("http://169.254.169.254/latest/meta-data", images)
    assert not url_allowed("file:///etc/passwd", images)
    assert not url_allowed((ASSETS_DIR.parent / "main.py").as_uri(), images)
    assert not url_allowed((ASSETS_DIR / ".." / "main.py").as_uri(), images)
    assert not url_allowed("ftp://example.com/x", images)


def _weasyprint() -> Any:
    """The `weasyprint` module, or a skip (a fail in CI) without its system
    libraries."""
    try:
        return importlib.import_module("weasyprint")
    except (ImportError, OSError) as exc:
        if os.environ.get("REQUIRE_WEASYPRINT"):
            pytest.fail(f"WeasyPrint can't load its system libraries: {exc}")
        pytest.skip(f"WeasyPrint's system libraries are not installed: {exc}")


def _small_room() -> Manual:
    """The fixture Room with an image on Castle (a data URL, so no network)
    and an accented name, to see the fonts carry Italian."""
    export = make_export()
    castle, irena, orphan = export.documents
    castle = replace(castle, images=(ExportImage(castle.images[0].id, PIXEL, True),))
    orphan = replace(orphan, description=(text("Città dell'Ovest, perché sì."),))
    export = replace(export, documents=[castle, irena, orphan])
    return build_manual(export, ManualOptions(cover_document_id=CASTLE), LABELS)


def _page_with(reader: PdfReader, needle: str, after: int = 2) -> int:
    """The 1-based number of the first page from `after` on (0-based) that
    holds `needle`."""
    for number in range(after, len(reader.pages)):
        if needle in reader.pages[number].extract_text():
            return number + 1
    raise AssertionError(f"{needle!r} is on no page")


@pytest.mark.parametrize("style", list(ManualStyle))
@pytest.mark.parametrize("size", list(PageSize))
def test_a_small_room_renders_to_a_pdf_whose_page_references_are_right(
    style: ManualStyle, size: PageSize
) -> None:
    _weasyprint()

    pdf = render_manual_pdf(_small_room(), style, size)

    reader = PdfReader(io.BytesIO(pdf))
    # Cover, contents, one page per chapter (three) and the index.
    assert len(reader.pages) == 6
    width_pt, height_pt = (
        float(reader.pages[0].mediabox.width),
        float(reader.pages[0].mediabox.height),
    )
    assert (round(width_pt), round(height_pt)) == (
        (595, 842) if size is PageSize.A4 else (612, 792)
    )
    assert "Barovia" in reader.pages[0].extract_text()

    contents = reader.pages[1].extract_text()
    for word in ("Contents", "Castle", "Irena", "NPC", "Place", "Other", "Index"):
        assert word in contents
    # The contents say on which page each Document starts: where its text is.
    castle_page = _page_with(reader, "Ruled by")
    irena_page = _page_with(reader, "A vampire.")
    listed = {
        name: int(re.findall(r"\d+", line)[-1])
        for line in contents.splitlines()
        for name in ("Castle", "Irena")
        if line.strip().startswith(name)
    }
    assert listed == {"Castle": castle_page, "Irena": irena_page}

    # A mention and the repeat in the Place chapter say the same page.
    assert re.search(
        rf"Irena\s*→\s*p\.\s*{irena_page}\b", reader.pages[castle_page - 1].extract_text()
    )
    place = reader.pages[3].extract_text()
    assert re.search(rf"Castle\s*→\s*p\.\s*{castle_page}\b", place)
    # The Tag index points at the same pages, and the accents survived.
    index = reader.pages[-1].extract_text()
    assert re.search(rf"Castle,\s*{castle_page}\b", index)
    assert "Città dell'Ovest, perché sì." in " ".join(p.extract_text() for p in reader.pages)


def test_the_fetcher_refuses_what_the_renderer_may_not_read(tmp_path: Any) -> None:
    """Even a `file:` image the Manual names is refused when it lies outside
    the package, and a link it doesn't name is never opened."""
    _weasyprint()
    secret = tmp_path / "secret.png"
    secret.write_bytes(b"not an image")
    fetcher = _fetcher({secret.as_uri(), "https://storage.example/img/1.webp"})

    for url in (secret.as_uri(), "https://storage.example/other.webp", "http://localhost:1/x"):
        with pytest.raises(ValueError, match="not allowed"):
            fetcher.fetch(url)
    assert fetcher.fetch((ASSETS_DIR / "styles" / "base.css").as_uri()).read()

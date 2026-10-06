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
from urllib.request import HTTPRedirectHandler

import pytest
from manual_fixtures import (
    ALICE,
    CASTLE,
    IRENA,
    LABELS,
    PLACE,
    comment,
    document,
    make_export,
    text,
    uid,
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
    page_pairs,
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
        'id="glossary"',
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


def test_a_reference_and_the_glossary_link_to_where_the_document_is_printed() -> None:
    html = render_manual_html(_manual(), ManualStyle.MODERN, PageSize.A4)

    assert f'<a class="xref" href="#doc-{CASTLE}" data-page="p.">Castle</a>' in html
    assert (
        f'<a class="glossary-link" href="#doc-{CASTLE}"><span class="glossary-name">Castle</span>'
        '<span class="glossary-tags"> · NPC, Place</span></a>'
    ) in html
    # A Document without Tags prints its name alone.
    assert '<span class="glossary-name">Orphan</span></a>' in html


def test_the_documents_of_a_chapter_sit_under_its_title_after_its_references() -> None:
    # Place gets a Document of its own (Abbey, before "Castle" by name), so its
    # chapter holds a Document as well as the reference to Castle.
    export = make_export()
    abbey = document(uid(34), "Abbey", (PLACE,), description=(text("Ruined."),))
    export = replace(export, documents=[*export.documents, abbey])
    manual = build_manual(export, ManualOptions(), LABELS)
    html = render_manual_html(manual, ManualStyle.GOTHIC, PageSize.A4)

    # The title is outside, so a style can set each Document in columns while it
    # still spans the page.
    assert html.count('class="chapter-body"') == 3
    assert html.index('class="chapter-title"') < html.index('class="chapter-body"')
    assert html.index('class="chapter-body"') < html.index(f'id="doc-{CASTLE}"')
    # A chapter's references come before its Documents, so each Document can
    # end its page without leaving a reference alone on the next one.
    mixed = [
        chapter
        for chapter in html.split('<section class="chapter"')[1:]
        if 'class="references"' in chapter and 'class="document"' in chapter
    ]
    assert len(mixed) == 1
    assert mixed[0].index('class="references"') < mixed[0].index('class="document"')
    # No rule closes a chapter: the page break does.
    assert "chapter-end" not in html


def test_notes_read_as_more_of_the_description() -> None:
    """A Note is a subheading and paragraphs after the description, not a
    sidebar: no style gives it a box, a tint or italics."""
    html = render_manual_html(_manual(), ManualStyle.GOTHIC, PageSize.A4)

    assert '<section class="note">' in html and "<aside" not in html
    for style in ManualStyle:
        css = (ASSETS_DIR / "styles" / f"{style.value}.css").read_text(encoding="utf-8")
        for body in re.findall(r"^\.note\s*\{([^}]*)\}", css, re.M):
            assert not re.search(r"background|border|font-style|padding", body), style


def test_comments_close_a_document_as_boxed_sidebars() -> None:
    """Comments come last in a Document and every style draws each one as a
    box (the look Notes had before, product owner 2026-10-06)."""
    export = make_export()
    castle, *others = export.documents
    castle = replace(castle, comments=(comment(1, ALICE, "Creepy."),))
    export = replace(export, documents=[castle, *others])
    manual = build_manual(export, ManualOptions(include_comments=True), LABELS)
    html = render_manual_html(manual, ManualStyle.GOTHIC, PageSize.A4)

    castle_html = html[html.index(f'id="doc-{CASTLE}"') :]
    castle_html = castle_html[: castle_html.index("</article>")]
    assert castle_html.index('class="note"') < castle_html.index('class="comments"')
    for style in ManualStyle:
        css = (ASSETS_DIR / "styles" / f"{style.value}.css").read_text(encoding="utf-8")
        box = re.search(r"^\.comment\s*\{([^}]*)\}", css, re.M)
        assert box is not None and "border" in box.group(1), style


@pytest.mark.parametrize("style", list(ManualStyle))
def test_every_style_draws_its_header_rule_across_the_page(style: ManualStyle) -> None:
    """The running header's rule, where a style draws one, runs under both
    margin boxes with the same border, so it is one line across the page
    instead of a shorter one at another height."""
    css = (ASSETS_DIR / "styles" / f"{style.value}.css").read_text(encoding="utf-8")

    boxes = dict(re.findall(r"@(top-left|top-right)\s*\{([^}]*)\}", css))
    borders = {name: re.findall(r"border-bottom:[^;]*;", body) for name, body in boxes.items()}
    assert borders["top-left"] == borders["top-right"], style
    for body in boxes.values():
        if "border-bottom" in body:
            assert "width: 50%" in body, style


def test_every_style_sets_each_document_on_its_own_pages_in_two_balanced_columns() -> None:
    """Spec 23b: rulebook-like two columns, balanced on a Document's last page
    (WeasyPrint fills each page in turn and balances only the last one), and
    every Document after the first of a chapter starts a new page (product
    owner, 2026-10-06) unless the renderer lets it share one. Set once in
    `base.css`; no style may go back to one column."""
    styles = ASSETS_DIR / "styles"
    base = (styles / "base.css").read_text("utf-8")
    rule = re.search(r"^\.document\s*\{([^}]*)\}", base, re.M)

    assert rule is not None
    assert "columns: 2" in rule.group(1) and "column-fill: balance" in rule.group(1)
    assert re.search(r"^\.document \+ \.document\s*\{\s*break-before: page;", base, re.M)
    assert re.search(
        r"^\.document \+ \.document\.shares-page\s*\{\s*break-before: auto;", base, re.M
    )
    for style in ManualStyle:
        css = (styles / f"{style.value}.css").read_text(encoding="utf-8")
        assert not re.search(r"column-count:\s*1|columns:\s*1|column-fill:\s*auto", css), style


def test_the_language_follows_the_requester_with_english_as_the_fallback() -> None:
    manual = _manual()

    assert '<html lang="it">' in render_manual_html(manual, ManualStyle.PRINT, PageSize.A4, "it")
    assert '<html lang="en">' in render_manual_html(manual, ManualStyle.PRINT, PageSize.A4, "fr")


def test_the_labels_follow_the_locale_and_keep_the_comment_template() -> None:
    english, italian = manual_labels("en"), manual_labels("it")

    assert (english.contents, english.glossary, english.other) == ("Contents", "Glossary", "Other")
    assert (italian.contents, italian.glossary, italian.other) == ("Indice", "Glossario", "Altro")
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
    # Cover, contents, one page for the NPC chapter (Castle and Irena are short
    # enough to share it), one for the Place chapter's reference, one for Other
    # (Orphan), and the glossary.
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
    for word in ("Contents", "Castle", "Irena", "NPC", "Place", "Other", "Glossary"):
        assert word in contents
    # (Gothic sets the first letter of a description as a large initial, a separate
    # piece of text, so these searches skip it.)
    # The contents say on which page each Document starts: where its text is.
    castle_page = _page_with(reader, "uled by")
    irena_page = _page_with(reader, "vampire.")
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
    # Castle and Irena share a page, and the Place chapter's page names no
    # Document in its header (it only holds a reference).
    assert irena_page == castle_page
    place = reader.pages[3].extract_text()
    assert "Irena" not in place
    assert re.search(rf"Castle\s*→\s*p\.\s*{castle_page}\b", place)
    # The glossary points at the same pages, and the accents survived.
    glossary = reader.pages[-1].extract_text()
    assert re.search(rf"Castle · NPC, Place[ .]*{castle_page}\b", glossary)
    assert re.search(rf"Irena · NPC[ .]*{irena_page}\b", glossary)
    assert "ittà dell'Ovest, perché sì." in " ".join(p.extract_text() for p in reader.pages)


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
    # An allowed link must not be able to lead elsewhere: redirects aren't followed.
    assert not any(isinstance(h, HTTPRedirectHandler) for h in fetcher.handlers)


def _line_starts(reader: PdfReader, page: int) -> list[float]:
    """The x of every long piece of text on `page`: a line of the body, which
    WeasyPrint writes as one piece."""
    found: list[float] = []

    def visit(text: str, _cm: Any, tm: Any, _font: Any, _size: Any) -> None:
        if len(text.strip()) >= 15:
            found.append(float(tm[4]))

    reader.pages[page].extract_text(visitor_text=visit)
    return found


@pytest.mark.parametrize("style", list(ManualStyle))
@pytest.mark.parametrize("sentences", [60, 14])
def test_a_chapter_flows_in_two_columns_balanced_on_its_last_page(
    style: ManualStyle, sentences: int
) -> None:
    """Spec 23b: every style sets a chapter's Documents in two columns. The text
    of a description starts at the left margin and also at the second column,
    well to the right of it: with 60 sentences the chapter spans pages, with 14
    it would fit one column, and the second column is used all the same because
    the last page is balanced."""
    _weasyprint()
    sentence = "Marker the keep stands above the mist and the road bends toward it. "
    export = make_export(
        main_items=[],
        documents=[document(CASTLE, "Castle", description=(text(sentence * sentences),))],
    )
    manual = build_manual(export, ManualOptions(), LABELS)

    reader = PdfReader(io.BytesIO(render_manual_pdf(manual, style, PageSize.A4)))

    body = reader.pages[2]  # cover, contents, then the chapter
    starts = sorted({round(x) for x in _line_starts(reader, 2)})
    left = min(starts)
    width = float(body.mediabox.width)
    to_the_right = [x for x in starts if x > left + width * 0.25]
    assert to_the_right, (style, sentences, starts)


def test_neighbours_that_each_took_one_page_pair_up_left_to_right() -> None:
    order = [("chapter-1", ["a", "b", "c", "d", "e"]), ("chapter-2", ["f"]), ("glossary", [])]

    # d takes two pages, so c and e have no one-page neighbour in their chapter,
    # and e and f are in different chapters.
    pages = {"chapter-1": 2, "a": 2, "b": 3, "c": 4, "d": 5, "e": 7, "chapter-2": 8, "f": 8}
    assert page_pairs(order, {**pages, "glossary": 9}) == [("a", "b")]

    # Every Document on one page: pairs left to right, e is left alone.
    pages = {"chapter-1": 2, "a": 2, "b": 3, "c": 4, "d": 5, "e": 6, "chapter-2": 7, "f": 7}
    assert page_pairs(order, {**pages, "glossary": 8}) == [("a", "b"), ("c", "d")]

    # Without the glossary on a page, where the last Document ends is unknown.
    assert page_pairs(order, pages) == [("a", "b"), ("c", "d")]
    assert page_pairs([("chapter-1", ["a", "b"]), ("glossary", [])], pages) == []


@pytest.mark.parametrize(
    ("style", "sentences"),
    [(ManualStyle.GOTHIC, 40), (ManualStyle.MODERN, 30), (ManualStyle.PRINT, 40)],
)
def test_two_documents_too_long_together_keep_their_own_pages(
    style: ManualStyle, sentences: int
) -> None:
    """Each takes one page alone but not both together: the renderer tries the
    pair, sees it spill and lays it out again a page each."""
    _weasyprint()
    sentence = "the keep stands above the mist and the road bends toward it. "
    export = make_export(
        main_items=[],
        documents=[
            document(CASTLE, "Castle", description=(text("First " + sentence * sentences),)),
            document(IRENA, "Irena", description=(text("Second " + sentence * sentences),)),
        ],
    )
    manual = build_manual(export, ManualOptions(), LABELS)

    reader = PdfReader(io.BytesIO(render_manual_pdf(manual, style, PageSize.A4)))

    # Cover, contents, Castle, Irena, glossary.
    assert len(reader.pages) == 5
    assert _page_with(reader, "Second the keep") == _page_with(reader, "First the keep") + 1


@pytest.mark.parametrize(
    ("style", "sentences"),
    [(ManualStyle.GOTHIC, 62), (ManualStyle.MODERN, 46), (ManualStyle.PRINT, 66)],
)
def test_a_chapter_that_fills_its_last_page_adds_no_empty_page(
    style: ManualStyle, sentences: int
) -> None:
    """A description long enough that the columns fill the chapter's last page
    to the bottom (the counts were found by sweeping each style): the closing
    rule used to be an <hr> after the columns, which then moved alone to an
    otherwise empty page. Every page between the contents and the glossary
    holds body text."""
    _weasyprint()
    sentence = "Marker the keep stands above the mist and the road bends toward it. "
    export = make_export(
        main_items=[],
        documents=[document(CASTLE, "Castle", description=(text(sentence * sentences),))],
    )
    manual = build_manual(export, ManualOptions(), LABELS)

    reader = PdfReader(io.BytesIO(render_manual_pdf(manual, style, PageSize.A4)))

    *body, glossary = reader.pages[2:]
    for number, page in enumerate(body, start=3):
        assert "Marker" in page.extract_text(), (style, number)
    assert "Glossary" in glossary.extract_text()

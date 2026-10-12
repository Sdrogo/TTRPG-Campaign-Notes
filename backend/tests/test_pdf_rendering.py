"""WeasyPrint renders what the Room PDF needs (spec 23b_1a): paged media with
page counters and page references. This is the deploy check of the spec: it
runs wherever Pango is installed (CI, the Docker image). On a machine without
the system libraries (a developer's Windows) it is skipped, but in CI
(`REQUIRE_WEASYPRINT=1`) a missing library fails instead of skipping, so the
check can't pass by silently not running."""

import importlib
import io
import os
from typing import Any

import pytest
from pypdf import PdfReader

PAGED_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 20mm; @bottom-center { content: counter(page); } }
  h1 { break-before: page; }
  .toc a::after { content: " p. " target-counter(attr(href), page); }
</style></head><body>
  <p class="toc"><a href="#chapter">Chapter</a></p>
  <h1 id="chapter">Chapter</h1>
  <p>Città dell'Ovest, with an accent.</p>
</body></html>"""


def _weasyprint() -> Any:
    """The `weasyprint` module, or a skip (a fail in CI) when its system
    libraries aren't there."""
    try:
        return importlib.import_module("weasyprint")
    except (ImportError, OSError) as exc:
        if os.environ.get("REQUIRE_WEASYPRINT"):
            pytest.fail(f"WeasyPrint can't load its system libraries: {exc}")
        pytest.skip(f"WeasyPrint's system libraries are not installed: {exc}")


def test_paged_media_renders_a_pdf_with_page_references() -> None:
    weasyprint = _weasyprint()

    pdf: bytes = weasyprint.HTML(string=PAGED_HTML).write_pdf()

    assert pdf.startswith(b"%PDF-")
    reader = PdfReader(io.BytesIO(pdf))
    # The heading breaks to a new page, so the contents entry points at page 2.
    assert len(reader.pages) == 2
    first = reader.pages[0].extract_text()
    assert "Chapter p. 2" in first
    assert "Città dell'Ovest" in reader.pages[1].extract_text()


# Spec 34: the bundled fonts must cover every language the UI speaks, so a
# letter never falls back to a font the host happens to have. Each style gets
# a heading and a paragraph of Cyrillic and of Latin Extended letters.
_SAMPLES = {
    "ru": "Подземелье Москвы: Ёж, Щука и Ъ",
    "pl": "Zażółć gęślą jaźń, ŁĄĆĘŃÓŚŹŻ",
    "de": "Größe, Übung, Äpfel ß",
    "es": "¿Mañana? ¡Sí! Ñandú",
    "fr": "Œuvre, être, naïve, où ç",
    "nl": "IJsselmeer, ëén, ïs",
    "ja": "地下迷宮の物語、ひらがなとカタカナ「ア」",
    "zh-Hans": "地下城的故事：简体中文。",
    "ko": "지하 감옥의 이야기, 한글입니다.",
}
_BUNDLED_FONTS = ("IM-Fell", "Crimson-Text", "Lato", "PT-Serif", "Noto-Serif", "Noto-Sans")


@pytest.mark.parametrize("style", ["gothic", "modern", "print"])
def test_every_bundled_style_covers_the_ui_languages_without_system_fonts(style: str) -> None:
    from pathlib import Path

    weasyprint = _weasyprint()
    assets = Path(__file__).parents[1] / "app" / "pdf"
    body = "".join(f"<h2>{text}</h2><p>{text}</p>" for text in _SAMPLES.values())
    html = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        f'<link rel="stylesheet" href="styles/{style}.css"></head><body>{body}</body></html>'
    )

    pdf: bytes = weasyprint.HTML(string=html, base_url=assets.as_uri() + "/").write_pdf()

    names: set[str] = set()
    for page in PdfReader(io.BytesIO(pdf)).pages:
        resources: Any = page["/Resources"]
        fonts: Any = resources.get("/Font", {})
        names.update(str(fonts[key].get_object()["/BaseFont"]) for key in fonts)
    assert names
    assert all(any(bundled in name for bundled in _BUNDLED_FONTS) for name in names), names


@pytest.mark.parametrize(
    ("lang", "script", "text"),
    [("ja", "JP", "地下"), ("zh-Hans", "SC", "地下"), ("ko", "KR", "지하")],
)
@pytest.mark.parametrize("style", ["gothic", "modern", "print"])
def test_the_page_language_picks_the_face_of_its_own_script(
    style: str, lang: str, script: str, text: str
) -> None:
    """The text (地下 is Han in Japanese and Chinese; Korean has no Han in its
    subset, only Hangul) is drawn from the face of the page's own script, not
    the first CJK face in the stack."""
    from pathlib import Path

    weasyprint = _weasyprint()
    assets = Path(__file__).parents[1] / "app" / "pdf"
    html = (
        f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8">'
        f'<link rel="stylesheet" href="styles/{style}.css"></head>'
        f"<body><h2>{text}</h2><p>{text}</p></body></html>"
    )

    pdf: bytes = weasyprint.HTML(string=html, base_url=assets.as_uri() + "/").write_pdf()

    names: set[str] = set()
    for page in PdfReader(io.BytesIO(pdf)).pages:
        resources: Any = page["/Resources"]
        fonts: Any = resources.get("/Font", {})
        names.update(str(fonts[key].get_object()["/BaseFont"]) for key in fonts)
    family = "Sans" if style == "modern" else "Serif"
    assert any(f"Noto-{family}-{script}" in name for name in names), names

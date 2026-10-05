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

"""What a Room PDF carries besides its pages (spec 23b, 23b_1c): images made
light for print and PDF Attachments appended at the end; plus the job's
options and the manual's image swap. Pure, no database and no Pango."""

import base64
import io
import uuid
from dataclasses import replace
from datetime import UTC, datetime

from manual_fixtures import CASTLE, IRENA, LABELS, image, make_export
from PIL import Image
from pypdf import PdfReader, PdfWriter

from app.domain.export import pdf_filename
from app.domain.export_jobs import (
    MAX_IMAGE_PIXELS,
    PdfOptions,
    export_storage_path,
)
from app.domain.manual import (
    ManualDocument,
    ManualOptions,
    ManualStyle,
    PageSize,
    build_manual,
    with_image_urls,
)
from app.pdf.media import merge_attachments, print_image_data_uri


def _png(size: tuple[int, int], mode: str = "RGB", color: object = (10, 20, 30)) -> bytes:
    buffer = io.BytesIO()
    Image.new(mode, size, color).save(buffer, format="PNG")  # type: ignore[arg-type]
    return buffer.getvalue()


def _decode(uri: str) -> Image.Image:
    assert uri.startswith("data:image/jpeg;base64,")
    return Image.open(io.BytesIO(base64.b64decode(uri.split(",", 1)[1])))


def _pdf(pages: int) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def test_an_image_is_downscaled_to_the_print_limit_and_kept_in_proportion() -> None:
    decoded = _decode(print_image_data_uri(_png((MAX_IMAGE_PIXELS * 2, MAX_IMAGE_PIXELS))) or "")

    assert decoded.size == (MAX_IMAGE_PIXELS, MAX_IMAGE_PIXELS // 2)


def test_a_small_image_is_not_enlarged() -> None:
    assert _decode(print_image_data_uri(_png((60, 40))) or "").size == (60, 40)


def test_transparency_is_flattened_onto_white_not_black() -> None:
    clear = _png((8, 8), "RGBA", (0, 0, 0, 0))

    pixel = _decode(print_image_data_uri(clear) or "").getpixel((4, 4))

    assert isinstance(pixel, tuple) and min(pixel) >= 250


def test_something_that_is_not_an_image_is_left_out() -> None:
    assert print_image_data_uri(b"not an image") is None
    assert print_image_data_uri(b"") is None


def test_attachments_follow_the_manual_page_by_page_in_order() -> None:
    merged, appended = merge_attachments(_pdf(2), [_pdf(1), _pdf(3)])

    assert appended == 2
    assert len(PdfReader(io.BytesIO(merged)).pages) == 6


def test_no_attachments_leaves_the_manual_as_it_is() -> None:
    merged, appended = merge_attachments(_pdf(2), [])

    assert appended == 0
    assert len(PdfReader(io.BytesIO(merged)).pages) == 2


def test_a_damaged_or_encrypted_attachment_is_skipped_and_the_rest_kept() -> None:
    locked = PdfWriter()
    locked.add_blank_page(width=100, height=100)
    locked.encrypt("secret")
    locked_bytes = io.BytesIO()
    locked.write(locked_bytes)

    merged, appended = merge_attachments(
        _pdf(1), [b"%PDF-1.7 garbage", locked_bytes.getvalue(), _pdf(2)]
    )

    assert appended == 1
    assert len(PdfReader(io.BytesIO(merged)).pages) == 3


def test_options_survive_the_trip_through_the_jobs_json() -> None:
    options = PdfOptions(
        style=ManualStyle.MODERN,
        page_size=PageSize.LETTER,
        include_comments=True,
        include_attachments=True,
        cover_document_id=uuid.uuid4(),
        tag_ids=(uuid.uuid4(), uuid.uuid4()),
        locale="it",
        view_as_user_id=uuid.uuid4(),
        room_cover=True,
    )
    bare = replace(options, cover_document_id=None, tag_ids=(), view_as_user_id=None)

    assert PdfOptions.from_json(options.to_json()) == options
    assert PdfOptions.from_json(bare.to_json()) == bare
    assert bare.to_json()["cover_document_id"] is None
    # A job stored before spec 26 has no `room_cover`: it was made without one.
    stored = {key: value for key, value in options.to_json().items() if key != "room_cover"}
    assert PdfOptions.from_json(stored).room_cover is False


def test_a_jobs_file_has_a_private_prefix_of_its_own() -> None:
    room, job = uuid.uuid4(), uuid.uuid4()

    assert export_storage_path(room, job) == f"exports/{room}/{job}.pdf"


def test_the_pdf_is_named_like_the_other_exports() -> None:
    when = datetime(2026, 10, 5, tzinfo=UTC)

    assert pdf_filename("Barovia: l'Ovest!", when) == "barovia-l-ovest-2026-10-05.pdf"
    assert pdf_filename("???", when) == "room-2026-10-05.pdf"


def test_images_are_swapped_by_link_and_one_without_a_replacement_is_left_out() -> None:
    export = make_export()
    manual = build_manual(export, ManualOptions(cover_document_id=CASTLE), LABELS)
    castle_link = image(2).url

    swapped = with_image_urls(manual, {castle_link: "data:image/jpeg;base64,AAAA"})

    assert swapped.cover_image_url == "data:image/jpeg;base64,AAAA"
    castle = next(
        e
        for c in swapped.chapters
        for e in c.entries
        if isinstance(e, ManualDocument) and e.image_url
    )
    assert castle.image_url == "data:image/jpeg;base64,AAAA"
    assert swapped.image_urls == {"data:image/jpeg;base64,AAAA"}

    # Nothing fetched: no image anywhere, references and the rest untouched.
    bare = with_image_urls(manual, {})
    assert bare.cover_image_url is None
    assert bare.image_urls == frozenset()
    assert [c.title for c in bare.chapters] == [c.title for c in manual.chapters]
    assert IRENA in {getattr(e, "id", None) for c in bare.chapters for e in c.entries}

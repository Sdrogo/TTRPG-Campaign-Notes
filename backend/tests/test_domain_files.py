import uuid
from datetime import UTC, datetime

import pytest

from app.domain.files import (
    DEFAULT_FILE_NAME,
    MAX_FILE_BYTES,
    MAX_FILE_NAME_LENGTH,
    MAX_FILES_PER_DOCUMENT,
    PDF_CONTENT_TYPE,
    FileTooLargeError,
    FileUpload,
    NotPdfError,
    TooManyFilesError,
    clean_display_name,
    ensure_can_add_file,
    plan_new_file,
    validate_pdf,
)

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\n%%EOF\n"


def test_a_pdf_is_accepted_by_its_header() -> None:
    validate_pdf(PDF)


def test_bytes_that_are_not_a_pdf_are_refused_whatever_the_name() -> None:
    # D-22: by content, not by name - the route never even looks at ".pdf".
    with pytest.raises(NotPdfError) as exc_info:
        validate_pdf(b"\x89PNG\r\n\x1a\n not a pdf")
    assert exc_info.value.key == "errors.file.notPdf"


def test_an_empty_file_is_not_a_pdf() -> None:
    with pytest.raises(NotPdfError):
        validate_pdf(b"")


def test_a_file_at_the_cap_is_accepted_and_one_byte_more_is_refused() -> None:
    at_cap = PDF + b"0" * (MAX_FILE_BYTES - len(PDF))
    validate_pdf(at_cap)
    with pytest.raises(FileTooLargeError) as exc_info:
        validate_pdf(at_cap + b"0")
    assert exc_info.value.params == {"mb": 10}


def test_size_is_checked_before_the_header() -> None:
    with pytest.raises(FileTooLargeError):
        validate_pdf(b"x" * (MAX_FILE_BYTES + 1))


def test_the_tenth_file_is_allowed_and_the_eleventh_is_not() -> None:
    ensure_can_add_file(MAX_FILES_PER_DOCUMENT - 1)
    with pytest.raises(TooManyFilesError) as exc_info:
        ensure_can_add_file(MAX_FILES_PER_DOCUMENT)
    assert exc_info.value.params == {"max": 10}


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Strahd sheet.pdf", "Strahd sheet.pdf"),
        ("  Strahd \t  sheet.pdf  ", "Strahd sheet.pdf"),
        ("C:\\Users\\me\\Desktop\\sheet.pdf", "sheet.pdf"),
        ("../../etc/sheet.pdf", "sheet.pdf"),
        ("she\x00et\u202e.pdf", "sheet.pdf"),
        ("", DEFAULT_FILE_NAME),
        ("   ", DEFAULT_FILE_NAME),
        (None, DEFAULT_FILE_NAME),
        ("folder/", DEFAULT_FILE_NAME),
        ("Scheda è già pronta.pdf", "Scheda è già pronta.pdf"),
    ],
)
def test_display_name_is_cleaned_up(raw: str | None, expected: str) -> None:
    assert clean_display_name(raw) == expected


def test_a_long_name_is_cut_keeping_its_pdf_ending() -> None:
    name = clean_display_name("a" * 300 + ".PDF")
    assert len(name) == MAX_FILE_NAME_LENGTH
    assert name.endswith("a.PDF")


def test_a_long_name_without_pdf_ending_is_just_cut() -> None:
    name = clean_display_name("b" * 300)
    assert name == "b" * MAX_FILE_NAME_LENGTH


def test_a_cut_name_drops_trailing_spaces_before_the_ending() -> None:
    name = clean_display_name("c" * 195 + " " + "d" * 50 + ".pdf")
    assert name == "c" * 195 + ".pdf"


def test_a_name_at_the_limit_is_kept_whole() -> None:
    name = "e" * (MAX_FILE_NAME_LENGTH - 4) + ".pdf"
    assert clean_display_name(name) == name


def test_new_file_gets_a_random_path_under_its_document() -> None:
    document_id = uuid.uuid4()
    uploader = uuid.uuid4()
    upload = FileUpload(data=PDF, display_name="sheet.pdf")

    first = plan_new_file(document_id, upload, uploader, 0, NOW)
    second = plan_new_file(document_id, upload, uploader, 0, NOW)

    assert first.storage_path == f"documents/{document_id}/files/{first.id.hex}.pdf"
    # Never derived from the file's name, and never the same twice.
    assert "sheet" not in first.storage_path
    assert first.storage_path != second.storage_path
    assert first.document_id == document_id
    assert first.display_name == "sheet.pdf"
    assert first.size_bytes == len(PDF)
    assert first.content_type == PDF_CONTENT_TYPE
    assert first.uploaded_by == uploader
    assert first.created_at == NOW


def test_planning_a_file_over_the_count_is_refused() -> None:
    upload = FileUpload(data=PDF, display_name="sheet.pdf")
    with pytest.raises(TooManyFilesError):
        plan_new_file(uuid.uuid4(), upload, uuid.uuid4(), MAX_FILES_PER_DOCUMENT, NOW)

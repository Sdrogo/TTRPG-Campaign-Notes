"""Rules for PDF Attachments on a Document (D-21, D-22, spec 16): which files
are accepted, their limits, the name they're shown under and where they're
stored. Who may upload or remove one is Ownership (`documents.is_owner`,
D-12), and who may see one is the Document's own visibility (VR-12)."""

import re
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import datetime

from app.domain.errors import DomainError
from app.domain.models import DocumentFile

# D-22: 10 MB per file, 10 Attachments per Document.
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_FILES_PER_DOCUMENT = 10
MAX_FILE_NAME_LENGTH = 200

PDF_CONTENT_TYPE = "application/pdf"
PDF_EXTENSION = ".pdf"
# Every PDF starts with this header; checked on the bytes, never on the name.
PDF_SIGNATURE = b"%PDF-"
# The name a file is shown under when the upload carried none we can use.
DEFAULT_FILE_NAME = "document.pdf"


class NotPdfError(DomainError):
    """The uploaded bytes aren't a PDF, whatever the file is called."""


class FileTooLargeError(DomainError):
    """The file is over `MAX_FILE_BYTES`."""


class TooManyFilesError(DomainError):
    """The Document already has `MAX_FILES_PER_DOCUMENT` Attachments."""


@dataclass(frozen=True)
class FileUpload:
    """What a validated upload is made of: its bytes and the name to show."""

    data: bytes
    display_name: str


def validate_pdf(data: bytes) -> None:
    """D-22: a PDF is accepted by its content - the `%PDF-` header - and only
    within the size cap. Raises `FileTooLargeError` or `NotPdfError`. Callers
    read at most one byte past the cap, so an oversized file is caught without
    buffering it whole. The bytes are stored as uploaded: a PDF isn't
    re-encoded like an image, which is why it's only ever served as a
    download (spec 16)."""
    if len(data) > MAX_FILE_BYTES:
        raise FileTooLargeError("errors.file.tooLarge", mb=MAX_FILE_BYTES // (1024 * 1024))
    if not data.startswith(PDF_SIGNATURE):
        raise NotPdfError("errors.file.notPdf")


_WHITESPACE = re.compile(r"\s+")


def clean_display_name(raw: str | None) -> str:
    """The name an Attachment is shown and downloaded under (spec 16): the
    uploaded file's own name without any directory part or control
    characters, whitespace collapsed, at most `MAX_FILE_NAME_LENGTH`
    characters. A longer name is cut, not refused, keeping its `.pdf`
    ending; an empty one becomes `DEFAULT_FILE_NAME`."""
    name = re.split(r"[/\\]", raw or "")[-1]
    name = "".join(ch for ch in name if not unicodedata.category(ch).startswith("C"))
    name = _WHITESPACE.sub(" ", name).strip()
    if not name:
        return DEFAULT_FILE_NAME
    if len(name) <= MAX_FILE_NAME_LENGTH:
        return name
    extension = PDF_EXTENSION if name.lower().endswith(PDF_EXTENSION) else ""
    stem = name[: len(name) - len(extension)]
    return stem[: MAX_FILE_NAME_LENGTH - len(extension)].rstrip() + name[len(stem) :]


def ensure_can_add_file(current_file_count: int) -> None:
    """Raises `TooManyFilesError` once the Document is at
    `MAX_FILES_PER_DOCUMENT` (D-22)."""
    if current_file_count >= MAX_FILES_PER_DOCUMENT:
        raise TooManyFilesError("errors.file.tooMany", max=MAX_FILES_PER_DOCUMENT)


def plan_new_file(
    document_id: uuid.UUID,
    upload: FileUpload,
    uploader_id: uuid.UUID,
    current_file_count: int,
    now: datetime,
) -> DocumentFile:
    """FR-D8: plans one more Attachment on a Document. The Storage object gets
    a random name under the Document, so it can't be guessed from the
    Document's id or the file's name (the bucket is private)."""
    ensure_can_add_file(current_file_count)
    file_id = uuid.uuid4()
    return DocumentFile(
        id=file_id,
        document_id=document_id,
        storage_path=f"documents/{document_id}/files/{file_id.hex}{PDF_EXTENSION}",
        display_name=upload.display_name,
        size_bytes=len(upload.data),
        content_type=PDF_CONTENT_TYPE,
        uploaded_by=uploader_id,
        created_at=now,
    )

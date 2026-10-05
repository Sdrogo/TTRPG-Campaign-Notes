"""The Room PDF as a background job (spec 23b Decision 8, 23b_1c): what a
request asks for (`PdfOptions`), the states a job goes through and the limits
that keep the work bounded. Pure data and rules, no I/O."""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any

from app.domain.errors import DomainError
from app.domain.manual import ManualStyle, PageSize

# A finished PDF is downloadable for a day, then its Storage object is removed
# (spec 23b Backend).
EXPORT_TTL = timedelta(hours=24)
# A job that has run this long is taken as lost (the process was restarted, or
# the render hung) so its owner can start another.
STALE_AFTER = timedelta(minutes=30)
# PDF Attachments are appended until this many bytes are in the file; later
# ones are left out rather than building an unbounded PDF in memory.
MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
# An image is downscaled so its longer side is at most this many pixels: about
# 150 dpi on A4, plenty for print and light on memory and file size.
MAX_IMAGE_PIXELS = 1400


class ExportStatus(StrEnum):
    """Where a job is: `queued` until the background task starts it, `running`,
    then `done` (file ready) or `failed`; a `done` file becomes `expired` once
    removed."""

    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    EXPIRED = "expired"


ACTIVE_STATUSES = (ExportStatus.QUEUED, ExportStatus.RUNNING)


class ExportAlreadyRunningError(DomainError):
    """The user already has a Room PDF queued or running in this Room: one at
    a time (spec 23b Backend)."""


@dataclass(frozen=True)
class PdfOptions:
    """What the requester chose (spec 23b Frontend). `view_as_user_id` is the
    member the Master generates it "as" (Decision 6); it travels in the body,
    not in the `X-View-As` header, because that header makes every write a 403
    (spec 22b). `locale` is the requester's language, for the PDF's fixed
    texts."""

    style: ManualStyle
    page_size: PageSize
    include_comments: bool
    include_attachments: bool
    cover_document_id: uuid.UUID | None
    tag_ids: tuple[uuid.UUID, ...]
    locale: str
    view_as_user_id: uuid.UUID | None

    def to_json(self) -> dict[str, Any]:
        """The options as the plain JSON stored on the job."""
        return {
            "style": self.style.value,
            "page_size": self.page_size.value,
            "include_comments": self.include_comments,
            "include_attachments": self.include_attachments,
            "cover_document_id": str(self.cover_document_id) if self.cover_document_id else None,
            "tag_ids": [str(tag_id) for tag_id in self.tag_ids],
            "locale": self.locale,
            "view_as_user_id": str(self.view_as_user_id) if self.view_as_user_id else None,
        }

    @staticmethod
    def from_json(data: dict[str, Any]) -> "PdfOptions":
        """The inverse of `to_json`."""
        cover = data["cover_document_id"]
        view_as = data["view_as_user_id"]
        return PdfOptions(
            style=ManualStyle(data["style"]),
            page_size=PageSize(data["page_size"]),
            include_comments=data["include_comments"],
            include_attachments=data["include_attachments"],
            cover_document_id=uuid.UUID(cover) if cover else None,
            tag_ids=tuple(uuid.UUID(tag_id) for tag_id in data["tag_ids"]),
            locale=data["locale"],
            view_as_user_id=uuid.UUID(view_as) if view_as else None,
        )


@dataclass(frozen=True)
class ExportJob:
    """A Room PDF request and its outcome."""

    id: uuid.UUID
    room_id: uuid.UUID
    requested_by: uuid.UUID
    options: PdfOptions
    status: ExportStatus
    storage_path: str | None
    error: str | None
    created_at: datetime
    finished_at: datetime | None


def export_storage_path(room_id: uuid.UUID, job_id: uuid.UUID) -> str:
    """Where a job's PDF lives: a private prefix of its own, apart from the
    images and PDF Attachments."""
    return f"exports/{room_id}/{job_id}.pdf"

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
STALE_AFTER = timedelta(hours=2)
# The whole file (the manual plus the PDF Attachments appended to it) must fit
# the bucket's per-object limit: Supabase caps it at 50 MB on the free plan, and
# the `document-images` bucket has to be raised to that by hand (it was 10 MB
# until 2026-10-16). Attachments are appended until the file would pass this,
# with a margin for the merge's overhead; later ones are left out rather than
# building a PDF that Storage refuses.
MAX_EXPORT_BYTES = 48 * 1024 * 1024
# An image is downscaled so its longer side is at most this many pixels: a
# template prints one at most about 135 mm wide, so this is 170 dpi or more,
# plenty for print and cheap to convert, lay out and embed.
MAX_IMAGE_PIXELS = 900


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
    texts. `room_cover` puts the Room's image on the cover when no Document
    gives one (spec 26 Decision 5); a job stored before it existed reads as
    off, as it was made."""

    style: ManualStyle
    page_size: PageSize
    include_comments: bool
    include_attachments: bool
    cover_document_id: uuid.UUID | None
    tag_ids: tuple[uuid.UUID, ...]
    locale: str
    view_as_user_id: uuid.UUID | None
    room_cover: bool = False

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
            "room_cover": self.room_cover,
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
            room_cover=data.get("room_cover", False),
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

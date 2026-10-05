"""The media a Room PDF carries besides its own pages (spec 23b): images made
light enough to print, and PDF Attachments appended at the end. Pure bytes in,
bytes out; fetching them is the job's work (`app/api/export_pdf_job.py`)."""

import base64
import io
import logging
from collections.abc import Sequence

from PIL import Image, UnidentifiedImageError
from pypdf import PdfReader, PdfWriter

from app.domain.export_jobs import MAX_IMAGE_PIXELS

logger = logging.getLogger(__name__)


def print_image_data_uri(data: bytes) -> str | None:
    """`data` as a `data:` URL of a JPEG whose longer side is at most
    `MAX_IMAGE_PIXELS` (flattened onto white, so transparency doesn't print
    black); None when it isn't an image Pillow can read. A `data:` URL is what
    the renderer is allowed to load without touching the network."""
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.thumbnail((MAX_IMAGE_PIXELS, MAX_IMAGE_PIXELS))
            rgba = image.convert("RGBA")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, ValueError):
        return None
    flat = Image.new("RGB", rgba.size, (255, 255, 255))
    flat.paste(rgba, mask=rgba.getchannel("A"))
    out = io.BytesIO()
    flat.save(out, format="JPEG", quality=82)
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode("ascii")


def merge_attachments(pdf: bytes, attachments: Sequence[bytes]) -> tuple[bytes, int]:
    """`pdf` followed by the pages of each attachment, in order, and how many
    attachments were appended. One that can't be read (encrypted, damaged) is
    skipped: the manual is still worth having without it."""
    writer = PdfWriter()
    writer.append(PdfReader(io.BytesIO(pdf)))
    appended = 0
    for attachment in attachments:
        try:
            reader = PdfReader(io.BytesIO(attachment))
            if reader.is_encrypted:
                continue
            len(reader.pages)  # parses the page tree now, so a damaged file fails here
            writer.append(reader)
        except Exception:
            logger.warning("A PDF Attachment could not be appended; left out", exc_info=True)
            continue
        appended += 1
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue(), appended

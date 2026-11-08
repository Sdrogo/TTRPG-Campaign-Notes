"""The pictures of an Obsidian vault, kept between the import request and the
job that stores them (spec 65 Decision 5, which amends spec 27 Decision 17 for
pictures only).

They sit in the images bucket, which is private, under `imports/<room>/<job>/`.
Only the backend writes and reads them, with its service key; they are never
signed for a client and never referenced by a row. Every one has a
`storage_cleanup` row from before its upload, and the job removes them all as
it ends, whatever the outcome (`discard`). A crash before that is caught by the
sweep, which leaves them alone only while their job is still active."""

import asyncio
import hashlib
import logging
import uuid
from collections.abc import Mapping

from app.db import storage, storage_cleanup
from app.domain.images import MAX_INPUT_BYTES

logger = logging.getLogger(__name__)
_UPLOADS_AT_ONCE = 8


def staged_path(room_id: uuid.UUID, job_id: uuid.UUID, vault_path: str) -> str:
    """Where the picture at `vault_path` of the vault is staged for a job: the
    same path always gives the same object, so a picture used by several notes
    is staged once."""
    digest = hashlib.sha256(vault_path.encode()).hexdigest()[:32]
    return f"{storage_cleanup.STAGING_PREFIX}{room_id}/{job_id}/{digest}"


async def stage(room_id: uuid.UUID, job_id: uuid.UUID, pictures: Mapping[str, bytes]) -> None:
    """Uploads the pictures, `vault path -> bytes`. Raises `StorageError` when
    Storage refuses one; what was already uploaded is left to the sweep."""
    paths = {vault: staged_path(room_id, job_id, vault) for vault in pictures}
    await storage_cleanup.record_pending_uploads(list(paths.values()))
    gate = asyncio.Semaphore(_UPLOADS_AT_ONCE)

    async def put(vault: str) -> None:
        async with gate:
            await storage.upload(paths[vault], pictures[vault], "application/octet-stream")

    await asyncio.gather(*(put(vault) for vault in pictures))


async def read(room_id: uuid.UUID, job_id: uuid.UUID, vault_path: str) -> bytes:
    """The staged bytes of one picture; `StorageError` when it is gone."""
    return await storage.download(staged_path(room_id, job_id, vault_path), MAX_INPUT_BYTES)


async def discard(job_id: uuid.UUID) -> None:
    """Removes everything staged for the job. Never raises: it runs as the job
    ends, and a failure is left to the sweep."""
    try:
        await storage_cleanup.remove_staged(job_id)
    except Exception:
        logger.exception("Could not remove the pictures staged for %s", job_id)

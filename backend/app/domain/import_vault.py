"""Reading a vault upload (spec 65 Decision 4): a `.zip` of an Obsidian vault
expanded into its files, with the limits that keep a hostile archive from
costing more than the import is allowed to.

Pure: bytes in, `(path, bytes)` out. Nothing is written and no path is ever
used on disk, so a `..` or absolute path in the archive can only be refused
here, not exploited."""

import io
import posixpath
import stat
import zipfile
from collections.abc import Sequence

from app.domain.import_files import MAX_FILE_BYTES, ImportFileTooLargeError, ImportRefusedError
from app.domain.import_obsidian import is_hidden

MAX_VAULT_BYTES = 100 * 1024 * 1024
MAX_VAULT_UPLOADS = 3000
MAX_VAULT_ENTRIES = 5000
# A text compresses well; far more than this is a decompression bomb.
MAX_COMPRESSION_RATIO = 200


def is_zip(name: str) -> bool:
    """Whether an upload is named like an archive."""
    return name.lower().endswith(".zip")


def expand_zip(name: str, data: bytes) -> list[tuple[str, bytes]]:
    """The notes of the archive `data` (Markdown files only; pictures come with
    the image step) as `(path, bytes)`. 422 for a file that isn't a zip, one with
    an unsafe path, too many entries or a bomb; 413 for a note over
    `MAX_FILE_BYTES`. Directories, symbolic links and hidden folders are
    skipped."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ImportRefusedError("errors.import.unreadable", name=name[:200]) from exc
    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_VAULT_ENTRIES:
            raise ImportRefusedError("errors.import.vaultTooBig", max=MAX_VAULT_BYTES // 2**20)
        total = 0
        files: list[tuple[str, bytes]] = []
        for info in infos:
            path = info.filename.replace("\\", "/")
            if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16):
                continue
            if path.startswith("/") or ".." in path.split("/") or "\x00" in path:
                raise ImportRefusedError("errors.import.unsafeArchive", name=name[:200])
            total += info.file_size  # every entry counts toward the memory bound
            if total > MAX_VAULT_BYTES:
                raise ImportRefusedError("errors.import.vaultTooBig", max=MAX_VAULT_BYTES // 2**20)
            if not path.lower().endswith((".md", ".markdown")) or is_hidden(path):
                continue  # never read: neither its size nor its ratio matters
            if info.compress_size and info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
                raise ImportRefusedError("errors.import.vaultTooBig", max=MAX_VAULT_BYTES // 2**20)
            if info.file_size > MAX_FILE_BYTES:
                raise ImportFileTooLargeError(
                    "errors.import.fileTooLarge",
                    name=posixpath.basename(path)[:200],
                    max=MAX_FILE_BYTES // (1024 * 1024),
                )
            try:
                with archive.open(info) as handle:
                    # The reader stops at the size the header gives, which was
                    # checked above; a header that lies fails its CRC.
                    content = handle.read()
            except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as exc:
                # A damaged, encrypted or unsupported entry.
                raise ImportRefusedError("errors.import.unreadable", name=name[:200]) from exc
            files.append((path, content))
    return files


def expand_uploads(uploads: Sequence[tuple[str, bytes]]) -> list[tuple[str, bytes]]:
    """The uploads with every archive replaced by its notes."""
    out: list[tuple[str, bytes]] = []
    for name, data in uploads:
        if is_zip(name):
            out.extend(expand_zip(name, data))
        else:
            out.append((name, data))
    return out

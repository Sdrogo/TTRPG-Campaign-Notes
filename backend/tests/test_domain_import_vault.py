"""Spec 65 Decision 4: expanding a vault zip safely."""

import io
import zipfile

import pytest

from app.domain import import_vault
from app.domain.import_files import ImportFileTooLargeError, ImportRefusedError
from app.domain.import_vault import expand_uploads, expand_zip, is_zip


def _zip(entries: dict[str, bytes], compression: int = zipfile.ZIP_DEFLATED) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression) as archive:
        for path, data in entries.items():
            archive.writestr(path, data)
    return buffer.getvalue()


def test_notes_are_kept_and_everything_else_skipped() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("folder/", b"")
        archive.writestr("folder/a.md", b"a")
        archive.writestr("pic.png", b"png")
        link = zipfile.ZipInfo("link.md")
        link.external_attr = 0o120777 << 16  # a symbolic link
        archive.writestr(link, b"a.md")
        archive.writestr("win\\b.md", b"b")
    assert expand_zip("v.zip", buffer.getvalue()) == [("folder/a.md", b"a"), ("win/b.md", b"b")]


def test_unsafe_archives_are_refused() -> None:
    for bad in ("../x.md", "a/../../x.md", "/x.md"):
        with pytest.raises(ImportRefusedError):
            expand_zip("v.zip", _zip({bad: b"x"}))
    with pytest.raises(ImportRefusedError):
        expand_zip("v.zip", b"nope")


def test_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ImportRefusedError):  # a bomb: tiny when compressed
        expand_zip("v.zip", _zip({"a.md": b"0" * 4_000_000}))
    monkeypatch.setattr(import_vault, "MAX_VAULT_ENTRIES", 2)
    with pytest.raises(ImportRefusedError):
        expand_zip("v.zip", _zip({"a.md": b"1", "b.md": b"2", "c.md": b"3"}))
    monkeypatch.setattr(import_vault, "MAX_VAULT_ENTRIES", 5000)
    monkeypatch.setattr(import_vault, "MAX_VAULT_BYTES", 10)
    with pytest.raises(ImportRefusedError):
        expand_zip("v.zip", _zip({"a.md": b"0123456789ab"}, zipfile.ZIP_STORED))
    monkeypatch.setattr(import_vault, "MAX_VAULT_BYTES", 100 * 1024 * 1024)
    monkeypatch.setattr(import_vault, "MAX_FILE_BYTES", 5)
    with pytest.raises(ImportFileTooLargeError):
        expand_zip("v.zip", _zip({"a.md": b"0123456789"}, zipfile.ZIP_STORED))


def test_a_damaged_entry_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    data = _zip({"a.md": b"0123456789"}, zipfile.ZIP_STORED)
    real = zipfile.ZipFile.infolist

    def liar(self: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
        infos = real(self)
        for info in infos:
            info.file_size = 3  # claims 3 bytes, holds 10: the CRC fails
        return infos

    monkeypatch.setattr(zipfile.ZipFile, "infolist", liar)
    with pytest.raises(ImportRefusedError):
        expand_zip("v.zip", data)


def test_uploads_expand_only_archives() -> None:
    archive = _zip({"n.md": b"x"})
    assert is_zip("V.ZIP") and not is_zip("a.md")
    assert expand_uploads([("a.md", b"1"), ("v.zip", archive)]) == [("a.md", b"1"), ("n.md", b"x")]

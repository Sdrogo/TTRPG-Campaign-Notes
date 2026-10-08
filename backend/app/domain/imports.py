"""What an import writes (spec 27 Decisions 5 to 16): given the parsed files
(`import_files.py`), what the importer sees and may do in the Room, and their
choices, `plan_import` says which Documents are created or replaced, which
Tags are matched or created, what every text becomes and what is dropped.

Pure: no database, no network. The same plan is made at preview time (nothing
chosen yet: everything copied) and again when the job starts, against the
Room as it is then. A file never decides anything about the Room by itself:
its ids only link objects inside the file, and spot a Document of the file
that still exists here (Decision 5)."""

import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any

from app.domain.errors import DomainError
from app.domain.import_files import (
    ImportCannotReplaceError,
    ImportDocument,
    ImportFile,
    ImportRefusedError,
    MentionRef,
    Text,
)
from app.domain.mentions import MentionKind, mention_token, unlink_mentions
from app.domain.models import DocumentVisibility
from app.domain.notes import MAX_NOTE_TITLE_LENGTH, MAX_NOTES_PER_DOCUMENT

MAX_FILES = 10
MAX_DOCUMENTS = 200
MAX_IMAGES = 200
MAX_DOCUMENT_NAME_LENGTH = 200
MAX_TAG_NAME_LENGTH = 100
# A job that has been active this long is taken as lost (the process was
# restarted, or it hung) so its owner can start another.
IMPORT_STALE_AFTER = timedelta(minutes=30)
# A finished job's row, with the list of what it did, is kept this long.
IMPORT_RETENTION = timedelta(days=7)


class ImportStatus(StrEnum):
    """Where an import job is: `queued` until the background task starts it,
    `running`, then `done` or `failed`."""

    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


ACTIVE_IMPORT_STATUSES = (ImportStatus.QUEUED, ImportStatus.RUNNING)


class ImportAlreadyRunningError(DomainError):
    """The user already has an import queued or running in this Room: one at a
    time (spec 27 Backend)."""


@dataclass(frozen=True)
class ImportJob:
    """An import request and its outcome. `payload` (the parsed files and the
    choices) is there while the job is active and None once it ends;
    `result` is what it created, replaced and skipped."""

    id: uuid.UUID
    room_id: uuid.UUID
    requested_by: uuid.UUID
    status: ImportStatus
    payload: dict[str, Any] | None
    result: dict[str, Any] | None
    error: str | None
    created_at: datetime
    finished_at: datetime | None


@dataclass(frozen=True)
class ExistingDocument:
    """A Document of the Room the importer sees: whether they manage it (D-12,
    so may replace it) and the ids of the images it has now."""

    id: uuid.UUID
    can_manage: bool
    image_ids: frozenset[str]


@dataclass(frozen=True)
class ImportContext:
    """What the plan depends on in the Room: the level new content starts at,
    the Documents the importer sees, the Room's Tags by folded name (with the
    name they have) and whether the importer may create Tags."""

    default_visibility: DocumentVisibility
    existing: Mapping[uuid.UUID, ExistingDocument]
    room_tags: Mapping[str, tuple[uuid.UUID, str]]
    can_manage_tags: bool


@dataclass(frozen=True)
class ImportChoices:
    """What the importer chose: the keys of the Documents to import (None =
    all) and, among them, the ones to replace instead of copy."""

    selected: frozenset[str] | None = None
    replace: frozenset[str] = frozenset()


@dataclass(frozen=True)
class ImportWarning:
    """Something the import leaves out or changes in a Document, by `code`
    (the client words it): `comments_dropped` and `files_dropped` with
    `count`, `player_dropped`, `selective_to_private` with `count`,
    `tags_not_created` with `names`."""

    code: str
    count: int = 0
    names: tuple[str, ...] = ()


@dataclass(frozen=True)
class PlannedNote:
    """A Note to create, its text already in the stored format."""

    id: uuid.UUID
    title: str
    text: str
    visibility: DocumentVisibility


@dataclass(frozen=True)
class PlannedImage:
    """An image to fetch and attach, after the Documents are committed."""

    source_id: str | None
    url: str
    is_favorite: bool


@dataclass(frozen=True)
class PlannedTag:
    """A Tag to create in the Room."""

    id: uuid.UUID
    name: str
    category: str | None


@dataclass(frozen=True)
class PlannedDocument:
    """A Document the import creates (a copy, under a fresh `id`) or replaces
    (`replaces`, under the existing `id`, information only: Decision 6).
    `existing_id` is the Document of the Room the file's id points at, if any;
    `can_replace` whether the importer manages it. `visibility` is for a copy:
    a replaced Document keeps its own."""

    key: str
    file_name: str
    id: uuid.UUID
    name: str
    text: str
    visibility: DocumentVisibility
    tag_ids: tuple[uuid.UUID, ...]
    notes: tuple[PlannedNote, ...]
    images: tuple[PlannedImage, ...]
    warnings: tuple[ImportWarning, ...]
    existing_id: uuid.UUID | None
    can_replace: bool
    replaces: bool


@dataclass(frozen=True)
class ImportPlan:
    """The whole import: the Documents (selected ones only, in file order),
    the Tags to create, and the names of the Room's Tags that were matched and
    of the ones that could not be created."""

    documents: tuple[PlannedDocument, ...]
    new_tags: tuple[PlannedTag, ...]
    matched_tags: tuple[str, ...]
    unavailable_tags: tuple[str, ...]


def document_key(file_index: int, document_index: int) -> str:
    """The key a client uses for a Document of an upload: its file's place
    among the files and its own among that file's Documents. The same files
    in the same order give the same keys at preview and at import."""
    return f"{file_index}:{document_index}"


def fold(name: str) -> str:
    """A Tag name as it is matched: case and surrounding spaces ignored
    (Decision 11)."""
    return name.strip().casefold()


def validate_files(files: Sequence[ImportFile]) -> None:
    """422 unless the files are within the limits (Decision 8): at most
    `MAX_FILES` files, `MAX_DOCUMENTS` Documents and `MAX_IMAGES` images, and
    every Document named, with at most `MAX_NOTES_PER_DOCUMENT` Notes titled
    within `MAX_NOTE_TITLE_LENGTH` and Tag names within
    `MAX_TAG_NAME_LENGTH`. Called before anything is written."""
    if len(files) > MAX_FILES:
        raise ImportRefusedError("errors.import.tooManyFiles", max=MAX_FILES)
    documents = [document for file in files for document in file.documents]
    if len(documents) > MAX_DOCUMENTS:
        raise ImportRefusedError("errors.import.tooManyDocuments", max=MAX_DOCUMENTS)
    if sum(len(document.images) for document in documents) > MAX_IMAGES:
        raise ImportRefusedError("errors.import.tooManyImages", max=MAX_IMAGES)
    for document in documents:
        if not document.name.strip():
            raise ImportRefusedError("errors.import.nameRequired")
        if len(document.name) > MAX_DOCUMENT_NAME_LENGTH:
            raise ImportRefusedError(
                "errors.import.nameTooLong", name=document.name[:40], max=MAX_DOCUMENT_NAME_LENGTH
            )
        if len(document.notes) > MAX_NOTES_PER_DOCUMENT:
            raise ImportRefusedError(
                "errors.import.tooManyNotes", name=document.name, max=MAX_NOTES_PER_DOCUMENT
            )
        for note in document.notes:
            if not note.title.strip() or len(note.title.strip()) > MAX_NOTE_TITLE_LENGTH:
                raise ImportRefusedError(
                    "errors.import.noteTitleInvalid", name=document.name, max=MAX_NOTE_TITLE_LENGTH
                )
        for tag_name in document.tag_names:
            if len(tag_name) > MAX_TAG_NAME_LENGTH:
                raise ImportRefusedError(
                    "errors.import.tagNameTooLong", name=tag_name[:40], max=MAX_TAG_NAME_LENGTH
                )


def _existing_for(document: ImportDocument, context: ImportContext) -> ExistingDocument | None:
    """The Document of the Room the file's id points at, when the importer
    sees it (Decision 5)."""
    if document.source_id is None:
        return None
    try:
        return context.existing.get(uuid.UUID(document.source_id))
    except ValueError:
        return None


class _TagBook:
    """The Tags an import resolves names against: the Room's, then the ones it
    creates. A name the Room lacks is created only when the importer may
    manage Tags (Decision 11)."""

    def __init__(
        self,
        context: ImportContext,
        categories: Mapping[str, str | None],
        new_id: Callable[[], uuid.UUID],
    ) -> None:
        self._context = context
        self._categories = categories
        self._new_id = new_id
        self.created: dict[str, PlannedTag] = {}
        self.matched: dict[str, str] = {}
        self.unavailable: dict[str, str] = {}

    def lookup(self, name: str) -> tuple[uuid.UUID, str] | None:
        """The Room's or created Tag with this name, if there is one."""
        folded = fold(name)
        if folded in self._context.room_tags:
            return self._context.room_tags[folded]
        created = self.created.get(folded)
        return None if created is None else (created.id, created.name)

    def resolve(self, name: str) -> uuid.UUID | None:
        """The id of the Tag for `name`: matched, created, or None when it is
        neither and may not be created."""
        found = self.lookup(name)
        folded = fold(name)
        if found is not None:
            if folded in self._context.room_tags:
                self.matched.setdefault(folded, found[1])
            return found[0]
        if not self._context.can_manage_tags:
            self.unavailable.setdefault(folded, name.strip())
            return None
        tag = PlannedTag(self._new_id(), name.strip(), self._categories.get(folded))
        self.created[folded] = tag
        return tag.id


def _level(raw: str | None, context: ImportContext) -> tuple[DocumentVisibility, bool]:
    """The level a copied Document or a Note starts at and whether it was
    Selective turned Private (Decision 12): a Selective list names members by
    id and is never copied. No level, or one this app doesn't know, is the
    Room's default."""
    try:
        level = DocumentVisibility((raw or "").strip().lower())
    except ValueError:
        return context.default_visibility, False
    if level is DocumentVisibility.SELECTIVE:
        return DocumentVisibility.PRIVATE, True
    return level, False


def _render(
    text: Text, resolve: Callable[[MentionRef], tuple[MentionKind, uuid.UUID, str] | None]
) -> str:
    """`text` in the stored format. A mention `resolve` can place becomes a
    token (Decision 14); any other is plain `#Name` or `@Name`. Whatever else
    reads like a token is unlinked, so only the ones written here are links
    (Decision 17)."""
    parts: list[str] = []
    allowed: set[tuple[MentionKind, uuid.UUID]] = set()
    for piece in text:
        if isinstance(piece, str):
            parts.append(piece)
            continue
        target = resolve(piece)
        if target is None:
            parts.append(("@" if piece.kind is MentionKind.USER else "#") + piece.name)
        else:
            allowed.add((target[0], target[1]))
            parts.append(mention_token(target[0], target[1], target[2]))
    return unlink_mentions("".join(parts), lambda m: (m.kind, m.target_id) in allowed)


def plan_import(
    files: Sequence[ImportFile],
    context: ImportContext,
    choices: ImportChoices | None = None,
    new_id: Callable[[], uuid.UUID] = uuid.uuid4,
) -> ImportPlan:
    """The plan for `files` (already `validate_files`d) as `choices` select
    and resolve them; no choices means every Document, copied. 422 when none
    is selected, 403 (`ImportCannotReplaceError`) for a Replace of a Document
    the importer doesn't manage. A Document that is replaced keeps its id,
    owners, visibility and everything but its information (Decision 6)."""
    choices = choices or ImportChoices()
    chosen = [
        (fi, document_key(fi, di), document)
        for fi, file in enumerate(files)
        for di, document in enumerate(file.documents)
        if choices.selected is None or document_key(fi, di) in choices.selected
    ]
    if not chosen:
        raise ImportRefusedError("errors.import.nothingSelected")

    categories = {
        fold(tag.name): tag.category for file in files for tag in file.tags.values() if tag.category
    }
    book = _TagBook(context, categories, new_id)

    # The Documents' ids first: a mention of one is re-pointed to its new (or
    # replaced) id, only inside the file it is in.
    ids: dict[str, uuid.UUID] = {}
    replaced: dict[str, ExistingDocument] = {}
    targets: dict[tuple[int, str], tuple[uuid.UUID, str]] = {}
    for fi, key, document in chosen:
        existing = _existing_for(document, context)
        if existing is not None and key in choices.replace:
            if not existing.can_manage:
                raise ImportCannotReplaceError("errors.import.cannotReplace", name=document.name)
            replaced[key] = existing
            ids[key] = existing.id
        else:
            ids[key] = new_id()
        if document.source_id is not None:
            targets.setdefault((fi, document.source_id), (ids[key], document.name.strip()))

    # Every Document's Tags before any text, so a mention of a Tag another
    # Document makes the import create still finds it.
    tags: dict[str, tuple[list[uuid.UUID], list[str]]] = {}
    for _, key, document in chosen:
        resolved: list[uuid.UUID] = []
        missing: list[str] = []
        wanted = {fold(name): name for name in reversed(document.tag_names)}
        for tag_name in reversed(list(wanted.values())):
            tag_id = book.resolve(tag_name)
            if tag_id is None:
                missing.append(tag_name)
            elif tag_id not in resolved:
                resolved.append(tag_id)
        tags[key] = (resolved, missing)

    planned = [
        _plan_document(
            files[fi],
            fi,
            key,
            document,
            ids[key],
            replaced.get(key),
            tags[key],
            context,
            book,
            targets,
            new_id,
        )
        for fi, key, document in chosen
    ]
    return ImportPlan(
        documents=tuple(planned),
        new_tags=tuple(book.created.values()),
        matched_tags=tuple(book.matched.values()),
        unavailable_tags=tuple(book.unavailable.values()),
    )


def _plan_document(
    file: ImportFile,
    file_index: int,
    key: str,
    document: ImportDocument,
    document_id: uuid.UUID,
    replacing: ExistingDocument | None,
    resolved_tags: tuple[list[uuid.UUID], list[str]],
    context: ImportContext,
    book: _TagBook,
    targets: Mapping[tuple[int, str], tuple[uuid.UUID, str]],
    new_id: Callable[[], uuid.UUID],
) -> PlannedDocument:
    """One selected Document: its levels, its texts with the mentions
    re-pointed, the images still to fetch and what is dropped."""
    tag_ids, missing = resolved_tags

    def resolve(ref: MentionRef) -> tuple[MentionKind, uuid.UUID, str] | None:
        """Where a mention of the file points now, if it still can."""
        if ref.kind is MentionKind.DOCUMENT:
            target = targets.get((file_index, ref.key))
            return None if target is None else (MentionKind.DOCUMENT, target[0], target[1])
        if ref.kind is MentionKind.TAG:
            tag = file.tags.get(ref.key)
            found = book.lookup(tag.name if tag else ref.name)
            return None if found is None else (MentionKind.TAG, found[0], found[1])
        return None

    level, selective = _level(document.visibility, context)
    if replacing is not None:
        selective = False  # a replaced Document keeps its own level
    selective_count = int(selective)
    notes = []
    for note in document.notes:
        note_level, note_selective = _level(note.visibility, context)
        selective_count += note_selective
        notes.append(
            PlannedNote(new_id(), note.title.strip(), _render(note.text, resolve), note_level)
        )

    warnings: list[ImportWarning] = []
    if document.comment_count:
        warnings.append(ImportWarning("comments_dropped", document.comment_count))
    if document.file_count:
        warnings.append(ImportWarning("files_dropped", document.file_count))
    if document.has_player:
        warnings.append(ImportWarning("player_dropped"))
    if selective_count:
        warnings.append(ImportWarning("selective_to_private", selective_count))
    if missing:
        warnings.append(ImportWarning("tags_not_created", names=tuple(missing)))

    # A Replace does not fetch again an image the Document still has; the
    # file's favorite goes first so it is the one stored first (Decision 15).
    kept = replacing.image_ids if replacing is not None else frozenset[str]()
    images = sorted(
        (i for i in document.images if i.source_id is None or i.source_id not in kept),
        key=lambda image: not image.is_favorite,
    )
    existing = _existing_for(document, context)
    return PlannedDocument(
        key=key,
        file_name=file.name,
        id=document_id,
        name=document.name.strip(),
        text=_render(document.text, resolve),
        visibility=level,
        tag_ids=tuple(tag_ids),
        notes=tuple(notes),
        images=tuple(PlannedImage(i.source_id, i.url, i.is_favorite) for i in images),
        warnings=tuple(warnings),
        existing_id=existing.id if existing else None,
        can_replace=bool(existing and existing.can_manage),
        replaces=replacing is not None,
    )

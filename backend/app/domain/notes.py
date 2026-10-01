"""Rules for Notes (spec 12): who manages them, their title and count limits,
their order, and when an edit must be audited. Who can *see* a Note is
`visibility.is_note_visible`, the same filter as every other content."""

import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass, replace
from datetime import datetime

from app.domain.documents import is_owner
from app.domain.errors import DomainError
from app.domain.models import AuditLogEntry, DocumentVisibility, Note, RoomRole

MAX_NOTE_TITLE_LENGTH = 200
MAX_NOTES_PER_DOCUMENT = 50

NOTE_VISIBILITY_CHANGED = "note_visibility_changed"


class NoteTitleRequiredError(DomainError):
    """The Note title is empty once trimmed."""


class NoteTitleTooLongError(DomainError):
    """The Note title is over `MAX_NOTE_TITLE_LENGTH`."""


class NotNoteManagerError(DomainError):
    """The requester is neither an Owner of the Document nor the Master."""


class TooManyNotesError(DomainError):
    """The Document already has `MAX_NOTES_PER_DOCUMENT` Notes."""


class InvalidNoteOrderError(DomainError):
    """The requested order isn't exactly the Notes the requester can see."""


@dataclass(frozen=True)
class NoteEditPlan:
    """The edited Note, and the audit entry to write with it when the edit
    changes who can see it."""

    note: Note
    # Invariant 7 / VR-08: set only when the edit changes who can see the
    # Note, and written in the same transaction as the edit itself.
    audit_entry: AuditLogEntry | None


def can_manage_notes(
    role: RoomRole, user_id: uuid.UUID, owner_user_ids: Collection[uuid.UUID]
) -> bool:
    """Section 9: Notes are part of the Document, so whoever may edit its
    description may manage them - its Owners and the Master (D-12)."""
    return is_owner(role, user_id, owner_user_ids)


def ensure_can_manage_notes(
    role: RoomRole, user_id: uuid.UUID, owner_user_ids: Collection[uuid.UUID]
) -> None:
    """Raises `NotNoteManagerError` unless `can_manage_notes` holds - the check
    before any change to a Note (Invariant 6)."""
    if not can_manage_notes(role, user_id, owner_user_ids):
        raise NotNoteManagerError("errors.note.notOwner")


def _clean_title(title: str) -> str:
    """Trims the title and enforces that it's non-empty and within
    `MAX_NOTE_TITLE_LENGTH`."""
    clean = title.strip()
    if not clean:
        raise NoteTitleRequiredError("errors.note.titleRequired")
    if len(clean) > MAX_NOTE_TITLE_LENGTH:
        raise NoteTitleTooLongError("errors.note.titleTooLong", max=MAX_NOTE_TITLE_LENGTH)
    return clean


def plan_new_note(
    document_id: uuid.UUID,
    creator_id: uuid.UUID,
    title: str,
    description: str,
    visibility: DocumentVisibility,
    existing: Sequence[Note],
    now: datetime,
) -> Note:
    """Spec 12: a new Note, placed after every existing one. `existing` is
    *all* of the Document's Notes, hidden from the creator or not, so the cap
    and the position can't be dodged by a Note they can't see. The caller has
    already checked the creator may manage Notes."""
    if len(existing) >= MAX_NOTES_PER_DOCUMENT:
        raise TooManyNotesError("errors.note.tooMany", max=MAX_NOTES_PER_DOCUMENT)
    return Note(
        id=uuid.uuid4(),
        document_id=document_id,
        title=_clean_title(title),
        description=description,
        visibility=visibility,
        position=max((note.position for note in existing), default=-1) + 1,
        created_by=creator_id,
        created_at=now,
        updated_at=now,
    )


def plan_note_edit(
    note: Note,
    room_id: uuid.UUID,
    editor_id: uuid.UUID,
    now: datetime,
    title: str | None = None,
    description: str | None = None,
    visibility: DocumentVisibility | None = None,
    current_selective_ids: Collection[uuid.UUID] = (),
    new_selective_ids: Collection[uuid.UUID] | None = None,
) -> NoteEditPlan:
    """Edits a Note; omitted fields stay. Changing its visibility level or its
    Selective grants produces an audit entry (VR-08, Invariant 7); editing
    only the text does not."""
    updated = replace(
        note,
        title=note.title if title is None else _clean_title(title),
        description=note.description if description is None else description,
        visibility=note.visibility if visibility is None else visibility,
        updated_at=now,
    )

    grants_changed = new_selective_ids is not None and set(new_selective_ids) != set(
        current_selective_ids
    )
    audit_entry = None
    if updated.visibility != note.visibility or grants_changed:
        audit_entry = AuditLogEntry(
            id=uuid.uuid4(),
            room_id=room_id,
            actor_user_id=editor_id,
            target_user_id=None,
            action=NOTE_VISIBILITY_CHANGED,
            details={
                "note_id": str(note.id),
                "document_id": str(note.document_id),
                "from": note.visibility.value,
                "to": updated.visibility.value,
                "selective_user_ids": sorted(
                    str(user_id)
                    for user_id in (
                        current_selective_ids if new_selective_ids is None else new_selective_ids
                    )
                ),
            },
        )
    return NoteEditPlan(note=updated, audit_entry=audit_entry)


def plan_note_order(
    all_ids: Sequence[uuid.UUID],
    visible_ids: Collection[uuid.UUID],
    requested_ids: Sequence[uuid.UUID],
) -> list[uuid.UUID]:
    """The new order of *all* a Document's Notes, given the order the
    requester asked for among the ones they can see.

    `all_ids` is every Note in current order. The requester can only name the
    Notes they see, so a Note hidden from them keeps its own slot and the
    visible ones are dealt into the remaining slots in the requested order -
    the request neither needs nor reveals a hidden Note's id (VR-07).
    `requested_ids` must be exactly `visible_ids`, each once."""
    if len(requested_ids) != len(set(requested_ids)) or set(requested_ids) != set(visible_ids):
        raise InvalidNoteOrderError("errors.note.invalidOrder")
    requested = iter(requested_ids)
    return [next(requested) if note_id in visible_ids else note_id for note_id in all_ids]

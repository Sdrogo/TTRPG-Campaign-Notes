"""The visibility history (FR-V5, VR-08, spec 22 Decision 4): the AuditLog rows
that record who changed who sees what, readable by the Master and the
Administrators. An Administrator who isn't the Master may not see every piece
of content, so an entry about content they can't see doesn't name it
(VR-07)."""

import uuid
from collections.abc import Collection
from dataclasses import dataclass
from enum import StrEnum

from app.domain.comments import COMMENT_VISIBILITY_CHANGED
from app.domain.documents import DOCUMENT_VISIBILITY_CHANGED
from app.domain.errors import DomainError
from app.domain.models import AuditLogEntry, ContentKind, Membership, RoomRole
from app.domain.notes import NOTE_VISIBILITY_CHANGED
from app.domain.reveal import REVEAL_ACTIONS

# Entries shown per page of the history.
HISTORY_PAGE_SIZE = 50

# Every AuditLog action the history shows, with the kind of content it is
# about and whether it is a Reveal.
HISTORY_ACTIONS: dict[str, tuple[ContentKind, bool]] = {
    DOCUMENT_VISIBILITY_CHANGED: (ContentKind.DOCUMENT, False),
    NOTE_VISIBILITY_CHANGED: (ContentKind.NOTE, False),
    COMMENT_VISIBILITY_CHANGED: (ContentKind.COMMENT, False),
    **{action: (kind, True) for kind, action in REVEAL_ACTIONS.items()},
}


class CannotReadHistoryError(DomainError):
    """Neither the Master nor an Administrator (spec 22 Decision 4)."""


class ContentState(StrEnum):
    """How an entry's content stands for the viewer now."""

    VISIBLE = "visible"
    # The viewer can't see it: the entry doesn't name it (VR-07).
    HIDDEN = "hidden"
    # It no longer exists.
    DELETED = "deleted"


@dataclass(frozen=True)
class HistoryEntry:
    """One AuditLog row as the history shows it to one viewer. The ids and
    the before/after grants and recipients are withheld unless the content is
    visible to them."""

    entry: AuditLogEntry
    kind: ContentKind
    is_reveal: bool
    state: ContentState
    document_id: uuid.UUID | None
    note_id: uuid.UUID | None
    comment_id: uuid.UUID | None
    selective_user_ids: list[uuid.UUID]
    recipient_ids: list[uuid.UUID]


def can_read_history(membership: Membership) -> bool:
    """The Master and the Administrators read the history (spec 22 Decision
    4)."""
    return membership.role == RoomRole.MASTER or membership.is_admin


def ensure_can_read_history(membership: Membership) -> None:
    """Raises `CannotReadHistoryError` unless `can_read_history` holds."""
    if not can_read_history(membership):
        raise CannotReadHistoryError("errors.history.forbidden")


def history_actions(kind: ContentKind | None) -> list[str]:
    """The AuditLog actions to read, all of them or one kind's."""
    return sorted(
        action
        for action, (action_kind, _) in HISTORY_ACTIONS.items()
        if kind is None or kind == action_kind
    )


def _uuid(details: dict[str, object], key: str) -> uuid.UUID | None:
    """A UUID stored as a string in an entry's details, if any."""
    value = details.get(key)
    return uuid.UUID(value) if isinstance(value, str) else None


def _uuids(details: dict[str, object], key: str) -> list[uuid.UUID]:
    """A list of UUIDs stored as strings in an entry's details."""
    value = details.get(key)
    if not isinstance(value, list):
        return []
    return [uuid.UUID(item) for item in value if isinstance(item, str)]


ContentIds = tuple[uuid.UUID | None, uuid.UUID | None, uuid.UUID | None]


def content_ids(entry: AuditLogEntry) -> ContentIds:
    """The (Document, Note, Comment) ids an entry is about."""
    return (
        _uuid(entry.details, "document_id"),
        _uuid(entry.details, "note_id"),
        _uuid(entry.details, "comment_id"),
    )


def history_entry(
    entry: AuditLogEntry,
    existing_ids: Collection[uuid.UUID],
    visible_ids: Collection[uuid.UUID],
) -> HistoryEntry:
    """An AuditLog row for the history, redacted for one viewer: the content
    it is about (the Note or the Comment, else the Document) is named only
    when it still exists and `visible_ids` holds it - the viewer sees it now,
    everything around it included. Otherwise every id and user list is
    withheld, so an Administrator who isn't the Master learns only that "a
    hidden Document / Note / Comment" changed (VR-07). `entry.action` must be
    one of `HISTORY_ACTIONS`."""
    kind, is_reveal = HISTORY_ACTIONS[entry.action]
    document_id, note_id, comment_id = content_ids(entry)
    subject = note_id or comment_id or document_id
    if subject is None or subject not in existing_ids:
        state = ContentState.DELETED
    elif subject not in visible_ids:
        state = ContentState.HIDDEN
    else:
        state = ContentState.VISIBLE
    shown = state == ContentState.VISIBLE
    return HistoryEntry(
        entry=entry,
        kind=kind,
        is_reveal=is_reveal,
        state=state,
        document_id=document_id if shown else None,
        note_id=note_id if shown else None,
        comment_id=comment_id if shown else None,
        selective_user_ids=_uuids(entry.details, "selective_user_ids") if shown else [],
        recipient_ids=_uuids(entry.details, "recipient_ids") if shown else [],
    )

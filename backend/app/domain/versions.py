"""History of a whole Document: its name, its description and its Notes
(spec 24b, FR-D5, replacing spec 24's separate Note histories). A revision is
the Document's text as it was after a save. Every change writes one, except
that saves by the same person within `MERGE_WINDOW` update the latest, so a
typing session leaves one revision instead of a flood. Restoring never
rewrites history: it appends a revision with the old state.

A Note keeps its visibility of its own (VR-03), so a revision is only ever
shown projected on the Notes a viewer may see (`visible_note_ids`,
`visible_history`), never as stored (VR-07)."""

import re
import uuid
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from difflib import SequenceMatcher

from app.domain.models import DocumentVisibility, Note, RoomRole
from app.domain.notes import MAX_NOTES_PER_DOCUMENT, TooManyNotesError
from app.domain.visibility import is_content_visible

# Saves by the same editor closer together than this, measured from the
# latest revision's last save, merge into it (spec 24 Decision 2).
MERGE_WINDOW = timedelta(minutes=10)


@dataclass(frozen=True)
class NoteState:
    """A Note as a revision holds it. The visibility and grants aren't
    versioned (spec 24b Decision 1): they are kept so a deleted Note can still
    be judged for a viewer, and they are rewritten in the latest revision when
    they change."""

    id: uuid.UUID
    title: str
    description: str
    visibility: DocumentVisibility
    selective_user_ids: tuple[uuid.UUID, ...] = ()

    def text(self) -> tuple[uuid.UUID, str, str]:
        """What a revision versions of the Note."""
        return (self.id, self.title, self.description)


@dataclass(frozen=True)
class DocumentState:
    """The Document's name and description and its Notes in display order."""

    name: str
    description: str
    notes: tuple[NoteState, ...] = ()

    def same_text(self, other: "DocumentState") -> bool:
        """Whether two states read the same: names, descriptions, and Notes
        with their texts and order. Visibility doesn't count."""
        return (
            self.name == other.name
            and self.description == other.description
            and [note.text() for note in self.notes] == [note.text() for note in other.notes]
        )

    def only(self, note_ids: Collection[uuid.UUID]) -> "DocumentState":
        """The state with only the Notes in `note_ids`, in the same order."""
        return replace(self, notes=tuple(note for note in self.notes if note.id in note_ids))


@dataclass(frozen=True)
class Version:
    """One revision. `created_at` is when it first appeared, `updated_at` the
    last save merged into it."""

    id: uuid.UUID
    state: DocumentState
    edited_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class VersionWrite:
    """What to store for a save: `version` is a new row when `is_new`, the
    latest row with its state (and maybe its time) replaced otherwise."""

    version: Version
    is_new: bool


@dataclass(frozen=True)
class ChangeSize:
    """What a revision changed against the one before, as one viewer sees it:
    words added and removed (the name, the description and the Notes' titles
    and texts together), and Notes added and removed."""

    words_added: int
    words_removed: int
    notes_added: int
    notes_removed: int


@dataclass(frozen=True)
class RestorePlan:
    """What a restore does to the Notes the restorer sees: `rewrite` the
    existing ones in the revision, `recreate` the ones deleted since, `delete`
    the ones added since; `order` is every Note of the Document afterwards,
    hidden ones included, in display order."""

    rewrite: list[NoteState]
    recreate: list[NoteState]
    delete: list[uuid.UUID]
    order: list[uuid.UUID]


def plan_version(
    latest: Version | None,
    editor: uuid.UUID,
    now: datetime,
    state: DocumentState,
    *,
    force_new: bool = False,
) -> VersionWrite | None:
    """What a save of this state writes, or None when nothing changed. A
    change of Note visibility alone rewrites the latest revision in place
    (keeping its time and author), so a deleted Note is judged by the
    visibility it had last (spec 24b). Otherwise the same editor within
    `MERGE_WINDOW` of the latest revision's last save updates it; anyone else,
    a later save, or one that removes a Note (whose text must stay in the
    latest revision to be restorable) appends. `force_new` (a restore) always appends, so the
    old state becomes a revision of its own and is never folded into the one
    before it."""
    if latest is not None and latest.state.same_text(state):
        if latest.state == state:
            return None
        return VersionWrite(replace(latest, state=state), False)
    mergeable = (
        latest is not None
        and not force_new
        and latest.edited_by == editor
        and now - latest.updated_at <= MERGE_WINDOW
        and {note.id for note in latest.state.notes} <= {note.id for note in state.notes}
    )
    if mergeable and latest is not None:
        return VersionWrite(replace(latest, state=state, updated_at=now), False)
    return VersionWrite(Version(uuid.uuid4(), state, editor, now, now), True)


def visible_note_ids(
    history: Sequence[Version],
    current_note_ids: Collection[uuid.UUID],
    current_visible_ids: Collection[uuid.UUID],
    viewer_user_id: uuid.UUID,
    viewer_role: RoomRole,
    document_owner_ids: Collection[uuid.UUID],
) -> set[uuid.UUID]:
    """The Notes of a Document's history this viewer may read (VR-03, VR-07):
    a Note that still exists if they see it now, a deleted one if they would
    have seen it with the visibility and grants of the newest revision holding
    it, which is the one it had when it was deleted. `history` is newest
    first."""
    visible = set(current_visible_ids)
    judged = set(current_note_ids)
    for version in history:
        for note in version.state.notes:
            if note.id in judged:
                continue
            judged.add(note.id)
            if is_content_visible(
                note.visibility,
                viewer_user_id,
                viewer_role,
                document_owner_ids,
                note.selective_user_ids,
            ):
                visible.add(note.id)
    return visible


def visible_history(
    history: Sequence[Version], note_ids: Collection[uuid.UUID]
) -> list[tuple[Version, DocumentState]]:
    """The history as a viewer who reads `note_ids` sees it, newest first, each
    revision with its projected state. A revision that reads the same as the
    one before it once projected changed only what the viewer can't see, so
    it is left out: of a run of identical projections, the earliest (the one
    that brought that text) is kept (VR-07)."""
    kept: list[tuple[Version, DocumentState]] = []
    for version in reversed(history):
        projected = version.state.only(note_ids)
        if kept and kept[-1][1].same_text(projected):
            continue
        kept.append((version, projected))
    kept.reverse()
    return kept


def _word_changes(old: str, new: str) -> tuple[int, int]:
    """Words added and removed between two texts, comparing whitespace-split
    words in order."""
    old_words = re.findall(r"\S+", old)
    new_words = re.findall(r"\S+", new)
    added = removed = 0
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, old_words, new_words).get_opcodes():
        if tag in ("replace", "delete"):
            removed += i2 - i1
        if tag in ("replace", "insert"):
            added += j2 - j1
    return added, removed


def change_size(previous: DocumentState, current: DocumentState) -> ChangeSize:
    """What `current` changed against `previous` (the list's "+12 −3"). A Note
    is matched by id; one added counts its words as added, one removed as
    removed. Pass projected states, so only what the viewer sees is counted."""
    pairs: list[tuple[str, str]] = [
        (previous.name, current.name),
        (previous.description, current.description),
    ]
    before = {note.id: note for note in previous.notes}
    after = {note.id: note for note in current.notes}
    for note_id in before.keys() | after.keys():
        old, new = before.get(note_id), after.get(note_id)
        pairs.append((old.title if old else "", new.title if new else ""))
        pairs.append((old.description if old else "", new.description if new else ""))
    added = removed = 0
    for old_text, new_text in pairs:
        words_added, words_removed = _word_changes(old_text, new_text)
        added += words_added
        removed += words_removed
    return ChangeSize(
        added,
        removed,
        notes_added=len(after.keys() - before.keys()),
        notes_removed=len(before.keys() - after.keys()),
    )


def plan_restore(
    target: DocumentState,
    current_note_ids: Sequence[uuid.UUID],
    current_visible_ids: Collection[uuid.UUID],
) -> RestorePlan:
    """How to put the Notes back as in `target`, already projected for the
    restorer (spec 24b Decision 5). A Note hidden from them keeps its slot and
    is never touched; the visible ones are dealt into the remaining slots in
    the revision's order, extra ones after the last Note. `current_note_ids`
    is every Note in display order. Raises `TooManyNotesError` when the
    result would pass `MAX_NOTES_PER_DOCUMENT` (Notes hidden from the restorer
    were added since)."""
    target_ids = [note.id for note in target.notes]
    existing = set(current_note_ids)
    delete = [
        note_id
        for note_id in current_note_ids
        if note_id in current_visible_ids and note_id not in target_ids
    ]
    remaining = [note_id for note_id in current_note_ids if note_id not in delete]
    dealt = iter(target_ids)
    order = [next(dealt) if note_id in current_visible_ids else note_id for note_id in remaining]
    order.extend(dealt)
    if len(order) > MAX_NOTES_PER_DOCUMENT:
        raise TooManyNotesError("errors.note.tooMany", max=MAX_NOTES_PER_DOCUMENT)
    return RestorePlan(
        rewrite=[note for note in target.notes if note.id in existing],
        recreate=[note for note in target.notes if note.id not in existing],
        delete=delete,
        order=order,
    )


def note_states(
    notes: Iterable[Note], grants: Mapping[uuid.UUID, Collection[uuid.UUID]]
) -> tuple[NoteState, ...]:
    """A Document's Notes (in display order) as a revision holds them, with
    their grants sorted so equal states compare equal."""
    return tuple(
        NoteState(
            note.id,
            note.title,
            note.description,
            note.visibility,
            tuple(sorted(grants.get(note.id, ()))),
        )
        for note in notes
    )

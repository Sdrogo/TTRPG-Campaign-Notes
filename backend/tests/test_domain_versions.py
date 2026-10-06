"""Whole-Document history (spec 24b): when a save appends a revision and when
it merges into the latest, what a viewer sees of it (VR-07), the change size,
and how a restore puts the Notes back."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.domain.models import DocumentVisibility, Note, RoomRole
from app.domain.notes import TooManyNotesError
from app.domain.versions import (
    MERGE_WINDOW,
    DocumentState,
    NoteState,
    Version,
    change_size,
    note_states,
    plan_restore,
    plan_version,
    visible_history,
    visible_note_ids,
)

EDITOR = uuid.uuid4()
OTHER = uuid.uuid4()
T0 = datetime(2026, 10, 6, 12, 0, tzinfo=UTC)
A, B, C = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


def _note(
    note_id: uuid.UUID,
    description: str = "Text.",
    visibility: DocumentVisibility = DocumentVisibility.ROOM,
    grants: tuple[uuid.UUID, ...] = (),
) -> NoteState:
    return NoteState(note_id, f"Note {note_id}", description, visibility, grants)


def _state(description: str = "A vampire.", *notes: NoteState) -> DocumentState:
    return DocumentState("Strahd", description, tuple(notes))


def _version(
    state: DocumentState | None = None, editor: uuid.UUID = EDITOR, at: datetime = T0
) -> Version:
    return Version(uuid.uuid4(), state or _state(), editor, at, at)


# --- Appending and merging (spec 24 Decision 2, spec 24b Decision 2) ---------


def test_the_first_save_appends() -> None:
    write = plan_version(None, EDITOR, T0, _state())

    assert write is not None and write.is_new
    assert write.version.state == _state()
    assert write.version.edited_by == EDITOR
    assert write.version.created_at == write.version.updated_at == T0


def test_the_same_editor_inside_the_window_merges_into_the_latest() -> None:
    latest = _version()

    write = plan_version(latest, EDITOR, T0 + timedelta(minutes=3), _state("Lord.", _note(A)))

    assert write is not None and not write.is_new
    assert write.version.id == latest.id
    assert write.version.state.notes == (_note(A),)
    assert write.version.created_at == T0
    assert write.version.updated_at == T0 + timedelta(minutes=3)


def test_the_window_runs_from_the_last_merged_save() -> None:
    latest = _version()
    merged = plan_version(latest, EDITOR, T0 + timedelta(minutes=8), _state("One."))
    assert merged is not None

    write = plan_version(merged.version, EDITOR, T0 + timedelta(minutes=16), _state("Two."))

    assert write is not None and not write.is_new


def test_past_the_window_another_editor_or_a_restore_appends() -> None:
    latest = _version()
    later = T0 + MERGE_WINDOW + timedelta(seconds=1)

    for write in (
        plan_version(latest, EDITOR, later, _state("Two.")),
        plan_version(latest, OTHER, T0, _state("Two.")),
        plan_version(latest, EDITOR, T0, _state("Two."), force_new=True),
    ):
        assert write is not None and write.is_new


def test_removing_a_note_never_merges_so_its_text_stays_restorable() -> None:
    latest = _version(_state("A vampire.", _note(A), _note(B)))

    write = plan_version(latest, EDITOR, T0 + timedelta(minutes=1), _state("A vampire.", _note(A)))

    assert write is not None and write.is_new


def test_an_unchanged_state_writes_nothing() -> None:
    latest = _version(_state("A vampire.", _note(A)))

    assert plan_version(latest, OTHER, T0, _state("A vampire.", _note(A))) is None
    assert plan_version(latest, OTHER, T0, _state("A vampire.", _note(A)), force_new=True) is None


def test_a_note_visibility_change_rewrites_the_latest_without_a_new_revision() -> None:
    latest = _version(_state("A vampire.", _note(A)), at=T0 - timedelta(days=1))
    hidden = _state("A vampire.", _note(A, visibility=DocumentVisibility.MASTER))

    write = plan_version(latest, OTHER, T0, hidden)

    assert write is not None and not write.is_new
    assert write.version.state == hidden
    assert (write.version.edited_by, write.version.updated_at) == (EDITOR, latest.updated_at)


def test_reordering_notes_is_a_change() -> None:
    latest = _version(_state("A vampire.", _note(A), _note(B)))

    write = plan_version(latest, OTHER, T0, _state("A vampire.", _note(B), _note(A)))

    assert write is not None and write.is_new


# --- What a viewer sees (VR-03, VR-07) -------------------------------------


def test_an_existing_note_is_judged_by_its_visibility_now() -> None:
    history = [_version(_state("x", _note(A, visibility=DocumentVisibility.MASTER)))]

    seen = visible_note_ids(history, [A], [A], EDITOR, RoomRole.PLAYER, [EDITOR])
    unseen = visible_note_ids(history, [A], [], EDITOR, RoomRole.PLAYER, [EDITOR])

    assert seen == {A}
    assert unseen == set()


def test_a_deleted_note_is_judged_by_the_newest_revision_holding_it() -> None:
    # Newest first: B was narrowed to the Master before it was deleted.
    history = [
        _version(_state("x")),
        _version(
            _state(
                "x",
                _note(B, visibility=DocumentVisibility.MASTER),
                _note(C, visibility=DocumentVisibility.SELECTIVE, grants=(OTHER,)),
            )
        ),
        _version(_state("x", _note(A), _note(B))),
    ]

    player = visible_note_ids(history, [], [], OTHER, RoomRole.PLAYER, [EDITOR])
    master = visible_note_ids(history, [], [], EDITOR, RoomRole.MASTER, [])

    assert player == {A, C}
    assert master == {A, B, C}


def test_a_revision_that_only_changed_hidden_notes_is_left_out() -> None:
    first = _version(_state("x", _note(A)), at=T0)
    hidden_edit = _version(_state("x", _note(A), _note(B)), editor=OTHER, at=T0 + MERGE_WINDOW)
    visible_edit = _version(_state("y", _note(A), _note(B)), at=T0 + 2 * MERGE_WINDOW)

    seen = visible_history([visible_edit, hidden_edit, first], {A})

    assert [version.id for version, _ in seen] == [visible_edit.id, first.id]
    assert [note.id for note in seen[0][1].notes] == [A]


# --- Change size -----------------------------------------------------------


def test_the_change_size_counts_words_and_notes_matched_by_id() -> None:
    before = _state("A vampire.", _note(A, "One two."), _note(B, "Gone."))
    after = _state("A vampire lord.", _note(A, "One three."), _note(C, "New text here."))

    size = change_size(before, after)

    # "lord." + "three." + C's title (2) and text (3); "vampire." + "two." +
    # B's title (2) and text (1).
    assert (size.words_added, size.words_removed) == (8, 5)
    assert (size.notes_added, size.notes_removed) == (1, 1)


# --- Restore (spec 24b Decision 5) -----------------------------------------


def test_a_restore_rewrites_recreates_deletes_and_keeps_hidden_slots() -> None:
    hidden = uuid.uuid4()
    target = _state("x", _note(B), _note(A))

    plan = plan_restore(target, [A, hidden, C], {A, C})

    assert plan.rewrite == [_note(A)]
    assert plan.recreate == [_note(B)]
    assert plan.delete == [C]
    assert plan.order == [B, hidden, A]


def test_a_restore_past_the_cap_is_refused() -> None:
    target = _state("x", _note(A))
    hidden = [uuid.uuid4() for _ in range(50)]

    with pytest.raises(TooManyNotesError):
        plan_restore(target, hidden, set())


def test_note_states_sort_grants_and_keep_the_order() -> None:
    def note(note_id: uuid.UUID) -> Note:
        visibility = DocumentVisibility.SELECTIVE
        return Note(note_id, uuid.uuid4(), "T", "D", visibility, 0, EDITOR, T0, T0)

    low, high = sorted([uuid.uuid4(), uuid.uuid4()])

    states = note_states([note(B), note(A)], {B: [high, low]})

    assert [state.id for state in states] == [B, A]
    assert states[0].selective_user_ids == (low, high)
    assert states[1].selective_user_ids == ()

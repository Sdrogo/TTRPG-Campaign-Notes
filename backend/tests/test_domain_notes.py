import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.domain.models import DocumentVisibility, Note, RoomRole
from app.domain.notes import (
    MAX_NOTE_TITLE_LENGTH,
    MAX_NOTES_PER_DOCUMENT,
    NOTE_VISIBILITY_CHANGED,
    InvalidNoteOrderError,
    NoteTitleRequiredError,
    NoteTitleTooLongError,
    NotNoteManagerError,
    TooManyNotesError,
    can_manage_notes,
    ensure_can_manage_notes,
    plan_new_note,
    plan_note_edit,
    plan_note_order,
)
from app.domain.visibility import is_note_visible

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
LATER = NOW + timedelta(minutes=5)
ROOM_ID = uuid.uuid4()
DOCUMENT_ID = uuid.uuid4()
OWNER = uuid.uuid4()
OTHER = uuid.uuid4()


def _note(
    visibility: DocumentVisibility = DocumentVisibility.ROOM, existing: list[Note] | None = None
) -> Note:
    return plan_new_note(
        DOCUMENT_ID, OWNER, "Secret door", "Behind the bookcase.", visibility, existing or [], NOW
    )


def test_new_note_trims_the_title_and_stamps_both_timestamps() -> None:
    note = plan_new_note(
        DOCUMENT_ID, OWNER, "  Secret door  ", "x", DocumentVisibility.PRIVATE, [], NOW
    )

    assert note.title == "Secret door"
    assert note.description == "x"
    assert note.visibility == DocumentVisibility.PRIVATE
    assert note.created_by == OWNER
    assert note.created_at == note.updated_at == NOW


def test_new_note_goes_after_every_existing_one() -> None:
    first = _note()
    second = _note(existing=[first])
    third = _note(existing=[first, second])

    assert [first.position, second.position, third.position] == [0, 1, 2]


def test_new_note_position_follows_the_highest_not_the_count() -> None:
    # A gap (a deleted Note) must not make a new Note collide with a survivor.
    first = _note()
    survivor = Note(**{**first.__dict__, "id": uuid.uuid4(), "position": 7})

    assert _note(existing=[survivor]).position == 8


@pytest.mark.parametrize("title", ["", "   "])
def test_new_note_needs_a_title(title: str) -> None:
    with pytest.raises(NoteTitleRequiredError) as exc_info:
        plan_new_note(DOCUMENT_ID, OWNER, title, "", DocumentVisibility.ROOM, [], NOW)
    assert exc_info.value.key == "errors.note.titleRequired"


def test_title_length_limit() -> None:
    plan_new_note(
        DOCUMENT_ID, OWNER, "x" * MAX_NOTE_TITLE_LENGTH, "", DocumentVisibility.ROOM, [], NOW
    )
    with pytest.raises(NoteTitleTooLongError):
        plan_new_note(
            DOCUMENT_ID,
            OWNER,
            "x" * (MAX_NOTE_TITLE_LENGTH + 1),
            "",
            DocumentVisibility.ROOM,
            [],
            NOW,
        )


def test_a_document_is_capped_at_the_note_limit() -> None:
    full = [_note() for _ in range(MAX_NOTES_PER_DOCUMENT)]

    with pytest.raises(TooManyNotesError):
        _note(existing=full)
    _note(existing=full[:-1])


def test_description_has_no_length_rule_like_a_document_description() -> None:
    note = plan_new_note(DOCUMENT_ID, OWNER, "T", "y" * 100_000, DocumentVisibility.ROOM, [], NOW)
    assert len(note.description) == 100_000


@pytest.mark.parametrize(
    ("role", "user_id", "owners", "allowed"),
    [
        (RoomRole.MASTER, OTHER, [], True),
        (RoomRole.PLAYER, OWNER, [OWNER], True),
        (RoomRole.PLAYER, OTHER, [OWNER], False),
    ],
)
def test_only_owners_and_the_master_manage_notes(
    role: RoomRole, user_id: uuid.UUID, owners: list[uuid.UUID], allowed: bool
) -> None:
    assert can_manage_notes(role, user_id, owners) is allowed
    if allowed:
        ensure_can_manage_notes(role, user_id, owners)
    else:
        with pytest.raises(NotNoteManagerError):
            ensure_can_manage_notes(role, user_id, owners)


def test_edit_changes_only_what_was_given() -> None:
    note = _note()

    plan = plan_note_edit(note, ROOM_ID, OWNER, LATER, description="New text")

    assert plan.note.title == note.title
    assert plan.note.description == "New text"
    assert plan.note.visibility == note.visibility
    assert plan.note.updated_at == LATER
    assert plan.note.created_at == NOW
    assert plan.audit_entry is None


def test_edit_retitles_and_validates_the_title() -> None:
    note = _note()

    assert plan_note_edit(note, ROOM_ID, OWNER, LATER, title=" Hidden ").note.title == "Hidden"
    with pytest.raises(NoteTitleRequiredError):
        plan_note_edit(note, ROOM_ID, OWNER, LATER, title=" ")


def test_a_visibility_change_is_audited() -> None:
    note = _note()

    plan = plan_note_edit(note, ROOM_ID, OWNER, LATER, visibility=DocumentVisibility.MASTER)

    entry = plan.audit_entry
    assert entry is not None
    assert entry.action == NOTE_VISIBILITY_CHANGED
    assert entry.room_id == ROOM_ID
    assert entry.actor_user_id == OWNER
    assert entry.details == {
        "note_id": str(note.id),
        "document_id": str(DOCUMENT_ID),
        "from": "room",
        "to": "master",
        "selective_user_ids": [],
    }


def test_a_changed_grant_list_is_audited_and_an_identical_one_is_not() -> None:
    note = _note(DocumentVisibility.SELECTIVE)

    changed = plan_note_edit(
        note,
        ROOM_ID,
        OWNER,
        LATER,
        current_selective_ids=[OTHER],
        new_selective_ids=[OTHER, OWNER],
    )
    same = plan_note_edit(
        note,
        ROOM_ID,
        OWNER,
        LATER,
        current_selective_ids=[OTHER],
        new_selective_ids=[OTHER],
    )

    assert changed.audit_entry is not None
    assert changed.audit_entry.details["selective_user_ids"] == sorted([str(OTHER), str(OWNER)])
    assert same.audit_entry is None


def test_an_audit_entry_for_a_level_change_records_the_current_grants() -> None:
    note = _note(DocumentVisibility.SELECTIVE)

    plan = plan_note_edit(
        note,
        ROOM_ID,
        OWNER,
        LATER,
        visibility=DocumentVisibility.ROOM,
        current_selective_ids=[OTHER],
    )

    assert plan.audit_entry is not None
    assert plan.audit_entry.details["selective_user_ids"] == [str(OTHER)]


def test_order_deals_visible_notes_into_their_own_slots() -> None:
    a, b, c, hidden, d = (uuid.uuid4() for _ in range(5))

    # The requester sees a, b, c, d; `hidden` sits in slot 3 and stays there.
    result = plan_note_order([a, b, c, hidden, d], {a, b, c, d}, [d, c, b, a])

    assert result == [d, c, b, hidden, a]


def test_order_when_everything_is_visible() -> None:
    a, b, c = (uuid.uuid4() for _ in range(3))

    assert plan_note_order([a, b, c], {a, b, c}, [c, a, b]) == [c, a, b]


def test_order_with_no_notes_is_empty() -> None:
    assert plan_note_order([], set(), []) == []


@pytest.mark.parametrize("case", ["missing", "extra", "duplicate", "hidden"])
def test_order_must_be_exactly_the_visible_notes(case: str) -> None:
    a, b, hidden = (uuid.uuid4() for _ in range(3))
    requested = {
        "missing": [a],
        "extra": [a, b, uuid.uuid4()],
        "duplicate": [a, a],
        "hidden": [a, b, hidden],
    }[case]

    with pytest.raises(InvalidNoteOrderError):
        plan_note_order([a, b, hidden], {a, b}, requested)


@pytest.mark.parametrize(
    ("visibility", "role", "viewer", "owners", "grants", "visible"),
    [
        (DocumentVisibility.ROOM, RoomRole.PLAYER, OTHER, [OWNER], [], True),
        (DocumentVisibility.MASTER, RoomRole.MASTER, OTHER, [OWNER], [], True),
        (DocumentVisibility.MASTER, RoomRole.PLAYER, OWNER, [OWNER], [], False),
        (DocumentVisibility.PRIVATE, RoomRole.PLAYER, OWNER, [OWNER], [], True),
        (DocumentVisibility.PRIVATE, RoomRole.PLAYER, OTHER, [OWNER], [OTHER], False),
        (DocumentVisibility.SELECTIVE, RoomRole.PLAYER, OTHER, [OWNER], [OTHER], True),
        (DocumentVisibility.SELECTIVE, RoomRole.PLAYER, OTHER, [OWNER], [], False),
    ],
)
def test_note_visibility_follows_the_documents_owners(
    visibility: DocumentVisibility,
    role: RoomRole,
    viewer: uuid.UUID,
    owners: list[uuid.UUID],
    grants: list[uuid.UUID],
    visible: bool,
) -> None:
    note = _note(visibility)

    assert is_note_visible(note, viewer, role, owners, grants) is visible

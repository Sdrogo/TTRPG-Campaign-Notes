"""The visibility history (spec 22 Decision 4, FR-V5, VR-08), Room default
visibility (VR-05) and the Document visibility audit row they rely on."""

import uuid
from dataclasses import replace

import pytest

from app.domain.documents import (
    DOCUMENT_VISIBILITY_CHANGED,
    document_visibility_audit,
    plan_new_document,
)
from app.domain.history import (
    CannotReadHistoryError,
    ContentState,
    can_read_history,
    content_ids,
    ensure_can_read_history,
    history_actions,
    history_entry,
)
from app.domain.models import (
    AuditLogEntry,
    ContentKind,
    DocumentVisibility,
    Membership,
    Room,
    RoomRole,
    RoomStatus,
)
from app.domain.rooms import (
    InvalidDefaultVisibilityError,
    OnlyAdministratorChangesDefaultVisibilityError,
    OnlyMasterChangesSettingsError,
    plan_room_settings,
    starting_visibility,
)

ROOM_ID = uuid.uuid4()
ACTOR = uuid.uuid4()
DOCUMENT_ID = uuid.uuid4()
NOTE_ID = uuid.uuid4()
ALICE = uuid.uuid4()


def _membership(role: RoomRole, is_admin: bool) -> Membership:
    return Membership(uuid.uuid4(), ROOM_ID, uuid.uuid4(), role, is_admin)


def _entry(action: str, **details: object) -> AuditLogEntry:
    return AuditLogEntry(
        id=uuid.uuid4(),
        room_id=ROOM_ID,
        actor_user_id=ACTOR,
        target_user_id=None,
        action=action,
        details={"from": "master", "to": "room", **details},
    )


def test_the_master_and_administrators_read_the_history() -> None:
    assert can_read_history(_membership(RoomRole.MASTER, False))
    assert can_read_history(_membership(RoomRole.PLAYER, True))
    ensure_can_read_history(_membership(RoomRole.PLAYER, True))
    with pytest.raises(CannotReadHistoryError):
        ensure_can_read_history(_membership(RoomRole.PLAYER, False))


def test_history_actions_filter_by_kind() -> None:
    assert history_actions(ContentKind.NOTE) == ["note_revealed", "note_visibility_changed"]
    assert len(history_actions(None)) == 6


def test_a_visible_entry_names_its_content() -> None:
    entry = _entry(
        "note_revealed",
        document_id=str(DOCUMENT_ID),
        note_id=str(NOTE_ID),
        selective_user_ids=[str(ALICE)],
        recipient_ids=[str(ALICE)],
    )
    shown = history_entry(entry, {DOCUMENT_ID, NOTE_ID}, {DOCUMENT_ID, NOTE_ID})
    assert shown.state == ContentState.VISIBLE
    assert shown.kind == ContentKind.NOTE
    assert shown.is_reveal
    assert (shown.document_id, shown.note_id, shown.comment_id) == (DOCUMENT_ID, NOTE_ID, None)
    assert shown.selective_user_ids == [ALICE]
    assert shown.recipient_ids == [ALICE]


def test_an_entry_about_hidden_content_names_nothing() -> None:
    # VR-07: the Document is visible, the Note isn't.
    entry = _entry(
        "note_visibility_changed",
        document_id=str(DOCUMENT_ID),
        note_id=str(NOTE_ID),
        selective_user_ids=[str(ALICE)],
    )
    shown = history_entry(entry, {DOCUMENT_ID, NOTE_ID}, {DOCUMENT_ID})
    assert shown.state == ContentState.HIDDEN
    assert not shown.is_reveal
    assert (shown.document_id, shown.note_id, shown.comment_id) == (None, None, None)
    assert shown.selective_user_ids == []
    assert shown.recipient_ids == []


def test_an_entry_about_deleted_content_says_so() -> None:
    entry = _entry(DOCUMENT_VISIBILITY_CHANGED, document_id=str(DOCUMENT_ID))
    assert history_entry(entry, set(), set()).state == ContentState.DELETED
    # An entry that names nothing at all is treated the same way.
    assert history_entry(_entry("document_revealed"), set(), set()).state == ContentState.DELETED


def test_malformed_details_read_as_empty() -> None:
    entry = _entry("comment_revealed", comment_id=7, selective_user_ids="x", recipient_ids=[1])
    assert content_ids(entry) == (None, None, None)
    shown = history_entry(entry, set(), set())
    assert shown.recipient_ids == []


def test_a_document_visibility_change_is_audited() -> None:
    document = plan_new_document(ROOM_ID, "Ravenloft", "", DocumentVisibility.ROOM, ACTOR).document
    master = replace(document, visibility=DocumentVisibility.MASTER)

    entry = document_visibility_audit(document, master, ACTOR, [], None)
    assert entry is not None
    assert entry.action == DOCUMENT_VISIBILITY_CHANGED
    assert entry.details == {
        "document_id": str(document.id),
        "from": "room",
        "to": "master",
        "selective_user_ids": [],
    }

    # Grants alone changing is a visibility change too; the same grants aren't.
    selective = replace(document, visibility=DocumentVisibility.SELECTIVE)
    grants_entry = document_visibility_audit(selective, selective, ACTOR, [], [ALICE])
    assert grants_entry is not None
    assert grants_entry.details["selective_user_ids"] == [str(ALICE)]
    assert document_visibility_audit(selective, selective, ACTOR, [ALICE], [ALICE]) is None
    assert document_visibility_audit(document, document, ACTOR, [], None) is None


ROOM = Room(
    id=ROOM_ID, name="Barovia", game_system=None, status=RoomStatus.ACTIVE, created_by=ACTOR
)


def test_rooms_start_at_room_visibility() -> None:
    assert ROOM.default_visibility == DocumentVisibility.ROOM
    assert starting_visibility(ROOM, None) == DocumentVisibility.ROOM
    assert starting_visibility(ROOM, DocumentVisibility.PRIVATE) == DocumentVisibility.PRIVATE
    master_room = replace(ROOM, default_visibility=DocumentVisibility.MASTER)
    assert starting_visibility(master_room, None) == DocumentVisibility.MASTER


def test_administrators_choose_the_default_visibility() -> None:
    admin = _membership(RoomRole.PLAYER, True)
    updated = plan_room_settings(ROOM, admin, None, DocumentVisibility.PRIVATE)
    assert updated.default_visibility == DocumentVisibility.PRIVATE
    assert updated.players_can_create_documents is True

    with pytest.raises(OnlyAdministratorChangesDefaultVisibilityError):
        plan_room_settings(
            ROOM, _membership(RoomRole.MASTER, False), None, DocumentVisibility.MASTER
        )
    with pytest.raises(InvalidDefaultVisibilityError):
        plan_room_settings(ROOM, admin, None, DocumentVisibility.SELECTIVE)


def test_only_the_master_switches_document_creation() -> None:
    master = _membership(RoomRole.MASTER, False)
    assert plan_room_settings(ROOM, master, False, None).players_can_create_documents is False
    with pytest.raises(OnlyMasterChangesSettingsError):
        plan_room_settings(ROOM, _membership(RoomRole.PLAYER, True), False, None)
    # Nothing asked, nothing changed.
    assert plan_room_settings(ROOM, master, None, None) == ROOM

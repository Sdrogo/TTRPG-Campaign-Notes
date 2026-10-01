import uuid
from dataclasses import replace
from datetime import UTC, datetime

import pytest

from app.domain.characters import (
    CHARACTER_PLAYER_CHANGED,
    DOCUMENT_OWNER_ADDED,
    CannotPostAsError,
    PlayerNotAMemberError,
    can_post_as,
    character_shown_to,
    ensure_can_post_as,
    plan_player_change,
    postable_characters,
)
from app.domain.comments import plan_comment_edit, plan_new_comment
from app.domain.models import Document, DocumentVisibility, RoomRole

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
ROOM_ID = uuid.uuid4()
MASTER = uuid.uuid4()
PLAYER = uuid.uuid4()
OTHER = uuid.uuid4()
MEMBERS = {MASTER, PLAYER, OTHER}


def _document(name: str = "Aria", played_by: uuid.UUID | None = None) -> Document:
    return Document(
        id=uuid.uuid4(),
        room_id=ROOM_ID,
        name=name,
        description="",
        visibility=DocumentVisibility.ROOM,
        created_by=MASTER,
        played_by=played_by,
    )


def test_linking_a_player_also_makes_them_an_owner_and_audits_both() -> None:
    document = _document()

    plan = plan_player_change(document, MASTER, [], MEMBERS, PLAYER, add_as_owner=True)

    assert plan.document.played_by == PLAYER
    assert plan.new_owner is not None and plan.new_owner.user_id == PLAYER
    # FR-D9 + Invariant 7: the link and the Ownership change are both audited.
    actions = [entry.action for entry in plan.audit_entries]
    assert actions == [CHARACTER_PLAYER_CHANGED, DOCUMENT_OWNER_ADDED]
    assert plan.audit_entries[0].details == {
        "document_id": str(document.id),
        "from": None,
        "to": str(PLAYER),
    }
    assert all(entry.target_user_id == PLAYER for entry in plan.audit_entries)


def test_linking_without_ownership_adds_no_owner() -> None:
    plan = plan_player_change(_document(), MASTER, [], MEMBERS, PLAYER, add_as_owner=False)

    assert plan.new_owner is None
    assert [entry.action for entry in plan.audit_entries] == [CHARACTER_PLAYER_CHANGED]


def test_a_player_who_already_owns_the_document_isnt_added_twice() -> None:
    plan = plan_player_change(_document(), MASTER, [PLAYER], MEMBERS, PLAYER, add_as_owner=True)

    assert plan.new_owner is None
    assert [entry.action for entry in plan.audit_entries] == [CHARACTER_PLAYER_CHANGED]


def test_changing_and_unlinking_record_the_previous_player() -> None:
    document = _document(played_by=PLAYER)

    changed = plan_player_change(document, MASTER, [], MEMBERS, OTHER, add_as_owner=False)
    unlinked = plan_player_change(document, MASTER, [], MEMBERS, None, add_as_owner=True)

    assert changed.audit_entries[0].details["from"] == str(PLAYER)
    assert changed.audit_entries[0].details["to"] == str(OTHER)
    # Unlinking ignores `add_as_owner`: there is nobody to make an Owner.
    assert unlinked.document.played_by is None
    assert unlinked.new_owner is None
    assert unlinked.audit_entries[0].details["to"] is None
    assert unlinked.audit_entries[0].target_user_id is None


def test_setting_the_same_player_again_writes_no_audit_row() -> None:
    plan = plan_player_change(
        _document(played_by=PLAYER), MASTER, [PLAYER], MEMBERS, PLAYER, add_as_owner=True
    )

    assert plan.audit_entries == []
    assert plan.new_owner is None


def test_the_player_must_be_a_member_of_the_room() -> None:
    # UC-21: an invalid member is refused.
    with pytest.raises(PlayerNotAMemberError):
        plan_player_change(_document(), MASTER, [], MEMBERS, uuid.uuid4(), add_as_owner=True)


def test_only_the_player_or_the_master_may_post_as_a_character() -> None:
    # D-24: the Character player, or the Master for any Document (NPCs).
    character = _document(played_by=PLAYER)
    npc = _document("Strahd")

    assert can_post_as(character, PLAYER, RoomRole.PLAYER)
    assert can_post_as(character, MASTER, RoomRole.MASTER)
    assert can_post_as(npc, MASTER, RoomRole.MASTER)
    assert not can_post_as(character, OTHER, RoomRole.PLAYER)
    assert not can_post_as(npc, PLAYER, RoomRole.PLAYER)
    with pytest.raises(CannotPostAsError):
        ensure_can_post_as(npc, PLAYER, RoomRole.PLAYER)
    ensure_can_post_as(character, PLAYER, RoomRole.PLAYER)


def test_postable_characters_are_filtered_and_sorted_by_name() -> None:
    zed = _document("zed", played_by=PLAYER)
    aria = _document("Aria", played_by=PLAYER)
    not_mine = _document("Bram", played_by=OTHER)
    npc = _document("Strahd")

    mine = postable_characters([zed, not_mine, aria, npc], PLAYER, RoomRole.PLAYER)
    every = postable_characters([zed, not_mine, aria, npc], MASTER, RoomRole.MASTER)

    assert [d.name for d in mine] == ["Aria", "zed"]
    assert [d.name for d in every] == ["Aria", "Bram", "Strahd", "zed"]


def test_a_character_is_shown_only_to_viewers_who_see_its_document() -> None:
    # VR-13 / I-13: a hidden Character never leaks through a Comment.
    character_id = uuid.uuid4()
    comment = plan_new_comment(
        uuid.uuid4(), PLAYER, "Hi", DocumentVisibility.ROOM, NOW, as_document_id=character_id
    )
    plain = plan_new_comment(uuid.uuid4(), PLAYER, "Hi", DocumentVisibility.ROOM, NOW)

    assert character_shown_to(comment, {character_id}) == character_id
    assert character_shown_to(comment, set()) is None
    assert character_shown_to(plain, {character_id}) is None


def test_editing_a_comment_can_change_or_drop_its_character_without_audit() -> None:
    character_id = uuid.uuid4()
    comment = plan_new_comment(
        uuid.uuid4(), PLAYER, "Hi", DocumentVisibility.ROOM, NOW, as_document_id=character_id
    )

    kept = plan_comment_edit(comment, ROOM_ID, PLAYER, NOW, body="Hello")
    dropped = plan_comment_edit(comment, ROOM_ID, PLAYER, NOW, change_character=True)
    moved = plan_comment_edit(
        replace(comment, as_document_id=None),
        ROOM_ID,
        PLAYER,
        NOW,
        change_character=True,
        as_document_id=character_id,
    )

    assert kept.comment.as_document_id == character_id
    assert dropped.comment.as_document_id is None
    assert moved.comment.as_document_id == character_id
    # The Post still belongs to its author (D-24): not a visibility change.
    assert dropped.audit_entry is None

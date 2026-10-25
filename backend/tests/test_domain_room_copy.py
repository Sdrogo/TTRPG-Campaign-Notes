import uuid
from datetime import UTC, datetime

import pytest

from app.domain.mentions import MentionKind, find_mentions, mention_token
from app.domain.models import DocumentVisibility, Membership, Room, RoomRole, RoomStatus, Tag
from app.domain.room_copy import (
    OnlyMasterCanDuplicateError,
    RoomSource,
    SourceCombination,
    SourceDocument,
    SourceImage,
    SourceNote,
    copy_name,
    plan_room_copy,
    remap_mentions,
)

NOW = datetime(2026, 10, 12, tzinfo=UTC)


def _room() -> Room:
    return Room(
        id=uuid.uuid4(),
        name="Tokyo Playtest",
        game_system="Vampire",
        status=RoomStatus.ACTIVE,
        created_by=uuid.uuid4(),
        players_can_create_documents=False,
        default_visibility=DocumentVisibility.MASTER,
        image_path="rooms/x/cover.webp",
        maps_position=2,
    )


def _master(room: Room) -> Membership:
    return Membership(
        id=uuid.uuid4(), room_id=room.id, user_id=uuid.uuid4(), role=RoomRole.MASTER, is_admin=False
    )


def _source() -> tuple[RoomSource, Tag, SourceDocument, SourceDocument]:
    room = _room()
    tag = Tag(uuid.uuid4(), room.id, "NPC", "Type", 0)
    other_tag = Tag(uuid.uuid4(), room.id, "Clan", None, None)
    gate_id, ghost_id, member_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    gate = SourceDocument(
        id=gate_id,
        name="Il Cancello",
        subtitle="A door",
        text=f"See {mention_token(MentionKind.DOCUMENT, ghost_id, 'Ghost')} and "
        f"{mention_token(MentionKind.TAG, tag.id, 'NPC')}",
        visibility=DocumentVisibility.SELECTIVE,
        tag_ids=(tag.id,),
        notes=(
            SourceNote(
                uuid.uuid4(),
                "Secret",
                f"Ask {mention_token(MentionKind.USER, member_id, 'Anna')}, "
                f"{mention_token(MentionKind.DOCUMENT, uuid.uuid4(), 'Elsewhere')}",
                DocumentVisibility.SELECTIVE,
                0,
            ),
            SourceNote(uuid.uuid4(), "Open", "", DocumentVisibility.ROOM, 1),
        ),
        images=(SourceImage("a/b.webp", True, NOW),),
    )
    ghost = SourceDocument(
        id=ghost_id,
        name="Ghost",
        subtitle=None,
        text=f"Back to {mention_token(MentionKind.DOCUMENT, gate_id, 'Il Cancello')}",
        visibility=DocumentVisibility.MASTER,
        tag_ids=(),
        notes=(),
        images=(),
    )
    source = RoomSource(
        room=room,
        tags=(tag, other_tag),
        combinations=(SourceCombination(1, (tag.id, other_tag.id)),),
        documents=(gate, ghost),
    )
    return source, tag, gate, ghost


def test_only_the_master_duplicates() -> None:
    """Spec 33 Decision 5: an Administrator who isn't the Master is refused."""
    source, *_ = _source()
    admin = Membership(uuid.uuid4(), source.room.id, uuid.uuid4(), RoomRole.PLAYER, True)

    with pytest.raises(OnlyMasterCanDuplicateError):
        plan_room_copy(source, admin, " (Copy)")


def test_the_copy_is_a_new_room_with_the_duplicator_as_only_member() -> None:
    """Decisions 3, 6, 7: setup and image carried over, new ids, one Master."""
    source, *_ = _source()
    master = _master(source.room)

    plan = plan_room_copy(source, master, " (Copy)")

    assert plan.room.id != source.room.id
    assert plan.room.name == "Tokyo Playtest (Copy)"
    assert plan.room.game_system == "Vampire"
    assert plan.room.players_can_create_documents is False
    assert plan.room.default_visibility is DocumentVisibility.MASTER
    assert plan.room.image_path == "rooms/x/cover.webp"
    assert plan.room.maps_position == 2
    assert plan.room.created_by == master.user_id
    assert plan.membership.room_id == plan.room.id
    assert plan.membership.user_id == master.user_id
    assert plan.membership.role is RoomRole.MASTER
    assert plan.membership.is_admin is True


def test_tags_and_combinations_get_new_ids_and_keep_their_order() -> None:
    """Decision 3: Main Tags, categories and combinations survive over new ids."""
    source, tag, *_ = _source()

    plan = plan_room_copy(source, _master(source.room), " (Copy)")

    new_tag = next(t for t in plan.tags if t.name == "NPC")
    assert new_tag.id != tag.id
    assert (new_tag.room_id, new_tag.category, new_tag.main_position) == (plan.room.id, "Type", 0)
    assert {t.name for t in plan.tags} == {"NPC", "Clan"}
    (combination,) = plan.combinations
    assert combination.position == 1
    assert set(combination.tag_ids) == {t.id for t in plan.tags}


def test_selective_becomes_private_and_the_rest_is_kept() -> None:
    """Decision 8: the grant list names members of the source Room."""
    source, *_ = _source()

    plan = plan_room_copy(source, _master(source.room), " (Copy)")

    gate, ghost = plan.documents
    assert gate.visibility is DocumentVisibility.PRIVATE
    assert ghost.visibility is DocumentVisibility.MASTER
    assert [(n.title, n.visibility, n.position) for n in gate.notes] == [
        ("Secret", DocumentVisibility.PRIVATE, 0),
        ("Open", DocumentVisibility.ROOM, 1),
    ]
    assert gate.subtitle == "A door"


def test_mentions_point_inside_the_copy_and_members_become_plain_text() -> None:
    """Decision 8: Document and Tag mentions are re-pointed, others unlinked."""
    source, *_ = _source()

    plan = plan_room_copy(source, _master(source.room), " (Copy)")

    gate, ghost = plan.documents
    targets = {(m.kind, m.target_id) for m in find_mentions(gate.text)}
    new_tag = next(t for t in plan.tags if t.name == "NPC")
    assert targets == {(MentionKind.DOCUMENT, ghost.id), (MentionKind.TAG, new_tag.id)}
    assert [(m.kind, m.target_id) for m in find_mentions(ghost.text)] == [
        (MentionKind.DOCUMENT, gate.id)
    ]
    assert gate.notes[0].text == "Ask @Anna, #Elsewhere"


def test_backlinks_are_planned_for_the_copy() -> None:
    """Decision 8 / spec 20: the copy's own backlinks, none pointing at the source."""
    source, *_ = _source()

    plan = plan_room_copy(source, _master(source.room), " (Copy)")

    gate, ghost = plan.documents
    sources = {(b.document_id, b.note_id) for b in plan.backlinks}
    assert sources == {(gate.id, None), (ghost.id, None)}
    new_ids = {gate.id, ghost.id} | {t.id for t in plan.tags}
    assert all(
        (b.mention.target_document_id or b.mention.target_tag_id) in new_ids for b in plan.backlinks
    )


def test_images_keep_their_object_and_flag_under_new_row_ids() -> None:
    """Decision 10: the copy names the same Storage object."""
    source, *_ = _source()

    plan = plan_room_copy(source, _master(source.room), " (Copy)")

    (image,) = plan.documents[0].images
    assert (image.storage_path, image.is_favorite, image.created_at) == ("a/b.webp", True, NOW)


def test_copy_name_is_shortened_to_fit_the_column() -> None:
    """Decision 7: a name at the limit loses its tail, not the suffix."""
    name = copy_name("x" * 200, " (Copy)")

    assert len(name) == 200
    assert name.endswith("x (Copy)")
    assert copy_name("Tokyo Playtest (Copy)", " (Copy)") == "Tokyo Playtest (Copy) (Copy)"


def test_remap_mentions_ignores_text_that_only_looks_like_a_token() -> None:
    """A name that reads like a token never becomes a link."""
    fake = f"#[x](doc:{uuid.uuid4()})"
    inner = mention_token(MentionKind.DOCUMENT, uuid.uuid4(), fake)

    assert find_mentions(remap_mentions(inner, {}, {})) == []

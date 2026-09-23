import uuid

import pytest

from app.domain.documents import (
    MAX_IMAGES_PER_DOCUMENT,
    AlreadyOwnerError,
    DocumentNameRequiredError,
    NotAnOwnerError,
    NotOwnerError,
    TooManyImagesError,
    can_create_document,
    ensure_can_remove_owner,
    ensure_owner,
    is_owner,
    next_favorite_id,
    plan_add_owner,
    plan_new_document,
    plan_new_image,
)
from app.domain.models import DocumentImage, DocumentVisibility, RoomRole


def _image(is_favorite: bool = False) -> DocumentImage:
    return DocumentImage(
        id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        storage_path=f"{uuid.uuid4().hex}.webp",
        created_by=uuid.uuid4(),
        is_favorite=is_favorite,
    )


def test_creator_becomes_owner() -> None:
    room_id = uuid.uuid4()
    creator_id = uuid.uuid4()
    plan = plan_new_document(
        room_id, "The Winking Skull", "A tavern.", DocumentVisibility.ROOM, creator_id
    )

    assert plan.document.room_id == room_id
    assert plan.document.name == "The Winking Skull"
    assert plan.document.visibility == DocumentVisibility.ROOM
    assert plan.owner.document_id == plan.document.id
    assert plan.owner.user_id == creator_id


def test_blank_name_is_rejected() -> None:
    with pytest.raises(DocumentNameRequiredError):
        plan_new_document(uuid.uuid4(), "   ", "", DocumentVisibility.ROOM, uuid.uuid4())


def test_master_is_always_an_implicit_owner() -> None:
    assert is_owner(RoomRole.MASTER, uuid.uuid4(), owner_user_ids=[]) is True


def test_non_owner_player_is_not_an_owner() -> None:
    assert is_owner(RoomRole.PLAYER, uuid.uuid4(), owner_user_ids=[]) is False


def test_explicit_owner_is_recognized() -> None:
    user_id = uuid.uuid4()
    assert is_owner(RoomRole.PLAYER, user_id, owner_user_ids=[user_id]) is True


def test_ensure_owner_rejects_non_owner() -> None:
    with pytest.raises(NotOwnerError):
        ensure_owner(RoomRole.PLAYER, uuid.uuid4(), owner_user_ids=[])


def test_master_can_create_documents_even_when_disabled_for_players() -> None:
    assert can_create_document(RoomRole.MASTER, players_can_create_documents=False) is True


def test_player_creation_follows_room_setting() -> None:
    assert can_create_document(RoomRole.PLAYER, players_can_create_documents=True) is True
    assert can_create_document(RoomRole.PLAYER, players_can_create_documents=False) is False


def test_cannot_add_an_already_existing_owner() -> None:
    user_id = uuid.uuid4()
    with pytest.raises(AlreadyOwnerError):
        plan_add_owner(uuid.uuid4(), user_id, current_owner_ids=[user_id])


def test_add_owner_returns_a_new_owner_row() -> None:
    document_id = uuid.uuid4()
    user_id = uuid.uuid4()
    owner = plan_add_owner(document_id, user_id, current_owner_ids=[])
    assert owner.document_id == document_id
    assert owner.user_id == user_id


def test_cannot_remove_a_non_owner() -> None:
    with pytest.raises(NotAnOwnerError):
        ensure_can_remove_owner(uuid.uuid4(), current_owner_ids=[])


def test_removing_the_only_explicit_owner_is_allowed() -> None:
    # Unlike Rooms (D-16), there's no "last Owner" guard: the Master is
    # always an implicit Owner (D-12), so this can never leave the
    # Document ownerless.
    user_id = uuid.uuid4()
    ensure_can_remove_owner(user_id, current_owner_ids=[user_id])  # should not raise


def test_new_image_path_is_scoped_and_randomized() -> None:
    room_id = uuid.uuid4()
    document_id = uuid.uuid4()
    uploader_id = uuid.uuid4()
    image = plan_new_image(room_id, document_id, ".webp", uploader_id, current_images=[])

    assert image.document_id == document_id
    assert image.created_by == uploader_id
    assert image.storage_path.startswith(f"{room_id}/{document_id}/")
    assert image.storage_path.endswith(".webp")
    # Two images on the same Document never collide.
    other = plan_new_image(
        room_id, document_id, ".webp", uploader_id, current_images=[_image(is_favorite=True)]
    )
    assert image.storage_path != other.storage_path


def test_image_limit_per_document_is_enforced() -> None:
    with pytest.raises(TooManyImagesError):
        plan_new_image(
            uuid.uuid4(),
            uuid.uuid4(),
            ".webp",
            uuid.uuid4(),
            current_images=[_image() for _ in range(MAX_IMAGES_PER_DOCUMENT)],
        )


# --- Favorite image (spec 07) ---------------------------------------------


def test_first_image_of_a_document_becomes_the_favorite() -> None:
    image = plan_new_image(uuid.uuid4(), uuid.uuid4(), ".webp", uuid.uuid4(), current_images=[])
    assert image.is_favorite


def test_later_images_do_not_displace_the_favorite() -> None:
    image = plan_new_image(
        uuid.uuid4(),
        uuid.uuid4(),
        ".webp",
        uuid.uuid4(),
        current_images=[_image(is_favorite=True), _image()],
    )
    assert not image.is_favorite


def test_an_image_added_to_a_document_whose_favorite_is_gone_claims_it() -> None:
    # Can't happen through the API (removing the favorite promotes a
    # successor), but the rule is "exactly one", not "only the first ever".
    image = plan_new_image(
        uuid.uuid4(), uuid.uuid4(), ".webp", uuid.uuid4(), current_images=[_image(), _image()]
    )
    assert image.is_favorite


def test_no_promotion_while_a_favorite_is_still_there() -> None:
    assert next_favorite_id([_image(is_favorite=True), _image()]) is None


def test_no_promotion_when_the_last_image_is_gone() -> None:
    assert next_favorite_id([]) is None


def test_oldest_survivor_is_promoted_when_the_favorite_is_removed() -> None:
    oldest, newer = _image(), _image()
    assert next_favorite_id([oldest, newer]) == oldest.id

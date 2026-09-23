import uuid

import pytest

from app.domain.models import Document, DocumentVisibility, RoomRole
from app.domain.visibility import is_document_visible


def _document(visibility: DocumentVisibility) -> Document:
    return Document(
        id=uuid.uuid4(),
        room_id=uuid.uuid4(),
        name="Secret NPC",
        description="",
        visibility=visibility,
        created_by=uuid.uuid4(),
    )


def test_master_sees_everything_regardless_of_level() -> None:
    for level in DocumentVisibility:
        document = _document(level)
        assert is_document_visible(document, uuid.uuid4(), RoomRole.MASTER, [], []) is True


def test_room_visibility_is_visible_to_any_player() -> None:
    document = _document(DocumentVisibility.ROOM)
    assert is_document_visible(document, uuid.uuid4(), RoomRole.PLAYER, [], []) is True


def test_master_only_is_hidden_from_players() -> None:
    document = _document(DocumentVisibility.MASTER)
    owner_id = uuid.uuid4()
    # Even the Document's own Owner can't see a Master-only Document if
    # they aren't the Master.
    assert is_document_visible(document, owner_id, RoomRole.PLAYER, [owner_id], []) is False


@pytest.mark.parametrize("level", [DocumentVisibility.PRIVATE, DocumentVisibility.SELECTIVE])
def test_private_and_selective_are_visible_to_owners(level: DocumentVisibility) -> None:
    document = _document(level)
    owner_id = uuid.uuid4()
    assert is_document_visible(document, owner_id, RoomRole.PLAYER, [owner_id], []) is True


def test_private_is_hidden_from_non_owners() -> None:
    document = _document(DocumentVisibility.PRIVATE)
    assert is_document_visible(document, uuid.uuid4(), RoomRole.PLAYER, [uuid.uuid4()], []) is False


def test_selective_is_visible_to_the_grant_list() -> None:
    document = _document(DocumentVisibility.SELECTIVE)
    granted_id = uuid.uuid4()
    assert is_document_visible(document, granted_id, RoomRole.PLAYER, [], [granted_id]) is True


def test_selective_is_hidden_from_everyone_else() -> None:
    document = _document(DocumentVisibility.SELECTIVE)
    assert is_document_visible(document, uuid.uuid4(), RoomRole.PLAYER, [], [uuid.uuid4()]) is False

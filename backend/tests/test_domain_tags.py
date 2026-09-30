import uuid

import pytest

from app.domain.tags import DuplicateMainTagError, UnknownMainTagError, plan_main_tags


def test_listed_tags_get_their_index_and_the_rest_are_cleared() -> None:
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()

    positions = plan_main_tags([a, b, c], [c, a])

    assert positions == {c: 0, a: 1, b: None}


def test_an_empty_list_clears_every_main_tag() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()

    assert plan_main_tags([a, b], []) == {a: None, b: None}


def test_a_repeated_tag_is_rejected() -> None:
    a = uuid.uuid4()

    with pytest.raises(DuplicateMainTagError) as exc_info:
        plan_main_tags([a], [a, a])

    assert exc_info.value.key == "errors.tag.duplicateMainTag"


def test_a_tag_outside_the_room_is_rejected() -> None:
    with pytest.raises(UnknownMainTagError) as exc_info:
        plan_main_tags([uuid.uuid4()], [uuid.uuid4()])

    assert exc_info.value.key == "errors.tag.unknownMainTag"

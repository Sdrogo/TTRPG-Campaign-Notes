import uuid

import pytest

from app.domain.images import AVATAR_DIMENSION
from app.domain.models import UserProfile
from app.domain.profiles import (
    AVATAR_PATH_PREFIX,
    MAX_BIO_LENGTH,
    MAX_DISPLAY_NAME_LENGTH,
    MAX_PRONOUNS_LENGTH,
    ProfileChanges,
    ProfileFieldTooLongError,
    google_avatar_source,
    plan_avatar_path,
    plan_google_prefill,
    plan_profile_update,
)

USER_ID = uuid.uuid4()
CURRENT = UserProfile(
    user_id=USER_ID,
    email="strahd@example.com",
    display_name="Strahd",
    pronouns="he/him",
    bio="Lord of Barovia.",
    avatar_path="avatars/x/y.webp",
)


def _changes(**fields: str | None) -> ProfileChanges:
    return ProfileChanges(fields=frozenset(fields), **fields)


def test_only_sent_fields_change() -> None:
    updated = plan_profile_update(CURRENT, _changes(display_name="Ireena"))

    assert updated.display_name == "Ireena"
    assert updated.pronouns == "he/him"
    assert updated.bio == "Lord of Barovia."
    assert updated.avatar_path == CURRENT.avatar_path
    assert updated.email == CURRENT.email


def test_null_or_blank_clears_a_field() -> None:
    updated = plan_profile_update(CURRENT, _changes(display_name=None, pronouns="   "))

    assert updated.display_name is None
    assert updated.pronouns is None


def test_single_line_fields_are_trimmed_and_collapsed() -> None:
    updated = plan_profile_update(CURRENT, _changes(display_name="  Van \n  Richten\t "))
    assert updated.display_name == "Van Richten"


def test_bio_keeps_its_line_breaks() -> None:
    updated = plan_profile_update(CURRENT, _changes(bio="  First line\r\nSecond line  "))
    assert updated.bio == "First line\nSecond line"


@pytest.mark.parametrize(
    ("field", "limit"),
    [
        ("display_name", MAX_DISPLAY_NAME_LENGTH),
        ("pronouns", MAX_PRONOUNS_LENGTH),
        ("bio", MAX_BIO_LENGTH),
    ],
)
def test_fields_have_a_length_limit(field: str, limit: int) -> None:
    at_limit = plan_profile_update(CURRENT, _changes(**{field: "a" * limit}))
    assert getattr(at_limit, field) == "a" * limit

    with pytest.raises(ProfileFieldTooLongError) as exc_info:
        plan_profile_update(CURRENT, _changes(**{field: "a" * (limit + 1)}))
    assert exc_info.value.field == field


def test_limit_is_checked_after_trimming() -> None:
    padded = "  " + "a" * MAX_DISPLAY_NAME_LENGTH + "  "
    updated = plan_profile_update(CURRENT, _changes(display_name=padded))
    assert updated.display_name == "a" * MAX_DISPLAY_NAME_LENGTH


def test_avatar_paths_are_per_user_and_never_reused() -> None:
    first = plan_avatar_path(USER_ID)
    second = plan_avatar_path(USER_ID)

    assert first.startswith(f"{AVATAR_PATH_PREFIX}/{USER_ID}/")
    assert first.endswith(".webp")
    assert first != second


# --- Google defaults ---------------------------------------------------------

EMPTY = UserProfile(user_id=USER_ID, email="a@example.com")


def test_google_name_fills_an_unset_display_name() -> None:
    assert plan_google_prefill(EMPTY, "  Ireena   Kolyana ").display_name == "Ireena Kolyana"


def test_google_name_never_replaces_a_chosen_one() -> None:
    assert plan_google_prefill(CURRENT, "Someone Else") == CURRENT


def test_long_google_name_is_cut_not_rejected() -> None:
    updated = plan_google_prefill(EMPTY, "a" * (MAX_DISPLAY_NAME_LENGTH + 20))
    assert updated.display_name == "a" * MAX_DISPLAY_NAME_LENGTH


def test_no_google_name_changes_nothing() -> None:
    assert plan_google_prefill(EMPTY, None) == EMPTY


def test_google_picture_is_requested_at_avatar_size() -> None:
    source = google_avatar_source("https://lh3.googleusercontent.com/a/ACg8ocXYZ=s96-c")
    assert source == f"https://lh3.googleusercontent.com/a/ACg8ocXYZ=s{AVATAR_DIMENSION}-c"


def test_other_picture_urls_are_used_as_they_are() -> None:
    assert google_avatar_source("https://example.com/me.png=s96-c") == (
        "https://example.com/me.png=s96-c"
    )
    assert google_avatar_source(None) is None

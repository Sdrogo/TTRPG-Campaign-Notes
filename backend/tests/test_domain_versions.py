"""Version history (spec 24): when a save appends a version and when it merges
into the latest, and the change size shown in the list."""

import uuid
from datetime import UTC, datetime, timedelta

from app.domain.versions import MERGE_WINDOW, Version, change_size, plan_version

EDITOR = uuid.uuid4()
OTHER = uuid.uuid4()
T0 = datetime(2026, 10, 5, 12, 0, tzinfo=UTC)


def _version(
    title: str = "Strahd",
    description: str = "A vampire.",
    editor: uuid.UUID = EDITOR,
    at: datetime = T0,
) -> Version:
    return Version(uuid.uuid4(), title, description, editor, at, at)


# --- Appending and merging (Decision 2) -------------------------------------


def test_the_first_save_appends() -> None:
    write = plan_version(None, EDITOR, T0, "Strahd", "A vampire.")

    assert write is not None and write.is_new
    assert (write.version.title, write.version.description) == ("Strahd", "A vampire.")
    assert write.version.edited_by == EDITOR
    assert write.version.created_at == write.version.updated_at == T0


def test_the_same_editor_inside_the_window_merges_into_the_latest() -> None:
    latest = _version()

    write = plan_version(latest, EDITOR, T0 + timedelta(minutes=3), "Strahd", "A vampire lord.")

    assert write is not None and not write.is_new
    assert write.version.id == latest.id
    assert write.version.description == "A vampire lord."
    assert write.version.created_at == T0
    assert write.version.updated_at == T0 + timedelta(minutes=3)


def test_the_window_runs_from_the_last_merged_save() -> None:
    latest = _version()
    merged = plan_version(latest, EDITOR, T0 + timedelta(minutes=8), "Strahd", "One.")
    assert merged is not None

    write = plan_version(merged.version, EDITOR, T0 + timedelta(minutes=16), "Strahd", "Two.")

    assert write is not None and not write.is_new
    assert write.version.id == latest.id


def test_the_window_edge_still_merges_and_just_past_it_appends() -> None:
    latest = _version()

    on_edge = plan_version(latest, EDITOR, T0 + MERGE_WINDOW, "Strahd", "Edge.")
    past = plan_version(latest, EDITOR, T0 + MERGE_WINDOW + timedelta(seconds=1), "Strahd", "Past.")

    assert on_edge is not None and not on_edge.is_new
    assert past is not None and past.is_new
    assert past.version.id != latest.id


def test_another_editor_inside_the_window_appends() -> None:
    write = plan_version(_version(), OTHER, T0 + timedelta(minutes=1), "Strahd", "Changed.")

    assert write is not None and write.is_new
    assert write.version.edited_by == OTHER


def test_the_same_editor_after_the_window_appends() -> None:
    write = plan_version(_version(), EDITOR, T0 + timedelta(minutes=30), "Strahd", "Later.")

    assert write is not None and write.is_new


def test_a_save_that_changes_nothing_writes_nothing() -> None:
    assert (
        plan_version(_version(), EDITOR, T0 + timedelta(minutes=1), "Strahd", "A vampire.") is None
    )
    assert plan_version(_version(), OTHER, T0 + timedelta(hours=2), "Strahd", "A vampire.") is None


def test_a_changed_title_alone_counts() -> None:
    write = plan_version(_version(), OTHER, T0, "Count Strahd", "A vampire.")

    assert write is not None and write.is_new


# --- Restore (Decision 3) ---------------------------------------------------


def test_a_restore_appends_even_for_the_same_editor_inside_the_window() -> None:
    write = plan_version(
        _version(description="New."),
        EDITOR,
        T0 + timedelta(minutes=1),
        "Strahd",
        "A vampire.",
        force_new=True,
    )

    assert write is not None and write.is_new


def test_restoring_the_current_text_writes_nothing() -> None:
    latest = _version()

    assert plan_version(latest, EDITOR, T0, "Strahd", "A vampire.", force_new=True) is None


# --- Change size ------------------------------------------------------------


def test_change_size_counts_added_and_removed_words() -> None:
    old = _version(description="A tall vampire lord of Barovia")
    new = _version(description="A vampire count of Barovia and Ravenloft")

    size = change_size(old, new)

    assert (size.words_added, size.words_removed) == (3, 2)


def test_change_size_includes_the_title() -> None:
    size = change_size(_version(title="Strahd"), _version(title="Count Strahd von Zarovich"))

    assert (size.words_added, size.words_removed) == (3, 0)


def test_change_size_of_identical_texts_is_zero() -> None:
    size = change_size(_version(), _version())

    assert (size.words_added, size.words_removed) == (0, 0)

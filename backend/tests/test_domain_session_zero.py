"""Session 0 boards (spec 46): the pure rules in `app/domain/session_zero.py`."""

import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from app.domain.models import RoomRole
from app.domain.session_zero import (
    MAX_BODY_LENGTH,
    MAX_CARDS_PER_BOARD,
    MAX_COLUMN_TITLE_LENGTH,
    MAX_EMOJI_PER_CARD,
    MAX_RETRO_COLUMNS,
    MAX_ROUND_TITLE_LENGTH,
    STOPPED_TIMER,
    AlreadyPromotedError,
    AlreadyPublishedError,
    BoardFullError,
    Card,
    Column,
    CopyNotEditableError,
    DraftCardError,
    InvalidCardError,
    InvalidTimerError,
    InvalidTitleError,
    LinesVeilsKind,
    NotAuthorError,
    NotMasterError,
    Round,
    RoundClosedError,
    Timer,
    TimerAction,
    TooManyCardEmojiError,
    TooManyColumnsError,
    WrongBoardError,
    apply_timer,
    can_delete_card,
    can_promote,
    clean_body,
    clean_column_title,
    clean_round_title,
    ensure_can_add_card,
    ensure_can_add_column,
    ensure_can_delete_card,
    ensure_can_edit_card,
    ensure_can_move,
    ensure_can_promote,
    ensure_can_publish,
    ensure_can_react,
    ensure_master,
    ensure_retro_column,
    is_card_visible,
    remaining_seconds,
    shown_author,
)

NOW = datetime(2026, 10, 27, 12, 0, tzinfo=UTC)
ROOM = uuid.uuid4()
AUTHOR = uuid.uuid4()
OTHER = uuid.uuid4()
MASTER = RoomRole.MASTER
PLAYER = RoomRole.PLAYER

OPEN = Round(uuid.uuid4(), ROOM, 1, None, NOW, None)
CLOSED = replace(OPEN, closed_at=NOW)
RETRO = Column(uuid.uuid4(), ROOM, OPEN.id, None, "Want", 0)
LINES = Column(uuid.uuid4(), ROOM, None, LinesVeilsKind.LINES, "", 1)
VEILS = Column(uuid.uuid4(), ROOM, None, LinesVeilsKind.VEILS, "", 2)


def _card(**fields: object) -> Card:
    base = Card(
        id=uuid.uuid4(),
        room_id=ROOM,
        column_id=RETRO.id,
        author_id=AUTHOR,
        body="No spiders",
        anonymous=False,
        published_at=NOW,
        source_card_id=None,
        promoted_by=None,
        created_at=NOW,
        updated_at=NOW,
    )
    return replace(base, **fields)  # type: ignore[arg-type]


def test_drafts_are_seen_by_their_author_only() -> None:
    draft = _card(published_at=None)
    assert is_card_visible(draft, AUTHOR)
    assert not is_card_visible(draft, OTHER)
    assert is_card_visible(_card(), OTHER)


def test_anonymous_post_its_hide_their_author_from_everyone_else() -> None:
    card = _card(anonymous=True)
    assert shown_author(card, AUTHOR) == AUTHOR
    assert shown_author(card, OTHER) is None
    assert shown_author(_card(), OTHER) == AUTHOR


def test_body_and_titles_are_trimmed_and_bounded() -> None:
    assert clean_body("  hi ") == "hi"
    with pytest.raises(InvalidCardError):
        clean_body("   ")
    with pytest.raises(InvalidCardError):
        clean_body("x" * (MAX_BODY_LENGTH + 1))
    assert clean_column_title(" Must ") == "Must"
    with pytest.raises(InvalidTitleError):
        clean_column_title("")
    with pytest.raises(InvalidTitleError):
        clean_column_title("x" * (MAX_COLUMN_TITLE_LENGTH + 1))
    assert clean_round_title("  ") is None
    assert clean_round_title(None) is None
    assert clean_round_title(" Arc 1 ") == "Arc 1"
    with pytest.raises(InvalidTitleError):
        clean_round_title("x" * (MAX_ROUND_TITLE_LENGTH + 1))


def test_only_the_master_manages() -> None:
    ensure_master(MASTER)
    with pytest.raises(NotMasterError):
        ensure_master(PLAYER)


def test_post_its_go_in_open_retro_columns_while_the_board_has_room() -> None:
    ensure_can_add_card(RETRO, OPEN, 0)
    with pytest.raises(WrongBoardError):
        ensure_can_add_card(LINES, None, 0)
    with pytest.raises(RoundClosedError):
        ensure_can_add_card(RETRO, CLOSED, 0)
    with pytest.raises(BoardFullError):
        ensure_can_add_card(RETRO, OPEN, MAX_CARDS_PER_BOARD)


def test_the_author_edits_retro_post_its_of_the_open_round() -> None:
    ensure_can_edit_card(_card(), OPEN, AUTHOR)
    with pytest.raises(NotAuthorError):
        ensure_can_edit_card(_card(), OPEN, OTHER)
    with pytest.raises(RoundClosedError):
        ensure_can_edit_card(_card(), CLOSED, AUTHOR)
    with pytest.raises(CopyNotEditableError):
        ensure_can_edit_card(_card(column_id=LINES.id, promoted_by=OTHER), None, AUTHOR)


def test_deleting_is_the_authors_or_the_masters_on_published_post_its() -> None:
    draft = _card(published_at=None)
    assert can_delete_card(draft, OPEN, AUTHOR, PLAYER)
    assert not can_delete_card(draft, OPEN, OTHER, MASTER)
    assert can_delete_card(_card(), OPEN, OTHER, MASTER)
    assert not can_delete_card(_card(), OPEN, OTHER, PLAYER)
    assert not can_delete_card(_card(), CLOSED, AUTHOR, MASTER)
    assert can_delete_card(_card(column_id=LINES.id, promoted_by=OTHER), None, AUTHOR, PLAYER)
    ensure_can_delete_card(_card(), OPEN, AUTHOR, PLAYER)
    with pytest.raises(NotAuthorError):
        ensure_can_delete_card(_card(), OPEN, OTHER, PLAYER)
    with pytest.raises(RoundClosedError):
        ensure_can_delete_card(_card(), CLOSED, AUTHOR, PLAYER)


def test_the_author_publishes_a_draft_once() -> None:
    draft = _card(published_at=None)
    ensure_can_publish(draft, OPEN, AUTHOR)
    with pytest.raises(NotAuthorError):
        ensure_can_publish(draft, OPEN, OTHER)
    with pytest.raises(RoundClosedError):
        ensure_can_publish(draft, CLOSED, AUTHOR)
    with pytest.raises(AlreadyPublishedError):
        ensure_can_publish(_card(), OPEN, AUTHOR)


def test_only_the_master_promotes_published_retro_post_its() -> None:
    card = _card()
    assert can_promote(card, RETRO, MASTER)
    assert not can_promote(card, RETRO, PLAYER)
    assert not can_promote(_card(published_at=None), RETRO, MASTER)
    assert not can_promote(card, LINES, MASTER)
    ensure_can_promote(card, RETRO, LINES, MASTER, set(), 0)
    with pytest.raises(NotMasterError):
        ensure_can_promote(card, RETRO, LINES, PLAYER, set(), 0)
    with pytest.raises(DraftCardError):
        ensure_can_promote(_card(published_at=None), RETRO, LINES, MASTER, set(), 0)
    with pytest.raises(WrongBoardError):
        ensure_can_promote(card, RETRO, RETRO, MASTER, set(), 0)
    with pytest.raises(WrongBoardError):
        ensure_can_promote(card, LINES, VEILS, MASTER, set(), 0)
    with pytest.raises(AlreadyPromotedError):
        ensure_can_promote(card, RETRO, LINES, MASTER, {LINES.id}, 0)
    with pytest.raises(BoardFullError):
        ensure_can_promote(card, RETRO, LINES, MASTER, set(), MAX_CARDS_PER_BOARD)


def test_the_master_moves_lines_veils_post_its_between_their_columns() -> None:
    source = uuid.uuid4()
    copy = _card(column_id=LINES.id, source_card_id=source, promoted_by=OTHER)
    ensure_can_move(copy, LINES, VEILS, MASTER, set())
    ensure_can_move(copy, LINES, LINES, MASTER, {source})
    with pytest.raises(NotMasterError):
        ensure_can_move(copy, LINES, VEILS, PLAYER, set())
    with pytest.raises(WrongBoardError):
        ensure_can_move(copy, LINES, RETRO, MASTER, set())
    with pytest.raises(WrongBoardError):
        ensure_can_move(_card(), RETRO, LINES, MASTER, set())
    with pytest.raises(AlreadyPromotedError):
        ensure_can_move(copy, LINES, VEILS, MASTER, {source})
    orphan = replace(copy, source_card_id=None)
    ensure_can_move(orphan, LINES, VEILS, MASTER, {source})


def test_reactions_go_on_published_post_its_of_open_rounds() -> None:
    ensure_can_react(_card(), OPEN, "👍", set())
    ensure_can_react(_card(), None, "👍", set())
    with pytest.raises(DraftCardError):
        ensure_can_react(_card(published_at=None), OPEN, "👍", set())
    with pytest.raises(RoundClosedError):
        ensure_can_react(_card(), CLOSED, "👍", set())
    full = {chr(0x1F600 + i) for i in range(MAX_EMOJI_PER_CARD)}
    ensure_can_react(_card(), OPEN, next(iter(full)), full)
    with pytest.raises(TooManyCardEmojiError):
        ensure_can_react(_card(), OPEN, "👍", full)


def test_columns_are_added_to_open_rounds_up_to_the_limit() -> None:
    ensure_can_add_column(OPEN, MAX_RETRO_COLUMNS - 1)
    with pytest.raises(TooManyColumnsError):
        ensure_can_add_column(OPEN, MAX_RETRO_COLUMNS)
    with pytest.raises(RoundClosedError):
        ensure_can_add_column(CLOSED, 0)
    ensure_retro_column(RETRO, OPEN)
    with pytest.raises(WrongBoardError):
        ensure_retro_column(LINES, None)
    with pytest.raises(RoundClosedError):
        ensure_retro_column(RETRO, CLOSED)


def test_the_timer_starts_pauses_resumes_and_stops() -> None:
    running = apply_timer(STOPPED_TIMER, TimerAction.START, 300, NOW)
    assert running == Timer(300, NOW + timedelta(seconds=300), None)
    assert remaining_seconds(running, NOW + timedelta(seconds=100)) == 200
    assert remaining_seconds(running, NOW + timedelta(seconds=999)) == 0
    paused = apply_timer(running, TimerAction.PAUSE, None, NOW + timedelta(seconds=100))
    assert paused == Timer(300, None, 200)
    assert remaining_seconds(paused, NOW) == 200
    resumed = apply_timer(paused, TimerAction.RESUME, None, NOW)
    assert resumed == Timer(300, NOW + timedelta(seconds=200), None)
    assert apply_timer(resumed, TimerAction.STOP, None, NOW) == STOPPED_TIMER
    assert remaining_seconds(STOPPED_TIMER, NOW) is None


def test_the_timer_refuses_what_it_cannot_do() -> None:
    for length in (None, 59, 3601):
        with pytest.raises(InvalidTimerError):
            apply_timer(STOPPED_TIMER, TimerAction.START, length, NOW)
    with pytest.raises(InvalidTimerError):
        apply_timer(STOPPED_TIMER, TimerAction.PAUSE, None, NOW)
    finished = Timer(60, NOW, None)
    with pytest.raises(InvalidTimerError):
        apply_timer(finished, TimerAction.PAUSE, None, NOW)
    with pytest.raises(InvalidTimerError):
        apply_timer(finished, TimerAction.RESUME, None, NOW)

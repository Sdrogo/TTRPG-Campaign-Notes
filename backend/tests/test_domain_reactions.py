"""Reactions (spec 19c Decision 1): one emoji grapheme, never free text; no
reactions on a deleted placeholder; at most 20 different emoji per Comment."""

import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from app.domain.comments import plan_new_comment
from app.domain.models import Comment, DocumentVisibility, Reaction
from app.domain.reactions import (
    MAX_EMOJI_BYTES,
    MAX_EMOJI_PER_COMMENT,
    InvalidEmojiError,
    ReactionOnDeletedCommentError,
    TooManyReactionEmojiError,
    ensure_can_react,
    parse_emoji,
    summarize_reactions,
)

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=UTC)
VIEWER = uuid.uuid4()
OTHER = uuid.uuid4()


def _comment() -> Comment:
    return plan_new_comment(
        uuid.uuid4(), uuid.uuid4(), "The mists part.", DocumentVisibility.ROOM, NOW
    )


@pytest.mark.parametrize(
    "emoji",
    [
        "👍",  # a plain pictograph
        "❤️",  # with the emoji presentation selector
        "❤",  # a text-default pictograph without it
        "©",
        "👍🏽",  # a skin tone
        "🇮🇹",  # a flag
        "#️⃣",  # a keycap with VS16
        "1⃣",  # and without
        "👨‍👩‍👧‍👦",  # a family ZWJ sequence
        "🧑🏿‍🤝‍🧑🏻",  # skin tones inside a ZWJ sequence
        "🏳️‍🌈",  # VS16 then ZWJ
        "🏴󠁧󠁢󠁥󠁮󠁧󠁿",  # a subdivision flag (tag sequence)
        "\U0001fadf",  # a code point reserved for a future emoji
    ],
)
def test_one_emoji_grapheme_is_accepted_as_sent(emoji: str) -> None:
    assert parse_emoji(emoji) == emoji


@pytest.mark.parametrize(
    "text",
    [
        "",
        "a",
        "ok",
        "1",  # a digit alone is not a keycap
        "#️",  # nor is a keycap base without U+20E3
        "👍👍",  # two emoji
        "👍 ",
        "🇮",  # half a flag
        "🇮a",
        "🏽",  # a skin tone on its own
        "‍👍",  # starting with a joiner
        "👍‍",  # ending with one
        "👍‍a",  # joining text
        "🏴\U000e0067\U000e0062",  # a tag sequence without its end
        "🏴\U000e0067\U000e0062a",
        "a👍",
    ],
)
def test_anything_but_one_emoji_is_refused(text: str) -> None:
    with pytest.raises(InvalidEmojiError) as exc_info:
        parse_emoji(text)
    assert exc_info.value.key == "errors.reaction.invalidEmoji"


def test_an_emoji_over_the_byte_limit_is_refused() -> None:
    # A kiss with two different skin tones is 35 bytes.
    kiss = "👩🏻‍❤️‍💋‍👨🏼"
    assert len(kiss.encode()) > MAX_EMOJI_BYTES
    with pytest.raises(InvalidEmojiError):
        parse_emoji(kiss)


def test_reacting_to_a_live_comment_is_allowed() -> None:
    ensure_can_react(_comment(), "👍", [])


def test_a_deleted_placeholder_cannot_be_reacted_to() -> None:
    deleted = replace(_comment(), body="", deleted_at=NOW)
    with pytest.raises(ReactionOnDeletedCommentError) as exc_info:
        ensure_can_react(deleted, "👍", [])
    assert exc_info.value.key == "errors.reaction.commentDeleted"


def test_a_new_emoji_beyond_the_cap_is_refused_but_joining_one_is_not() -> None:
    # Repeats (several members on one emoji) don't count twice.
    used = [chr(0x1F600 + i) for i in range(MAX_EMOJI_PER_COMMENT)] * 2
    with pytest.raises(TooManyReactionEmojiError) as exc_info:
        ensure_can_react(_comment(), "🎲", used)
    assert exc_info.value.params == {"max": MAX_EMOJI_PER_COMMENT}
    ensure_can_react(_comment(), used[0], used)
    ensure_can_react(_comment(), "🎲", used[1:MAX_EMOJI_PER_COMMENT])


def test_reactions_are_grouped_by_emoji_in_order_of_first_use() -> None:
    comment_id = uuid.uuid4()

    def reaction(user: uuid.UUID, emoji: str, minutes: int) -> Reaction:
        return Reaction(comment_id, user, emoji, NOW + timedelta(minutes=minutes))

    summaries = summarize_reactions(
        [reaction(OTHER, "🎲", 0), reaction(VIEWER, "👍", 1), reaction(OTHER, "👍", 2)],
        VIEWER,
    )

    assert [(s.emoji, s.count, s.reacted_by_me, s.user_ids) for s in summaries] == [
        ("🎲", 1, False, [OTHER]),
        ("👍", 2, True, [VIEWER, OTHER]),
    ]


def test_no_reactions_summarize_to_nothing() -> None:
    assert summarize_reactions([], VIEWER) == []

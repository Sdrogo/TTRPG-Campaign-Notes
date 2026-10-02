"""Reactions on Comments (spec 19c, FR-T6): which text counts as one emoji,
who may react, how many different emoji a Comment may carry, and how a
Comment's reactions are summarized for a viewer."""

import uuid
from collections.abc import Collection, Iterable
from dataclasses import dataclass

from app.domain.errors import DomainError
from app.domain.models import Comment, Reaction

# Different emoji on one Comment (Decision 1), so a Comment can't be flooded.
MAX_EMOJI_PER_COMMENT = 20

# Longest emoji accepted, in UTF-8 bytes (the ticket's limit). Fits the
# families, the couples with skin tones and the subdivision flags; only a
# kiss with two different skin tones (35 bytes) is longer.
MAX_EMOJI_BYTES = 32

_ZWJ = 0x200D
_VS16 = 0xFE0F
_KEYCAP = 0x20E3
_TAG_END = 0xE007F

# Unicode's Extended_Pictographic property (emoji-data.txt), which also
# covers the blocks reserved for future emoji, so a newer emoji is accepted
# without a data update. Python's `unicodedata` doesn't expose it.
_PICTOGRAPHIC_RANGES = (
    (0x00A9, 0x00A9), (0x00AE, 0x00AE), (0x203C, 0x203C), (0x2049, 0x2049),
    (0x2122, 0x2122), (0x2139, 0x2139), (0x2194, 0x2199), (0x21A9, 0x21AA),
    (0x231A, 0x231B), (0x2328, 0x2328), (0x2388, 0x2388), (0x23CF, 0x23CF),
    (0x23E9, 0x23F3), (0x23F8, 0x23FA), (0x24C2, 0x24C2), (0x25AA, 0x25AB),
    (0x25B6, 0x25B6), (0x25C0, 0x25C0), (0x25FB, 0x25FE), (0x2600, 0x2605),
    (0x2607, 0x2612), (0x2614, 0x2685), (0x2690, 0x2705), (0x2708, 0x2712),
    (0x2714, 0x2714), (0x2716, 0x2716), (0x271D, 0x271D), (0x2721, 0x2721),
    (0x2728, 0x2728), (0x2733, 0x2734), (0x2744, 0x2744), (0x2747, 0x2747),
    (0x274C, 0x274C), (0x274E, 0x274E), (0x2753, 0x2755), (0x2757, 0x2757),
    (0x2763, 0x2767), (0x2795, 0x2797), (0x27A1, 0x27A1), (0x27B0, 0x27B0),
    (0x27BF, 0x27BF), (0x2934, 0x2935), (0x2B05, 0x2B07), (0x2B1B, 0x2B1C),
    (0x2B50, 0x2B50), (0x2B55, 0x2B55), (0x3030, 0x3030), (0x303D, 0x303D),
    (0x3297, 0x3297), (0x3299, 0x3299), (0x1F000, 0x1F0FF), (0x1F10D, 0x1F10F),
    (0x1F12F, 0x1F12F), (0x1F16C, 0x1F171), (0x1F17E, 0x1F17F), (0x1F18E, 0x1F18E),
    (0x1F191, 0x1F19A), (0x1F1AD, 0x1F1E5), (0x1F201, 0x1F20F), (0x1F21A, 0x1F21A),
    (0x1F22F, 0x1F22F), (0x1F232, 0x1F23A), (0x1F23C, 0x1F23F), (0x1F249, 0x1F3FA),
    (0x1F400, 0x1F53D), (0x1F546, 0x1F64F), (0x1F680, 0x1F6FF), (0x1F774, 0x1F77F),
    (0x1F7D5, 0x1F7FF), (0x1F80C, 0x1F80F), (0x1F848, 0x1F84F), (0x1F85A, 0x1F85F),
    (0x1F888, 0x1F88F), (0x1F8AE, 0x1F8FF), (0x1F90C, 0x1F93A), (0x1F93C, 0x1F945),
    (0x1F947, 0x1FAFF), (0x1FC00, 0x1FFFD),
)  # fmt: skip


class InvalidEmojiError(DomainError):
    """The reaction isn't exactly one emoji (Decision 1: never free text)."""


class ReactionOnDeletedCommentError(DomainError):
    """A deleted Comment's placeholder can't be reacted to (Decision 1)."""


class TooManyReactionEmojiError(DomainError):
    """The Comment already carries `MAX_EMOJI_PER_COMMENT` different emoji."""


@dataclass(frozen=True)
class ReactionSummary:
    """One emoji on a Comment as a viewer sees it: how many reacted with it,
    whether the viewer did, and who, in the order they reacted."""

    emoji: str
    count: int
    reacted_by_me: bool
    user_ids: list[uuid.UUID]


def _is_pictographic(code: int) -> bool:
    """Whether the code point is Extended_Pictographic."""
    return any(low <= code <= high for low, high in _PICTOGRAPHIC_RANGES)


def _is_regional_indicator(code: int) -> bool:
    """A flag letter: two of them make a country flag."""
    return 0x1F1E6 <= code <= 0x1F1FF


def _is_skin_tone(code: int) -> bool:
    """An emoji modifier (Fitzpatrick skin tone)."""
    return 0x1F3FB <= code <= 0x1F3FF


def _is_tag(code: int) -> bool:
    """A tag character, as in the subdivision flags (England, Scotland...)."""
    return 0xE0020 <= code <= 0xE007E


def _element_end(codes: list[int], start: int) -> int | None:
    """Where the emoji element starting at `start` ends (exclusive), or None
    if no element starts there. An element is a flag (two regional
    indicators), a keycap (`#`, `*` or a digit, an optional VS16, U+20E3),
    or a pictograph with an optional VS16 or skin tone and an optional tag
    sequence (UTS #51's emoji_zwj_element, a little more permissive)."""
    code = codes[start]
    if _is_regional_indicator(code):
        end = start + 2
        ok = end <= len(codes) and _is_regional_indicator(codes[start + 1])
        return end if ok else None
    if chr(code) in "#*0123456789":
        end = start + 1
        if end < len(codes) and codes[end] == _VS16:
            end += 1
        return end + 1 if end < len(codes) and codes[end] == _KEYCAP else None
    if not _is_pictographic(code):
        return None
    end = start + 1
    if end < len(codes) and (codes[end] == _VS16 or _is_skin_tone(codes[end])):
        end += 1
    if end < len(codes) and _is_tag(codes[end]):
        while end < len(codes) and _is_tag(codes[end]):
            end += 1
        if end == len(codes) or codes[end] != _TAG_END:
            return None
        end += 1
    return end


def parse_emoji(raw: str) -> str:
    """The reaction's emoji once it is known to be exactly one emoji
    grapheme (Decision 1): elements joined by ZWJ, skin tones and
    presentation selectors included, at most `MAX_EMOJI_BYTES` UTF-8 bytes.
    Anything else, text or two emoji, is refused (422). Stored as sent: the
    picker always sends the same form of an emoji, so a form with and one
    without VS16 are kept apart rather than guessed equal."""
    codes = [ord(char) for char in raw]
    if not codes or len(raw.encode()) > MAX_EMOJI_BYTES:
        raise InvalidEmojiError("errors.reaction.invalidEmoji")
    position = 0
    while True:
        end = _element_end(codes, position)
        if end is None:
            raise InvalidEmojiError("errors.reaction.invalidEmoji")
        if end == len(codes):
            return raw
        if codes[end] != _ZWJ or end + 1 == len(codes):
            raise InvalidEmojiError("errors.reaction.invalidEmoji")
        position = end + 1


def ensure_can_react(comment: Comment, emoji: str, emoji_on_comment: Collection[str]) -> None:
    """Decision 1: anyone who sees the Comment may react (the caller has
    checked that), never on a deleted placeholder (409), and a Comment holds
    at most `MAX_EMOJI_PER_COMMENT` different emoji: a new one beyond that is
    409, while joining an emoji already there always works.
    `emoji_on_comment` must be read under the Comment's lock, so two new
    emoji can't overshoot the cap together."""
    if comment.deleted_at is not None:
        raise ReactionOnDeletedCommentError("errors.reaction.commentDeleted")
    distinct = set(emoji_on_comment)
    if emoji not in distinct and len(distinct) >= MAX_EMOJI_PER_COMMENT:
        raise TooManyReactionEmojiError("errors.reaction.tooMany", max=MAX_EMOJI_PER_COMMENT)


def summarize_reactions(
    reactions: Iterable[Reaction], viewer_id: uuid.UUID
) -> list[ReactionSummary]:
    """A Comment's reactions grouped by emoji, for one viewer. Emoji come in
    the order they were first used and their users in the order they
    reacted, so chips don't move around as people join them. `reactions`
    must be oldest first."""
    users: dict[str, list[uuid.UUID]] = {}
    for reaction in reactions:
        users.setdefault(reaction.emoji, []).append(reaction.user_id)
    return [
        ReactionSummary(emoji=emoji, count=len(ids), reacted_by_me=viewer_id in ids, user_ids=ids)
        for emoji, ids in users.items()
    ]

"""Mention tokens in user text (spec 19c Decision 2, spec 20 Decision 1). A
mention is stored inline as `<sigil>[Name](<kind>:<uuid>)`: `@[Name](user:...)`
for a member, `#[Name](doc:...)` for a Document and `#[Name](tag:...)` for a
Tag. The name is the one shown when it was written; inside the
brackets `\\` escapes `]` and `\\`. Anything that doesn't read as a whole token
(an unknown kind, a sigil that doesn't go with its kind, a bad id, a missing
bracket) is plain text and stays exactly as written."""

import re
import uuid
from collections.abc import Callable, Collection, Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class MentionKind(StrEnum):
    """What a mention points at, as written after the `(`."""

    USER = "user"
    DOCUMENT = "doc"
    TAG = "tag"


# Which sigil goes with which kind: `@` names people, `#` names content.
_SIGILS = {MentionKind.USER: "@", MentionKind.DOCUMENT: "#", MentionKind.TAG: "#"}

# What follows a token's closing `]`: `(kind:uuid)`. The kind is checked
# against `MentionKind` afterwards, so an unknown one stays text.
_TARGET = re.compile(
    r"\(([a-z]+):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)"
)


@dataclass(frozen=True)
class Mention:
    """One well-formed token: its kind, the target's id, the name stored with
    it (unescaped) and where it sits in the text (`start` inclusive, `end`
    exclusive)."""

    kind: MentionKind
    target_id: uuid.UUID
    name: str
    start: int
    end: int


def _read_name(text: str, start: int) -> tuple[str, int] | None:
    """The unescaped name from `start` (just past the `[`) and the index of
    its closing `]`, or None when the bracket is never closed. A backslash
    keeps the next character as is."""
    name: list[str] = []
    index = start
    while index < len(text):
        char = text[index]
        if char == "\\" and index + 1 < len(text):
            name.append(text[index + 1])
            index += 2
        elif char == "]":
            return "".join(name), index
        else:
            name.append(char)
            index += 1
    return None


def find_mentions(text: str) -> list[Mention]:
    """Every well-formed token in `text`, in order. A token's name may be
    empty or hold brackets and parentheses (escaped `]` aside); it never
    spans a token found earlier."""
    found: list[Mention] = []
    index = 0
    while index < len(text) - 1:
        if text[index] not in "@#" or text[index + 1] != "[":
            index += 1
            continue
        read = _read_name(text, index + 2)
        target = None if read is None else _TARGET.match(text, read[1] + 1)
        kind = None if target is None else _kind(target.group(1))
        if read is None or target is None or kind is None or _SIGILS[kind] != text[index]:
            index += 1
            continue
        found.append(
            Mention(
                kind=kind,
                target_id=uuid.UUID(target.group(2)),
                name=read[0],
                start=index,
                end=target.end(),
            )
        )
        index = target.end()
    return found


def _kind(value: str) -> MentionKind | None:
    """The kind named `value`, or None for one this app doesn't know."""
    try:
        return MentionKind(value)
    except ValueError:
        return None


def unlink_non_members(text: str, member_ids: Collection[uuid.UUID]) -> str:
    """`text` with every `@` mention of someone who isn't one of
    `member_ids` turned back into plain `@Name` (spec 19c): a client can't
    store a link to an outsider or a made-up id. Mentions of members, other
    kinds of token and plain text are left exactly as written."""
    return unlink_mentions(
        text, lambda m: m.kind is not MentionKind.USER or m.target_id in member_ids
    )


def unlink_unknown_content(
    text: str, document_ids: Collection[uuid.UUID], tag_ids: Collection[uuid.UUID]
) -> str:
    """`text` with every `#` mention of a Document not in `document_ids` or a
    Tag not in `tag_ids` turned back into plain `#Name` (spec 20): a client
    can't store a link to another Room's content or a made-up id. `@`
    mentions are left alone."""

    def keep(mention: Mention) -> bool:
        if mention.kind is MentionKind.DOCUMENT:
            return mention.target_id in document_ids
        if mention.kind is MentionKind.TAG:
            return mention.target_id in tag_ids
        return True

    return unlink_mentions(text, keep)


def plain_mentions(text: str) -> str:
    """`text` with every Document and Tag token written back as plain
    `#Name`, its stored name (spec 20's data migration, when undone)."""
    return unlink_mentions(text, lambda m: m.kind is MentionKind.USER)


def unlink_mentions(text: str, keep: Callable[[Mention], bool]) -> str:
    """`text` with every token `keep` refuses turned back into its sigil and
    plain name. Repeated until nothing changes, since an unescaped name can
    itself read as a token; each pass shortens the text, so it ends."""
    while True:
        cleaned = _unlink_once(text, keep)
        if cleaned == text:
            return text
        text = cleaned


def _unlink_once(text: str, keep: Callable[[Mention], bool]) -> str:
    """One pass of `unlink_mentions` over the tokens found in `text`."""
    parts: list[str] = []
    last = 0
    for mention in find_mentions(text):
        if not keep(mention):
            parts.append(text[last : mention.start])
            parts.append(f"{_SIGILS[mention.kind]}{mention.name}")
            last = mention.end
    parts.append(text[last:])
    return "".join(parts)


def content_targets(text: str) -> tuple[set[uuid.UUID], set[uuid.UUID]]:
    """The Documents and the Tags `text` mentions, as two sets of ids."""
    mentions = find_mentions(text)
    return (
        {m.target_id for m in mentions if m.kind is MentionKind.DOCUMENT},
        {m.target_id for m in mentions if m.kind is MentionKind.TAG},
    )


def mention_token(kind: MentionKind, target_id: uuid.UUID, name: str) -> str:
    """The token for a mention of `target_id` shown as `name`, escaped so the
    name reads back exactly."""
    escaped = name.replace("\\", "\\\\").replace("]", "\\]")
    return f"{_SIGILS[kind]}[{escaped}]({kind.value}:{target_id})"


# --- Backlinks (spec 20 Decisions 3-4) ---------------------------------------

# About how long an excerpt is, the mention included.
EXCERPT_LENGTH = 120
_ELLIPSIS = "\u2026"
_SPACES = re.compile(r"\s+")


@dataclass(frozen=True)
class PlannedMention:
    """A row of `document_mentions` to write for one source: the Document or
    the Tag it names (exactly one) and the excerpt around its first mention."""

    target_document_id: uuid.UUID | None
    target_tag_id: uuid.UUID | None
    excerpt: str


def plan_source_mentions(text: str, source_document_id: uuid.UUID) -> list[PlannedMention]:
    """The backlinks one source (a description, a Note or a Comment of
    `source_document_id`) holds: one per Document or Tag it names, however
    many times, with an excerpt around the first mention. A Document naming
    itself is no backlink. `text` is already cleaned, so every target is one
    of the Room's."""
    planned: list[PlannedMention] = []
    seen: set[tuple[MentionKind, uuid.UUID]] = set()
    for mention in find_mentions(text):
        key = (mention.kind, mention.target_id)
        if mention.kind is MentionKind.USER or key in seen:
            continue
        if mention.kind is MentionKind.DOCUMENT and mention.target_id == source_document_id:
            continue
        seen.add(key)
        is_document = mention.kind is MentionKind.DOCUMENT
        planned.append(
            PlannedMention(
                target_document_id=mention.target_id if is_document else None,
                target_tag_id=None if is_document else mention.target_id,
                excerpt=mention_excerpt(text, mention),
            )
        )
    return planned


def mention_excerpt(text: str, mention: Mention, length: int = EXCERPT_LENGTH) -> str:
    """About `length` characters of `text` around `mention`, as a reader sees
    them: every token as its sigil and name, runs of whitespace as one
    space, cut on word boundaries with an ellipsis where text was left out."""
    before = _SPACES.sub(" ", display_text(text[: mention.start]))
    shown = f"{_SIGILS[mention.kind]}{mention.name}"
    after = _SPACES.sub(" ", display_text(text[mention.end :]))
    budget = max(0, length - len(shown))
    room_before = budget // 2
    room_after = budget - room_before
    # Room one side doesn't use goes to the other.
    room_after += max(0, room_before - len(before))
    room_before += max(0, room_after - len(after))
    return (_tail(before, room_before) + shown + _head(after, room_after)).strip()


def _tail(text: str, length: int) -> str:
    """The end of `text`, at most `length` characters, starting on a word."""
    if len(text) <= length:
        return text
    cut = text[len(text) - length :]
    space = cut.find(" ")
    return _ELLIPSIS + (cut[space:] if space != -1 else "")


def _head(text: str, length: int) -> str:
    """The start of `text`, at most `length` characters, ending on a word."""
    if len(text) <= length:
        return text
    cut = text[:length]
    space = cut.rfind(" ")
    return (cut[:space] if space != -1 else "") + _ELLIPSIS


def display_text(text: str) -> str:
    """`text` as a reader sees it: every token as its sigil and name (one
    pass, as the browser shows it)."""
    return _unlink_once(text, lambda _: False)


# --- Converting plain `#Name` text (spec 20 Decision 2) ---------------------

# A `#` starts a mention at the start of the text, after whitespace or after
# an opening bracket; the name ends where a word does. As in the browser's
# `splitMentions` (frontend/src/lib/documentMentions.ts).
_OPENING = "([{"


@dataclass(frozen=True)
class NamedTarget:
    """A Document or a Tag a plain `#Name` may refer to."""

    id: uuid.UUID
    name: str
    created_at: datetime


def convert_plain_mentions(
    text: str, documents: Sequence[NamedTarget], tags: Sequence[NamedTarget]
) -> str:
    """`text` with each plain `#Name` the browser resolves today written as a
    token, by the browser's rule: at each `#`, the longest name wins,
    compared ignoring case; a Document wins over a Tag with the same name,
    and of Documents with the same name the oldest. The token keeps the name
    as written. Existing tokens and a `#Name` naming nothing stay as they
    are."""
    candidates = sorted(
        [(d.name, MentionKind.DOCUMENT, d.id, d.created_at, 0) for d in documents]
        + [(t.name, MentionKind.TAG, t.id, t.created_at, 1) for t in tags],
        key=lambda c: (-len(c[0]), c[4], c[3], str(c[2])),
    )
    candidates = [c for c in candidates if c[0].strip()]
    tokens = find_mentions(text)
    parts: list[str] = []
    index = 0
    while index < len(text):
        token = next((t for t in tokens if t.start == index), None)
        if token is not None:
            parts.append(text[token.start : token.end])
            index = token.end
            continue
        limit = next((t.start for t in tokens if t.start > index), len(text))
        match = _plain_match(text, index, limit, candidates) if _starts_plain(text, index) else None
        if match is None:
            parts.append(text[index])
            index += 1
            continue
        kind, target_id, end = match
        parts.append(mention_token(kind, target_id, text[index + 1 : end]))
        index = end
    return "".join(parts)


def _starts_plain(text: str, index: int) -> bool:
    """Whether a `#` at `index` starts a mention."""
    return text[index] == "#" and (
        index == 0 or text[index - 1].isspace() or text[index - 1] in _OPENING
    )


def _plain_match(
    text: str,
    index: int,
    limit: int,
    candidates: Sequence[tuple[str, MentionKind, uuid.UUID, datetime, int]],
) -> tuple[MentionKind, uuid.UUID, int] | None:
    """The first of `candidates` (best first) named right after the `#` at
    `index`, ending on a word boundary before `limit`: its kind, id and where
    the name ends."""
    for name, kind, target_id, _, _ in candidates:
        end = index + 1 + len(name)
        written = text[index + 1 : end]
        if (
            end <= limit
            and len(written) == len(name)
            and written.casefold() == name.casefold()
            and (end == len(text) or not _is_word_char(text[end]))
        ):
            return kind, target_id, end
    return None


def _is_word_char(char: str) -> bool:
    """A letter, a digit or `_`: a name can't end right before one."""
    return char.isalnum() or char == "_"

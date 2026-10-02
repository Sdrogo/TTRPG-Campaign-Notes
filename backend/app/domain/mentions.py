"""Mention tokens in user text (spec 19c Decision 2, spec 20 Decision 1). A
mention is stored inline as `<sigil>[Name](<kind>:<uuid>)`: `@[Name](user:...)`
for a member, and, once spec 20 lands, `#[Name](doc:...)` and
`#[Name](tag:...)`. The name is the one shown when it was written; inside the
brackets `\\` escapes `]` and `\\`. Anything that doesn't read as a whole token
(an unknown kind, a sigil that doesn't go with its kind, a bad id, a missing
bracket) is plain text and stays exactly as written."""

import re
import uuid
from collections.abc import Collection
from dataclasses import dataclass
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
    parts: list[str] = []
    last = 0
    for mention in find_mentions(text):
        if mention.kind is MentionKind.USER and mention.target_id not in member_ids:
            parts.append(text[last : mention.start])
            parts.append(f"@{mention.name}")
            last = mention.end
    parts.append(text[last:])
    return "".join(parts)

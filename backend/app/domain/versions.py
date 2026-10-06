"""Version history of a Document's text and of each Note's text (spec 24,
FR-D5). A version holds a title (a Document's name or a Note's title) and a
description. Every save that changes them writes a version, except that saves
by the same person within `MERGE_WINDOW` update the latest one, so a typing
session leaves one version instead of a flood. Restoring never rewrites
history: it appends a version with the old text."""

import re
import uuid
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from difflib import SequenceMatcher

# Saves by the same editor closer together than this, measured from the
# latest version's last save, merge into it (spec 24 Decision 2).
MERGE_WINDOW = timedelta(minutes=10)


@dataclass(frozen=True)
class Version:
    """One saved state of a Document's name and description, or of a Note's
    title and description. `created_at` is when the version first appeared,
    `updated_at` the last save merged into it."""

    id: uuid.UUID
    title: str
    description: str
    edited_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class VersionWrite:
    """What to store for a save: `version` is a new row when `is_new`, the
    latest row with its text and time replaced otherwise."""

    version: Version
    is_new: bool


@dataclass(frozen=True)
class ChangeSize:
    """How many words a version added and removed against the one before."""

    words_added: int
    words_removed: int


def plan_version(
    latest: Version | None,
    editor: uuid.UUID,
    now: datetime,
    title: str,
    description: str,
    *,
    force_new: bool = False,
) -> VersionWrite | None:
    """What a save of this text writes, or None when it doesn't change the
    text of the latest version (nothing to record). The same editor within
    `MERGE_WINDOW` of the latest version's last save updates it; anyone else,
    or a later save, appends. `force_new` (a restore, Decision 3) always
    appends, so the old text becomes a version of its own and is never folded
    into the one before it."""
    if latest is not None and latest.title == title and latest.description == description:
        return None
    mergeable = (
        latest is not None
        and not force_new
        and latest.edited_by == editor
        and now - latest.updated_at <= MERGE_WINDOW
    )
    if mergeable and latest is not None:
        return VersionWrite(
            replace(latest, title=title, description=description, updated_at=now), False
        )
    return VersionWrite(Version(uuid.uuid4(), title, description, editor, now, now), True)


def _word_changes(old: str, new: str) -> tuple[int, int]:
    """Words added and removed between two texts, comparing whitespace-split
    words in order."""
    old_words = re.findall(r"\S+", old)
    new_words = re.findall(r"\S+", new)
    added = removed = 0
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, old_words, new_words).get_opcodes():
        if tag in ("replace", "delete"):
            removed += i2 - i1
        if tag in ("replace", "insert"):
            added += j2 - j1
    return added, removed


def change_size(previous: Version, current: Version) -> ChangeSize:
    """The words `current` added and removed against `previous`, the title and
    the description counted together (the list's "+12 −3")."""
    title_added, title_removed = _word_changes(previous.title, current.title)
    text_added, text_removed = _word_changes(previous.description, current.description)
    return ChangeSize(title_added + text_added, title_removed + text_removed)

"""A Room's Main Tags and their order (spec 11): the Tags the Documents list
groups by, in the order the Room's Administrators chose."""

import uuid
from collections.abc import Collection, Sequence

from app.domain.errors import DomainError


class DuplicateMainTagError(DomainError):
    """The same Tag appears twice in the requested Main Tag order."""


class UnknownMainTagError(DomainError):
    """A requested Main Tag isn't one of the Room's Tags."""


def plan_main_tags(
    room_tag_ids: Collection[uuid.UUID], ordered_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, int | None]:
    """The `main_position` every Tag of the Room ends up with: its index in
    `ordered_ids`, or None (not a Main Tag) when it isn't listed. The list
    replaces the previous selection wholesale, so an empty one clears every
    Main Tag. Rejects a repeated id and an id that isn't one of the Room's
    Tags, since a foreign id must never reach another Room's row."""
    if len(set(ordered_ids)) != len(ordered_ids):
        raise DuplicateMainTagError("errors.tag.duplicateMainTag")
    known = set(room_tag_ids)
    if not known.issuperset(ordered_ids):
        raise UnknownMainTagError("errors.tag.unknownMainTag")

    positions: dict[uuid.UUID, int | None] = {tag_id: None for tag_id in known}
    for position, tag_id in enumerate(ordered_ids):
        positions[tag_id] = position
    return positions

"""A Room's Main items and their order (specs 11 and 11_2): the line items the
Documents list groups by, in the order the Room's Administrators chose. An
item is either a single Tag (a Main Tag) or a combination of two or more Tags
(a Document belongs to it when it carries all of them)."""

import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass

from app.domain.errors import DomainError
from app.domain.models import Tag, TagCombination


class EmptyMainItemError(DomainError):
    """A requested Main item has no Tags."""


class DuplicateMainTagError(DomainError):
    """The same single Tag is listed twice, or a Tag repeats inside one
    combination."""


class DuplicateCombinationError(DomainError):
    """The same set of Tags is listed as a combination twice."""


class UnknownMainTagError(DomainError):
    """A requested Tag isn't one of the Room's Tags."""


@dataclass(frozen=True)
class PlannedCombination:
    """A combination to store: its place in the order and its Tags."""

    position: int
    tag_ids: tuple[uuid.UUID, ...]


@dataclass(frozen=True)
class MainItemsPlan:
    """What saving the Main items writes: each of the Room's Tags' single-Tag
    `main_position` (None when it isn't a single item) and the combinations
    that replace the Room's previous ones. Positions share one numbering, so
    sorting singles and combinations together gives the requested order."""

    tag_positions: dict[uuid.UUID, int | None]
    combinations: tuple[PlannedCombination, ...]


def plan_main_items(
    room_tag_ids: Collection[uuid.UUID], items: Sequence[Sequence[uuid.UUID]]
) -> MainItemsPlan:
    """Turns the requested ordered items into writes. An item with one Tag is
    a single Main Tag, with two or more a combination; the list replaces the
    previous selection wholesale, so an empty one clears it. Rejects an empty
    item, a Tag repeated as a single item or inside a combination, the same
    combination twice (order inside it doesn't matter) and any Tag that isn't
    one of the Room's - a foreign id must never reach another Room's rows. A
    Tag may be a single item and also part of combinations, or of several."""
    known = set(room_tag_ids)
    positions: dict[uuid.UUID, int | None] = {tag_id: None for tag_id in known}
    combinations: list[PlannedCombination] = []
    seen_combinations: set[frozenset[uuid.UUID]] = set()

    for position, item in enumerate(items):
        if not item:
            raise EmptyMainItemError("errors.tag.emptyMainItem")
        if len(set(item)) != len(item):
            raise DuplicateMainTagError("errors.tag.duplicateMainTag")
        if not known.issuperset(item):
            raise UnknownMainTagError("errors.tag.unknownMainTag")

        if len(item) == 1:
            if positions[item[0]] is not None:
                raise DuplicateMainTagError("errors.tag.duplicateMainTag")
            positions[item[0]] = position
        else:
            as_set = frozenset(item)
            if as_set in seen_combinations:
                raise DuplicateCombinationError("errors.tag.duplicateCombination")
            seen_combinations.add(as_set)
            combinations.append(PlannedCombination(position, tuple(item)))

    return MainItemsPlan(tag_positions=positions, combinations=tuple(combinations))


def ordered_main_items(
    tags: Sequence[Tag], combinations: Sequence[TagCombination]
) -> list[tuple[uuid.UUID, ...]]:
    """The Room's Main items in their chosen order: each single Main Tag as a
    one-Tag tuple, each combination as its Tags, sorted together by
    position."""
    entries: list[tuple[int, tuple[uuid.UUID, ...]]] = [
        (tag.main_position, (tag.id,)) for tag in tags if tag.main_position is not None
    ]
    entries += [(combination.position, combination.tag_ids) for combination in combinations]
    return [tag_ids for _, tag_ids in sorted(entries, key=lambda entry: entry[0])]

"""Modular Session 0 (spec 47): the chain of modules, who sees which step,
and the Stars and Wishes columns."""

import uuid
from dataclasses import replace
from datetime import UTC, datetime

import pytest

from app.domain.models import RoomRole
from app.domain.relationship_maps import MapColor
from app.domain.session_zero import (
    DEFAULT_CHAIN,
    MAX_MODULES,
    Card,
    Column,
    InvalidChainError,
    LastModuleError,
    LinesVeilsKind,
    Module,
    ModuleKind,
    Round,
    RoundClosedError,
    StarsWishesKind,
    WrongBoardError,
    can_promote,
    carry_source,
    clean_chain,
    column_kind,
    current_after_removal,
    ensure_can_add_module,
    ensure_can_promote,
    ensure_can_remove_module,
    ensure_retro_column,
    visible_modules,
)

NOW = datetime(2026, 10, 27, 21, 0, tzinfo=UTC)
ROOM = uuid.uuid4()
OPEN = Round(uuid.uuid4(), ROOM, 1, None, NOW, None)
CLOSED = replace(OPEN, closed_at=NOW)
MODULE = uuid.uuid4()
STARS = Column(uuid.uuid4(), ROOM, OPEN.id, StarsWishesKind.STARS, "", 0, module_id=MODULE)
WISHES = replace(STARS, id=uuid.uuid4(), kind=StarsWishesKind.WISHES, position=1)
RETRO = Column(uuid.uuid4(), ROOM, OPEN.id, None, "Want", 0, MapColor.GREEN, MODULE)
MUST = Column(uuid.uuid4(), ROOM, None, LinesVeilsKind.MUST, "", 0)


def _chain(*kinds: ModuleKind) -> list[Module]:
    return [Module(uuid.uuid4(), OPEN.id, kind, position) for position, kind in enumerate(kinds)]


def test_stars_and_wishes_columns_are_fixed_and_not_promoted() -> None:
    assert column_kind("stars") is StarsWishesKind.STARS
    assert column_kind("veils") is LinesVeilsKind.VEILS
    assert (STARS.shown_color, WISHES.shown_color) == (MapColor.GOLD, MapColor.BLUE)
    assert RETRO.shown_color is MapColor.GREEN
    assert STARS.is_retro and not STARS.is_promotable
    assert RETRO.is_promotable and not MUST.is_promotable
    card = Card(
        uuid.uuid4(), ROOM, STARS.id, uuid.uuid4(), "Great", False, NOW, None, None, NOW, NOW
    )
    assert not can_promote(card, STARS, RoomRole.MASTER)
    with pytest.raises(WrongBoardError):
        ensure_can_promote(card, STARS, MUST, RoomRole.MASTER, set(), 0)
    with pytest.raises(WrongBoardError):
        ensure_retro_column(STARS, OPEN)
    ensure_retro_column(RETRO, OPEN)


def test_a_chain_holds_one_to_ten_modules() -> None:
    assert DEFAULT_CHAIN == (ModuleKind.RETRO, ModuleKind.LINES_VEILS)
    assert clean_chain([ModuleKind.RETRO, ModuleKind.RETRO]) == [ModuleKind.RETRO] * 2
    with pytest.raises(InvalidChainError):
        clean_chain([])
    with pytest.raises(InvalidChainError):
        clean_chain([ModuleKind.RETRO] * (MAX_MODULES + 1))


def test_modules_are_added_and_removed_in_the_open_round_only() -> None:
    ensure_can_add_module(OPEN, MAX_MODULES - 1)
    with pytest.raises(InvalidChainError):
        ensure_can_add_module(OPEN, MAX_MODULES)
    with pytest.raises(RoundClosedError):
        ensure_can_add_module(CLOSED, 1)
    ensure_can_remove_module(OPEN, 2)
    with pytest.raises(LastModuleError):
        ensure_can_remove_module(OPEN, 1)
    with pytest.raises(RoundClosedError):
        ensure_can_remove_module(CLOSED, 2)


def test_removing_the_current_step_moves_the_table_back() -> None:
    first, second, third = _chain(ModuleKind.RETRO, ModuleKind.STARS_WISHES, ModuleKind.RETRO)
    chain = [first, second, third]
    assert current_after_removal(chain, third.id, first.id) == first.id
    assert current_after_removal(chain, second.id, second.id) == first.id
    assert current_after_removal(chain, first.id, first.id) == second.id
    assert current_after_removal([first], first.id, first.id) is None


def test_players_see_the_steps_already_reached() -> None:
    first, second, third = _chain(ModuleKind.RETRO, ModuleKind.LINES_VEILS, ModuleKind.RETRO)
    chain = [first, second, third]
    assert visible_modules(chain, first.id, RoomRole.MASTER) == chain
    assert visible_modules(chain, first.id, RoomRole.PLAYER) == [first]
    assert visible_modules(chain, second.id, RoomRole.PLAYER) == [first, second]
    assert visible_modules(chain, None, RoomRole.PLAYER) == []


def test_a_step_carries_over_from_the_newest_session_with_its_kind() -> None:
    """Spec 47b Decision 4."""
    newest = _chain(ModuleKind.STARS_WISHES)
    older = _chain(ModuleKind.QUESTIONS, ModuleKind.RETRO, ModuleKind.QUESTIONS)
    earlier = [newest, older]
    assert carry_source(earlier, ModuleKind.QUESTIONS, 0) == older[0]
    assert carry_source(earlier, ModuleKind.QUESTIONS, 1) == older[2]
    assert carry_source(earlier, ModuleKind.QUESTIONS, 5) == older[2]
    assert carry_source(earlier, ModuleKind.DDI, 0) is None
    assert carry_source(earlier, ModuleKind.STARS_WISHES, 0) is None
    assert carry_source([], ModuleKind.RETRO, 0) is None

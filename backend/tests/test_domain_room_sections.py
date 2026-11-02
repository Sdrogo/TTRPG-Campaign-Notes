"""The landing page's rules (spec 55): who edits it, the page cards, the
limits, what a block may hold, and what a Tag's deletion or a Room's copy
does to the blocks."""

import uuid

import pytest

from app.domain.models import RoomRole
from app.domain.room_sections import (
    MAX_BLOCKS,
    MAX_DESCRIPTION_LENGTH,
    MAX_GROUPS,
    MAX_SECTIONS,
    MAX_TITLE_LENGTH,
    PAGE_KINDS,
    Block,
    BlockFieldNotAllowedError,
    BlockInput,
    BlockKind,
    BlockMapKind,
    DocumentsBlockNeedsTagError,
    DocumentsSectionRequiredError,
    InvalidGroupError,
    NotAToolError,
    OnlyMasterEditsLandingError,
    PageSectionExistsError,
    PageSectionHasNoBlocksError,
    Section,
    SectionDescriptionTooLongError,
    SectionKind,
    SectionOrderMismatchError,
    SectionTitleRequiredError,
    SectionTitleTooLongError,
    SessionZeroBlockNeedsFeatureError,
    SessionZeroFeature,
    TooManyBlocksError,
    TooManyGroupsError,
    TooManySectionsError,
    UnknownBlockTagError,
    UnknownToolError,
    clean_description,
    clean_title,
    copy_sections,
    default_sections,
    dropped_tools,
    ensure_can_delete,
    ensure_can_edit,
    plan_blocks,
    plan_new_section,
    plan_new_tool,
    plan_order,
    plan_section_image_path,
    prune_after_tag_deletion,
)

ROOM = uuid.uuid4()
A, B, C = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


def _section(kind: SectionKind = SectionKind.CUSTOM, position: int = 0) -> Section:
    return Section(id=uuid.uuid4(), room_id=ROOM, kind=kind, position=position, title="Tokyo")


def _documents(*groups: tuple[uuid.UUID, ...], tags: tuple[uuid.UUID, ...] = (A, B)) -> Block:
    return Block(id=uuid.uuid4(), kind=BlockKind.DOCUMENTS, position=0, tag_ids=tags, groups=groups)


def test_only_the_master_edits_the_landing() -> None:
    ensure_can_edit(RoomRole.MASTER)
    with pytest.raises(OnlyMasterEditsLandingError):
        ensure_can_edit(RoomRole.PLAYER)


def test_a_new_room_starts_with_the_three_untitled_page_cards() -> None:
    sections = default_sections(ROOM)
    assert [s.kind for s in sections] == list(PAGE_KINDS)
    assert [s.position for s in sections] == [0, 1, 2]
    assert {s.title for s in sections} == {None}
    assert {s.room_id for s in sections} == {ROOM}


def test_titles_are_trimmed_required_on_custom_sections_and_bounded() -> None:
    assert clean_title("  Tokyo ", SectionKind.CUSTOM) == "Tokyo"
    assert clean_title("  ", SectionKind.PAGE_MAPS) is None
    assert clean_title(None, SectionKind.PAGE_MAPS) is None
    with pytest.raises(SectionTitleRequiredError):
        clean_title(" ", SectionKind.CUSTOM)
    with pytest.raises(SectionTitleTooLongError):
        clean_title("x" * (MAX_TITLE_LENGTH + 1), SectionKind.CUSTOM)


def test_descriptions_are_trimmed_and_bounded() -> None:
    assert clean_description("  Neon  ") == "Neon"
    with pytest.raises(SectionDescriptionTooLongError):
        clean_description("x" * (MAX_DESCRIPTION_LENGTH + 1))


def test_a_new_section_goes_last() -> None:
    existing = default_sections(ROOM)
    section = plan_new_section(ROOM, existing, SectionKind.CUSTOM, " Tokyo ")
    assert (section.position, section.title, section.kind) == (3, "Tokyo", SectionKind.CUSTOM)
    assert plan_new_section(ROOM, [], SectionKind.CUSTOM, "First").position == 0


def test_a_page_card_comes_back_only_once() -> None:
    existing = default_sections(ROOM)
    with pytest.raises(PageSectionExistsError):
        plan_new_section(ROOM, existing, SectionKind.PAGE_MAPS, None)
    back = plan_new_section(ROOM, existing[:1], SectionKind.PAGE_MAPS, None)
    assert (back.kind, back.title) == (SectionKind.PAGE_MAPS, None)


def test_a_room_holds_a_limited_number_of_sections() -> None:
    existing = [_section(position=i) for i in range(MAX_SECTIONS)]
    with pytest.raises(TooManySectionsError):
        plan_new_section(ROOM, existing, SectionKind.CUSTOM, "One more")


def test_the_documents_page_card_cannot_be_deleted() -> None:
    ensure_can_delete(_section(SectionKind.PAGE_MAPS))
    ensure_can_delete(_section())
    with pytest.raises(DocumentsSectionRequiredError):
        ensure_can_delete(_section(SectionKind.PAGE_DOCUMENTS))


def test_an_order_names_every_section_once() -> None:
    sections = default_sections(ROOM)
    ids = [s.id for s in reversed(sections)]
    assert plan_order(sections, ids) == {ids[0]: 0, ids[1]: 1, ids[2]: 2}
    for wrong in (ids[:2], [*ids, ids[0]], [*ids[:2], uuid.uuid4()]):
        with pytest.raises(SectionOrderMismatchError):
            plan_order(sections, wrong)


def test_blocks_are_planned_in_order_without_repeats() -> None:
    blocks = plan_blocks(
        _section(),
        [
            BlockInput(BlockKind.DOCUMENTS, heading="  PNG ", tag_ids=[A, B, A], groups=[[A, A]]),
            BlockInput(BlockKind.MAPS, heading=" ", map_kind=BlockMapKind.GEOGRAPHIC),
            BlockInput(
                BlockKind.SESSION_ZERO,
                features=[SessionZeroFeature.POLLS, SessionZeroFeature.SESSIONS] * 2,
            ),
        ],
        {A, B},
    )
    documents, maps, session_zero = blocks
    assert [b.position for b in blocks] == [0, 1, 2]
    assert (documents.heading, documents.tag_ids, documents.groups) == ("PNG", (A, B), ((A,),))
    assert (maps.heading, maps.map_kind) == (None, BlockMapKind.GEOGRAPHIC)
    assert session_zero.features == (SessionZeroFeature.POLLS, SessionZeroFeature.SESSIONS)
    # A maps block may keep every kind.
    (every,) = plan_blocks(_section(), [BlockInput(BlockKind.MAPS)], set())
    assert every.map_kind is None


def test_page_cards_have_no_blocks() -> None:
    with pytest.raises(PageSectionHasNoBlocksError):
        plan_blocks(_section(SectionKind.PAGE_MAPS), [], set())


@pytest.mark.parametrize(
    ("block", "error"),
    [
        (BlockInput(BlockKind.DOCUMENTS), DocumentsBlockNeedsTagError),
        (BlockInput(BlockKind.SESSION_ZERO), SessionZeroBlockNeedsFeatureError),
        (BlockInput(BlockKind.MAPS, tag_ids=[A]), BlockFieldNotAllowedError),
        (BlockInput(BlockKind.MAPS, groups=[[A]]), BlockFieldNotAllowedError),
        (
            BlockInput(BlockKind.DOCUMENTS, tag_ids=[A], map_kind=BlockMapKind.FREE),
            BlockFieldNotAllowedError,
        ),
        (
            BlockInput(BlockKind.MAPS, features=[SessionZeroFeature.RETRO]),
            BlockFieldNotAllowedError,
        ),
        (BlockInput(BlockKind.DOCUMENTS, tag_ids=[C]), UnknownBlockTagError),
        (BlockInput(BlockKind.DOCUMENTS, tag_ids=[A], groups=[[C]]), UnknownBlockTagError),
        (BlockInput(BlockKind.DOCUMENTS, tag_ids=[A], groups=[[]]), InvalidGroupError),
        (
            BlockInput(BlockKind.DOCUMENTS, tag_ids=[A], groups=[[A, B], [B, A]]),
            InvalidGroupError,
        ),
        (
            BlockInput(BlockKind.DOCUMENTS, tag_ids=[A], heading="x" * (MAX_TITLE_LENGTH + 1)),
            SectionTitleTooLongError,
        ),
    ],
)
def test_a_block_carries_only_what_its_kind_allows(
    block: BlockInput, error: type[Exception]
) -> None:
    with pytest.raises(error):
        plan_blocks(_section(), [block], {A, B})


def test_a_section_and_a_block_have_limits() -> None:
    with pytest.raises(TooManyBlocksError):
        plan_blocks(_section(), [BlockInput(BlockKind.MAPS)] * (MAX_BLOCKS + 1), set())
    tags = [uuid.uuid4() for _ in range(MAX_GROUPS + 1)]
    with pytest.raises(TooManyGroupsError):
        plan_blocks(
            _section(),
            [BlockInput(BlockKind.DOCUMENTS, tag_ids=[tags[0]], groups=[[t] for t in tags])],
            set(tags),
        )


def test_a_deleted_tag_leaves_the_blocks() -> None:
    maps = Block(id=uuid.uuid4(), kind=BlockKind.MAPS, position=0)
    assert prune_after_tag_deletion(maps, A) is maps
    assert prune_after_tag_deletion(_documents(tags=(A,)), A) is None
    pruned = prune_after_tag_deletion(_documents((A,), (A, C), (C,), (B,), tags=(A, B)), A)
    assert pruned is not None
    # (A) empties and goes, (A, C) becomes (C) and merges with the next one.
    assert (pruned.tag_ids, pruned.groups) == ((B,), ((C,), (B,)))


def test_a_copied_landing_points_at_the_copy() -> None:
    copy_room = uuid.uuid4()
    a2, b2 = uuid.uuid4(), uuid.uuid4()
    original = Section(
        id=uuid.uuid4(),
        room_id=ROOM,
        kind=SectionKind.CUSTOM,
        position=4,
        title="Tokyo",
        image_path="rooms/x/sections/y.webp",
        blocks=(_documents((A, B), tags=(A,)),),
    )
    (copy,) = copy_sections([original], copy_room, {A: a2, B: b2})
    (block,) = copy.blocks
    assert copy.id != original.id and block.id != original.blocks[0].id
    assert (copy.room_id, copy.position, copy.title) == (copy_room, 4, "Tokyo")
    assert copy.image_path == original.image_path
    assert (block.tag_ids, block.groups) == ((a2,), ((a2, b2),))


def test_each_section_image_gets_a_fresh_name() -> None:
    first, second = plan_section_image_path(ROOM), plan_section_image_path(ROOM)
    assert first.startswith(f"rooms/{ROOM}/sections/") and first.endswith(".webp")
    assert first != second


def _tool(position: int = 0) -> Block:
    return Block(id=uuid.uuid4(), kind=BlockKind.TOOL, position=position, module_id=uuid.uuid4())


def test_tool_blocks_name_their_sections_tools_once() -> None:
    poll, retro = _tool(0), _tool(1)
    section = Section(
        id=uuid.uuid4(),
        room_id=ROOM,
        kind=SectionKind.CUSTOM,
        position=0,
        title="T",
        blocks=(poll, retro),
    )

    planned = plan_blocks(
        section,
        [
            BlockInput(BlockKind.MAPS, collapsed=True),
            BlockInput(BlockKind.TOOL, module_id=retro.module_id),
        ],
        set(),
    )

    assert [(b.kind, b.module_id, b.collapsed) for b in planned] == [
        (BlockKind.MAPS, None, True),
        (BlockKind.TOOL, retro.module_id, False),
    ]
    assert dropped_tools(section, planned) == {poll.module_id}
    for blocks, error in (
        ([BlockInput(BlockKind.TOOL)], UnknownToolError),
        ([BlockInput(BlockKind.TOOL, module_id=uuid.uuid4())], UnknownToolError),
        ([BlockInput(BlockKind.TOOL, module_id=poll.module_id)] * 2, UnknownToolError),
        ([BlockInput(BlockKind.MAPS, module_id=poll.module_id)], BlockFieldNotAllowedError),
    ):
        with pytest.raises(error):
            plan_blocks(section, blocks, set())


def test_a_new_tool_goes_last_on_a_custom_section() -> None:
    section = Section(
        id=uuid.uuid4(),
        room_id=ROOM,
        kind=SectionKind.CUSTOM,
        position=0,
        title="T",
        blocks=(_tool(),),
    )
    assert plan_new_tool(section, "poll", {"poll"}) == 1
    with pytest.raises(NotAToolError):
        plan_new_tool(section, "lines_veils", {"poll"})
    with pytest.raises(PageSectionHasNoBlocksError):
        plan_new_tool(_section(SectionKind.PAGE_MAPS), "poll", {"poll"})
    full = Section(
        id=uuid.uuid4(),
        room_id=ROOM,
        kind=SectionKind.CUSTOM,
        position=0,
        title="T",
        blocks=tuple(_tool(i) for i in range(MAX_BLOCKS)),
    )
    with pytest.raises(TooManyBlocksError):
        plan_new_tool(full, "poll", {"poll"})


def test_a_copied_landing_leaves_the_tools_out() -> None:
    maps = Block(id=uuid.uuid4(), kind=BlockKind.MAPS, position=1, collapsed=True)
    original = Section(
        id=uuid.uuid4(),
        room_id=ROOM,
        kind=SectionKind.CUSTOM,
        position=0,
        title="T",
        blocks=(_tool(0), maps),
    )
    (copy,) = copy_sections([original], uuid.uuid4(), {})
    (block,) = copy.blocks
    assert (block.kind, block.position, block.collapsed) == (BlockKind.MAPS, 0, True)

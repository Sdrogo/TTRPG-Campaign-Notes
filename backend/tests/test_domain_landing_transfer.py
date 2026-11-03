"""The Room home in the export and the import (spec 56, no database): a
Section as the file writes it, read back and planned into a Room."""

import json
import uuid
from typing import Any

import pytest

from app.domain import room_sections
from app.domain.import_files import ImportFile, ImportRefusedError, file_from_json, parse_file
from app.domain.imports import ImportChoices, ImportContext, plan_import, validate_files
from app.domain.landing_transfer import (
    FileSection,
    SectionSkipReason,
    UnreadableSectionError,
    has_content,
    read_section,
    section_kind,
    section_title,
    section_to_json,
)
from app.domain.models import DocumentVisibility
from app.domain.room_sections import (
    Block,
    BlockKind,
    BlockMapKind,
    Section,
    SectionKind,
    SessionZeroFeature,
    default_sections,
)

ROOM = uuid.UUID(int=1)
TOKYO, IDOL, GONE = "t-tokyo", "t-idol", "t-gone"


def _file(*sections: dict[str, Any], **extra: Any) -> ImportFile:
    data = {
        "schema_version": 4,
        "documents": [{"name": "Shibuya"}],
        "tags": [
            {"id": TOKYO, "name": "Tokyo", "category": "Place"},
            {"id": IDOL, "name": "Idol", "category": None},
        ],
        "sections": list(sections),
        **extra,
    }
    return parse_file("room.json", json.dumps(data).encode())


def _context(**fields: Any) -> ImportContext:
    base: dict[str, Any] = {
        "default_visibility": DocumentVisibility.ROOM,
        "existing": {},
        "room_tags": {"tokyo": (uuid.UUID(int=7), "Tokyo")},
        "can_manage_tags": True,
        "is_master": True,
        "room_id": ROOM,
        "sections": default_sections(ROOM),
    }
    return ImportContext(**{**base, **fields})


def _custom(title: str = "City", **fields: Any) -> dict[str, Any]:
    return {"id": str(uuid.uuid4()), "kind": "custom", "title": title, **fields}


def test_a_section_is_written_with_its_blocks_and_reads_back() -> None:
    tag = uuid.uuid4()
    section = Section(
        id=uuid.uuid4(),
        room_id=ROOM,
        kind=SectionKind.CUSTOM,
        position=3,
        title="City",
        description="Neon",
        image_path="rooms/x.webp",
        blocks=(
            Block(uuid.uuid4(), BlockKind.DOCUMENTS, 0, "People", (tag,), ((tag,),)),
            Block(uuid.uuid4(), BlockKind.MAPS, 1, map_kind=BlockMapKind.GEOGRAPHIC),
            Block(
                uuid.uuid4(),
                BlockKind.SESSION_ZERO,
                2,
                features=(SessionZeroFeature.POLLS, SessionZeroFeature.DDI),
            ),
        ),
    )

    data = section_to_json(section, "https://signed.test/x")
    read = read_section(json.loads(json.dumps(data)))

    assert data["image_url"] == "https://signed.test/x"
    assert read.kind is SectionKind.CUSTOM and read.description == "Neon"
    assert read.blocks[0].tag_ids == (str(tag),) and read.blocks[0].groups == ((str(tag),),)
    assert read.blocks[1].map_kind is BlockMapKind.GEOGRAPHIC
    assert read.blocks[2].features == (SessionZeroFeature.POLLS, SessionZeroFeature.DDI)


@pytest.mark.parametrize(
    "fields",
    [
        {"kind": "page_rooms"},
        {"title": 3},
        {"blocks": "x"},
        {"blocks": ["x"]},
        {"blocks": [{"kind": "notes"}]},
        {"blocks": [{"kind": "documents", "tag_ids": [3]}]},
        {"blocks": [{"kind": "maps", "map_kind": "mention"}]},
        {"blocks": [{"kind": "session_zero", "features": ["dice"]}]},
    ],
)
def test_a_section_with_a_field_of_the_wrong_kind_is_unreadable(fields: dict[str, Any]) -> None:
    with pytest.raises(UnreadableSectionError):
        read_section(_custom(**fields))


def test_the_preview_names_a_section_even_when_it_cannot_be_read() -> None:
    assert read_section({}).kind is SectionKind.CUSTOM
    assert section_title({"title": "  City "}) == "City"
    assert section_title({"title": "  "}) is None and section_title({"title": 3}) is None
    assert section_kind({"kind": "page_maps"}) is SectionKind.PAGE_MAPS
    assert section_kind({"kind": ["x"]}) is SectionKind.CUSTOM
    assert section_kind({}) is SectionKind.CUSTOM
    empty = FileSection(SectionKind.PAGE_MAPS, " ", " ", None, ())
    assert not has_content(empty)


def test_a_master_imports_custom_sections_with_their_tags_matched_or_created() -> None:
    file = _file(
        _custom(
            description=" Neon ",
            blocks=[
                {"kind": "documents", "tag_ids": [TOKYO, GONE], "groups": [[IDOL], [GONE], [IDOL]]},
                {"kind": "documents", "heading": "Lost", "tag_ids": [GONE]},
                {"kind": "maps", "map_kind": "free"},
            ],
        ),
    )

    plan = plan_import([file], _context())

    (section,) = plan.sections
    assert section.skipped is None and section.kind is SectionKind.CUSTOM
    assert section.description == "Neon" and section.skipped_blocks == 1
    created = {t.name: t for t in plan.new_tags}
    assert set(created) == {"Idol"}
    documents, maps = section.blocks
    assert documents.tag_ids == (uuid.UUID(int=7),)
    assert documents.groups == ((created["Idol"].id,),)
    assert maps.map_kind is BlockMapKind.FREE and maps.position == 1


def test_page_cards_with_content_are_offered_and_applied_when_chosen() -> None:
    landing = default_sections(ROOM)[:2]  # the Room deleted its Session 0 card
    file = _file(
        {"kind": "page_documents", "title": " Archive ", "description": "All of it"},
        {"kind": "page_maps", "title": None, "description": ""},
        {"kind": "page_session_zero", "image_url": "https://img.test/a.png"},
        {"kind": "page_maps", "description": 3},
    )

    previewed = plan_import([file], _context(sections=landing))
    chosen = plan_import(
        [file],
        _context(sections=landing),
        ImportChoices(page_cards=frozenset({previewed.sections[0].key})),
    )

    documents, session_zero = previewed.sections
    assert documents.id == landing[0].id and documents.title == "Archive"
    assert documents.is_page_card and documents.description == "All of it"
    assert session_zero.id not in {s.id for s in landing}
    assert session_zero.image_url == "https://img.test/a.png" and session_zero.title is None
    assert [s.key for s in chosen.sections] == [documents.key]


def test_a_section_that_breaks_a_rule_or_the_cap_is_skipped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(room_sections, "MAX_SECTIONS", 5)
    file = _file(
        _custom("A"),
        _custom("  "),
        _custom("x" * 101),
        _custom("B", blocks=[{"kind": "session_zero"}]),
        _custom("Bad", blocks=[{"kind": "spells"}]),
        {"kind": "page_maps", "description": 5},
        _custom("C"),
        _custom("D"),
    )

    plan = plan_import([file], _context())
    unticked = plan_import([file], _context(), ImportChoices(sections=frozenset({"0:section:0"})))

    assert [(s.title, s.skipped) for s in plan.sections] == [
        ("A", None),
        (None, SectionSkipReason.INVALID),
        ("x" * 101, SectionSkipReason.INVALID),
        ("B", SectionSkipReason.INVALID),
        ("Bad", SectionSkipReason.INVALID),
        ("C", None),
        ("D", SectionSkipReason.LIMIT),
    ]
    assert [s.title for s in unticked.sections] == ["A"]


def test_only_the_masters_import_brings_sections() -> None:
    file = _file(_custom())

    assert plan_import([file], _context(is_master=False)).sections == ()
    assert plan_import([file], _context(room_id=None)).sections == ()


def test_sections_must_be_a_list_of_objects_and_within_the_cap() -> None:
    for sections in ('"x"', '["x"]'):
        with pytest.raises(ImportRefusedError):
            parse_file(
                "a.json", f'{{"documents": [{{"name": "A"}}], "sections": {sections}}}'.encode()
            )
    file = _file()
    many = ImportFile("a.json", file.documents, sections=tuple({} for _ in range(101)))

    with pytest.raises(ImportRefusedError) as raised:
        validate_files([many])

    assert raised.value.key == "errors.import.tooManySections"


def test_a_job_payload_without_sections_still_reads() -> None:
    from app.domain.import_files import file_to_json

    payload = file_to_json(_file(_custom()))
    del payload["sections"]

    assert file_from_json(payload).sections == ()


def test_a_tool_block_is_never_written_nor_imported_and_folding_travels() -> None:
    section = Section(
        id=uuid.uuid4(),
        room_id=ROOM,
        kind=SectionKind.CUSTOM,
        position=3,
        title="City",
        blocks=(
            Block(uuid.uuid4(), BlockKind.TOOL, 0, module_id=uuid.uuid4()),
            Block(uuid.uuid4(), BlockKind.MAPS, 1, collapsed=True),
        ),
    )

    data = section_to_json(section, None)

    assert [(b["kind"], b["collapsed"]) for b in data["blocks"]] == [("maps", True)]
    file = _file(_custom(blocks=[{"kind": "tool"}, {"kind": "maps", "collapsed": True}]))
    (planned,) = plan_import([file], _context()).sections
    assert planned.skipped_blocks == 1
    assert [(b.kind, b.collapsed) for b in planned.blocks] == [(BlockKind.MAPS, True)]

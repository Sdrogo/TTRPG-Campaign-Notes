"""Reading an import file and planning what it writes (spec 27, no database)."""

import json
import uuid
from typing import Any

import pytest

from app.domain.errors import DomainError
from app.domain.import_files import (
    ImportCannotReplaceError,
    ImportDocument,
    ImportFile,
    ImportNote,
    ImportRefusedError,
    ImportTag,
    MentionRef,
    file_from_json,
    file_to_json,
    parse_file,
)
from app.domain.imports import (
    MAX_DOCUMENTS,
    MAX_FILES,
    MAX_IMAGES,
    ExistingDocument,
    ImportChoices,
    ImportContext,
    document_key,
    fold,
    plan_import,
    validate_files,
)
from app.domain.mentions import MentionKind, find_mentions
from app.domain.models import DocumentVisibility


def _json(data: Any, name: str = "x.json") -> ImportFile:
    return parse_file(name, json.dumps(data).encode())


def _document(name: str = "Strahd", **fields: Any) -> ImportDocument:
    base: dict[str, Any] = {
        "source_id": None,
        "name": name,
        "text": (),
        "visibility": None,
        "tag_names": (),
        "notes": (),
        "images": (),
    }
    return ImportDocument(**{**base, **fields})


def _context(**fields: Any) -> ImportContext:
    base: dict[str, Any] = {
        "default_visibility": DocumentVisibility.ROOM,
        "existing": {},
        "room_tags": {},
        "can_manage_tags": True,
    }
    return ImportContext(**{**base, **fields})


# --- JSON ----------------------------------------------------------------------


def test_a_hand_written_json_with_only_names_and_descriptions_is_read() -> None:
    parsed = _json({"documents": [{"name": " Strahd ", "description": "A vampire."}]})

    (document,) = parsed.documents
    assert document.name == "Strahd"
    assert document.text == ("A vampire.",)
    assert document.source_id is None
    assert document.visibility is None


def test_a_list_of_documents_is_read_like_the_documents_key() -> None:
    parsed = _json([{"name": "A"}, {"name": "B"}])

    assert [d.name for d in parsed.documents] == ["A", "B"]


def test_a_room_export_is_read_with_tags_notes_images_and_what_is_dropped() -> None:
    doc_id, tag_id, other = (str(uuid.uuid4()) for _ in range(3))
    parsed = _json(
        {
            "schema_version": 1,
            "tags": [{"id": tag_id, "name": "NPC", "category": "Type"}, {"id": 3, "name": ""}],
            "unknown": "ignored",
            "documents": [
                {
                    "id": doc_id,
                    "name": "Strahd",
                    "visibility": "master",
                    "tag_ids": [tag_id, "missing"],
                    "description": [
                        {"type": "text", "text": "See "},
                        {"type": "mention", "kind": "doc", "target_id": other, "name": "Lair"},
                        {"type": "text", "text": " and "},
                        {"type": "mention", "kind": "tag", "target_id": tag_id, "name": "NPC"},
                        {"type": "mention", "kind": "alien", "target_id": other, "name": "Odd"},
                        {"type": "mention", "kind": "doc", "name": "Nowhere"},
                        "!",
                    ],
                    "notes": [{"title": "Rumor", "description": "text", "visibility": "selective"}],
                    "images": [
                        {"id": "i1", "url": "https://x.test/a.png", "is_favorite": True},
                        {"id": "i2", "url": ""},
                    ],
                    "files": [{}, {}],
                    "comments": [{}],
                    "played_by": str(uuid.uuid4()),
                }
            ],
        }
    )

    (document,) = parsed.documents
    assert document.source_id == doc_id
    assert document.tag_names == ("NPC",)
    assert document.text == (
        "See ",
        MentionRef(MentionKind.DOCUMENT, other, "Lair"),
        " and ",
        MentionRef(MentionKind.TAG, tag_id, "NPC"),
        "OddNowhere!",
    )
    assert document.notes == (ImportNote("Rumor", ("text",), "selective"),)
    assert [(i.source_id, i.is_favorite) for i in document.images] == [("i1", True)]
    assert (document.comment_count, document.file_count, document.has_player) == (1, 2, True)
    assert parsed.tags == {tag_id: ImportTag("NPC", "Type")}


@pytest.mark.parametrize(
    "content",
    [
        b"{not json",
        b"[1]",
        b"3",
        b'{"documents": 5}',
        b'{"documents": [{"name": "A", "notes": [3]}]}',
        b'{"documents": [{"name": "A", "tag_ids": 3}]}',
        b'{"documents": [{"name": {"x": 1}}]}',
        b'{"documents": [{"name": "A", "description": 5}]}',
        b'{"documents": [{"name": "A", "description": [5]}]}',
        b'{"schema_version": "1", "documents": []}',
        b'{"schema_version": true, "documents": []}',
        pytest.param(b"[" * 100_000, id="too-deep"),
        b"\xff\xfe\x00",
    ],
)
def test_a_file_that_is_not_one_of_the_formats_is_refused(content: bytes) -> None:
    with pytest.raises(ImportRefusedError) as raised:
        parse_file("bad.json" if not content.startswith(b"\xff") else "bad.md", content)

    assert raised.value.key == "errors.import.unreadable"


def test_a_newer_schema_version_is_refused() -> None:
    with pytest.raises(ImportRefusedError) as raised:
        _json({"schema_version": 2, "documents": [{"name": "A"}]})

    assert raised.value.key == "errors.import.unsupportedSchema"
    assert raised.value.params["version"] == 2


def test_a_file_with_no_document_is_refused() -> None:
    with pytest.raises(ImportRefusedError) as raised:
        _json({"documents": []})

    assert raised.value.key == "errors.import.noDocuments"


def test_the_format_is_found_by_extension_then_by_first_character() -> None:
    assert parse_file("a", b'{"documents": [{"name": "A"}]}').documents[0].name == "A"
    assert parse_file("a.txt", b"# Plain\ntext").documents[0].name == "Plain"
    assert (
        parse_file("a.json", b'\xef\xbb\xbf{"documents": [{"name": "B"}]}').documents[0].name == "B"
    )
    assert parse_file("b", b"# Headed").documents[0].name == "Headed"


# --- Markdown the app exported -------------------------------------------------

DOC_A = "11111111-1111-1111-1111-111111111111"
DOC_B = "22222222-2222-2222-2222-222222222222"
TAG_N = "33333333-3333-3333-3333-333333333333"
TAG_P = "44444444-4444-4444-4444-444444444444"

EXPORTED = f"""# Barovia

Ravenloft · Exported 2026-10-07

Links to images and files expire within 15 minutes of the export.

## Tags

- <a id="tag-{TAG_N}"></a>NPC (Type)
- <a id="tag-{TAG_P}"></a>Place, big \\[x\\]

## NPC

### <a id="doc-{DOC_A}"></a>Castle \\[Ravenloft\\]

- Visibility: private
- Tags: NPC, Place, big \\[x\\]
- Owners: Ireena
- Played by: Ireena

See [Lair](#doc-{DOC_B}) and [#NPC](#tag-{TAG_N}) and #Plain and @Ireena.

**Images**

- ![image](https://signed.test/a.webp?token=t)

**Files**

- [sheet.pdf](https://signed.test/f.pdf)

**Notes**

#### Rumor

Heard in [Lair](#doc-{DOC_B}).

#### Truth

Strahd lives.

**Comments**

- **Ireena** (2026-10-01): Hello
  - **Strahd** (2026-10-02): Reply
    - ![image](https://signed.test/c.webp)

### <a id="doc-{DOC_B}"></a>Lair

- Visibility: room

Dark.

## Other documents

- [Lair](#doc-{DOC_B})
"""


def test_the_apps_markdown_export_is_read() -> None:
    parsed = parse_file("room.md", EXPORTED.encode())

    castle, lair = parsed.documents
    assert castle.source_id == DOC_A
    assert castle.name == "Castle [Ravenloft]"
    assert castle.visibility == "private"
    assert castle.tag_names == ("NPC", "Place, big [x]")
    assert castle.text == (
        "See ",
        MentionRef(MentionKind.DOCUMENT, DOC_B, "Lair"),
        " and ",
        MentionRef(MentionKind.TAG, TAG_N, "NPC"),
        " and #Plain and @Ireena.",
    )
    assert [i.url for i in castle.images] == ["https://signed.test/a.webp?token=t"]
    assert [n.title for n in castle.notes] == ["Rumor", "Truth"]
    assert castle.notes[0].text == (
        "Heard in ",
        MentionRef(MentionKind.DOCUMENT, DOC_B, "Lair"),
        ".",
    )
    assert (castle.comment_count, castle.file_count, castle.has_player) == (2, 1, True)
    assert (lair.name, lair.visibility, lair.text) == ("Lair", "room", ("Dark.",))
    assert parsed.tags[TAG_N] == ImportTag("NPC", "Type")
    assert parsed.tags[TAG_P].name == "Place, big [x]"


def test_a_tag_name_that_holds_a_comma_is_told_apart_by_the_tags_list() -> None:
    parsed = parse_file(
        "r.md",
        (
            f'## Tags\n\n- <a id="tag-{TAG_N}"></a>Smith, John\n\n'
            f'### <a id="doc-{DOC_A}"></a>Doc\n\n- Visibility: room\n- Tags: Smith, John, Other\n'
        ).encode(),
    )

    assert parsed.documents[0].tag_names == ("Smith, John", "Other")


# --- Markdown written by hand ----------------------------------------------------


def test_a_hand_written_markdown_file_is_one_document_per_heading() -> None:
    parsed = parse_file(
        "notes.md",
        b"""Ignored preface

# Strahd
Tags: NPC,  Villain ,npc

A vampire. ## not a heading

![portrait](https://x.test/p.png)
## Secret
Hidden text
![another](https://x.test/q.png)
## Weakness
Sunlight

```
# not a document
Tags: no
```

# Barovia

Just a place.
""",
    )

    strahd, barovia = parsed.documents
    assert strahd.name == "Strahd"
    assert strahd.tag_names == ("NPC", "Villain")
    assert strahd.text == ("A vampire. ## not a heading",)
    assert [i.url for i in strahd.images] == ["https://x.test/p.png", "https://x.test/q.png"]
    assert [(n.title, n.text[0] if n.text else "") for n in strahd.notes] == [
        ("Secret", "Hidden text"),
        ("Weakness", "Sunlight\n\n```\n# not a document\nTags: no\n```"),
    ]
    assert (barovia.name, barovia.text) == ("Barovia", ("Just a place.",))
    assert barovia.tag_names == ()


def test_tags_are_only_read_on_the_first_line_under_the_heading() -> None:
    parsed = parse_file("n.md", b"# Doc\n\nText first\nTags: late\n")

    assert parsed.documents[0].tag_names == ()
    assert "Tags: late" in str(parsed.documents[0].text)


def test_a_markdown_without_a_document_heading_is_refused() -> None:
    with pytest.raises(ImportRefusedError):
        parse_file("n.md", b"just text\n## a note heading with no document\n")


def test_text_that_looks_like_a_token_stays_text() -> None:
    parsed = parse_file("n.md", f"# Doc\n#[Fake]( doc:{DOC_A}) <b>x</b>".encode())

    assert "<b>x</b>" in str(parsed.documents[0].text)


# --- The stored form -----------------------------------------------------------


def test_a_parsed_file_survives_the_job_payload() -> None:
    parsed = parse_file("room.md", EXPORTED.encode())

    assert file_from_json(json.loads(json.dumps(file_to_json(parsed)))) == parsed


# --- Limits ----------------------------------------------------------------------


def _files(*documents: ImportDocument) -> list[ImportFile]:
    return [ImportFile("f.json", tuple(documents))]


def test_the_limits_refuse_an_import_before_anything_is_written() -> None:
    def refused(files: list[ImportFile]) -> str:
        with pytest.raises(ImportRefusedError) as raised:
            validate_files(files)
        return raised.value.key

    assert refused([ImportFile("f", (_document(),))] * (MAX_FILES + 1)) == (
        "errors.import.tooManyFiles"
    )
    assert refused(_files(*[_document()] * (MAX_DOCUMENTS + 1))) == "errors.import.tooManyDocuments"
    images = tuple(_json_image(i) for i in range(MAX_IMAGES + 1))
    assert refused(_files(_document(images=images))) == "errors.import.tooManyImages"
    assert refused(_files(_document(name="  "))) == "errors.import.nameRequired"
    assert refused(_files(_document(name="x" * 201))) == "errors.import.nameTooLong"
    notes = tuple(ImportNote(f"n{i}", (), None) for i in range(51))
    assert refused(_files(_document(notes=notes))) == "errors.import.tooManyNotes"
    for title in ("", " ", "t" * 201):
        notes = (ImportNote(title, (), None),)
        assert refused(_files(_document(notes=notes))) == "errors.import.noteTitleInvalid"
    assert refused(_files(_document(tag_names=("t" * 101,)))) == "errors.import.tagNameTooLong"

    validate_files(_files(_document(notes=(ImportNote("t" * 200, (), None),))))


def _json_image(index: int) -> Any:
    from app.domain.import_files import ImportImage

    return ImportImage(None, f"https://x.test/{index}.png", False)


# --- Planning ---------------------------------------------------------------------


def test_everything_is_copied_under_fresh_ids_by_default() -> None:
    files = _files(
        _document("A", source_id=str(uuid.uuid4()), text=("one",)),
        _document("B", notes=(ImportNote("N", ("two",), None),)),
    )

    plan = plan_import(files, _context())

    assert [d.name for d in plan.documents] == ["A", "B"]
    assert [d.key for d in plan.documents] == ["0:0", "0:1"]
    assert all(not d.replaces and d.existing_id is None for d in plan.documents)
    assert plan.documents[1].notes[0].text == "two"
    assert plan.documents[0].id != plan.documents[1].id
    assert plan.documents[0].visibility is DocumentVisibility.ROOM


def test_a_document_of_the_file_that_still_exists_is_offered_for_replace() -> None:
    existing_id = uuid.uuid4()
    files = _files(_document("A", source_id=str(existing_id)), _document("B", source_id="nope"))
    context = _context(existing={existing_id: ExistingDocument(existing_id, True, frozenset())})

    plan = plan_import(files, context)

    first, second = plan.documents
    assert (first.existing_id, first.can_replace, first.replaces) == (existing_id, True, False)
    assert first.id != existing_id
    assert (second.existing_id, second.can_replace) == (None, False)


def test_a_replace_keeps_the_id_and_skips_the_images_the_document_still_has() -> None:
    from app.domain.import_files import ImportImage

    existing_id = uuid.uuid4()
    images = (
        ImportImage("old", "https://x.test/old.png", True),
        ImportImage("new", "https://x.test/new.png", False),
        ImportImage(None, "https://x.test/plain.png", False),
    )
    files = _files(_document("A", source_id=str(existing_id), images=images, visibility="master"))
    context = _context(
        existing={existing_id: ExistingDocument(existing_id, True, frozenset({"old"}))}
    )

    plan = plan_import(files, context, ImportChoices(replace=frozenset({"0:0"})))

    (document,) = plan.documents
    assert document.replaces and document.id == existing_id
    assert [i.url for i in document.images] == [
        "https://x.test/new.png",
        "https://x.test/plain.png",
    ]


def test_a_replace_of_a_document_the_importer_does_not_manage_is_refused() -> None:
    existing_id = uuid.uuid4()
    files = _files(_document("A", source_id=str(existing_id)))
    context = _context(existing={existing_id: ExistingDocument(existing_id, False, frozenset())})

    assert plan_import(files, context).documents[0].can_replace is False
    with pytest.raises(ImportCannotReplaceError):
        plan_import(files, context, ImportChoices(replace=frozenset({"0:0"})))


def test_a_replace_of_a_document_that_is_not_there_is_a_copy() -> None:
    files = _files(_document("A", source_id=str(uuid.uuid4())))

    plan = plan_import(files, _context(), ImportChoices(replace=frozenset({"0:0"})))

    assert plan.documents[0].replaces is False


def test_only_the_selected_documents_are_planned_and_none_is_refused() -> None:
    files = _files(_document("A"), _document("B"))

    plan = plan_import(files, _context(), ImportChoices(selected=frozenset({"0:1"})))
    assert [d.name for d in plan.documents] == ["B"]
    with pytest.raises(ImportRefusedError) as raised:
        plan_import(files, _context(), ImportChoices(selected=frozenset()))

    assert raised.value.key == "errors.import.nothingSelected"


def test_tags_are_matched_by_name_and_created_only_by_those_who_manage_tags() -> None:
    npc = uuid.uuid4()
    context = _context(room_tags={fold("NPC"): (npc, "NPC")})
    files = [
        ImportFile(
            "f",
            (_document("A", tag_names=("npc ", "Villain", "villain")),),
            {"t1": ImportTag("Villain", "Role")},
        )
    ]

    plan = plan_import(files, context)

    (created,) = plan.new_tags
    assert (created.name, created.category) == ("Villain", "Role")
    assert plan.documents[0].tag_ids == (npc, created.id)
    assert plan.matched_tags == ("NPC",)

    player = plan_import(files, _context(room_tags=context.room_tags, can_manage_tags=False))
    assert player.new_tags == ()
    assert player.documents[0].tag_ids == (npc,)
    assert player.unavailable_tags == ("Villain",)
    (warning,) = [w for w in player.documents[0].warnings if w.code == "tags_not_created"]
    assert warning.names == ("Villain",)


def test_visibility_is_kept_and_selective_becomes_private() -> None:
    files = _files(
        _document(
            "A",
            visibility="master",
            notes=(
                ImportNote("n1", (), "selective"),
                ImportNote("n2", (), "private"),
                ImportNote("n3", (), "weird"),
                ImportNote("n4", (), None),
            ),
        ),
        _document("B", visibility="Selective"),
        _document("C"),
    )

    plan = plan_import(files, _context(default_visibility=DocumentVisibility.MASTER))

    a, b, c = plan.documents
    assert a.visibility is DocumentVisibility.MASTER
    assert [n.visibility for n in a.notes] == [
        DocumentVisibility.PRIVATE,
        DocumentVisibility.PRIVATE,
        DocumentVisibility.MASTER,
        DocumentVisibility.MASTER,
    ]
    assert b.visibility is DocumentVisibility.PRIVATE
    assert c.visibility is DocumentVisibility.MASTER
    assert [(w.code, w.count) for w in a.warnings] == [("selective_to_private", 1)]
    assert [(w.code, w.count) for w in b.warnings] == [("selective_to_private", 1)]
    assert c.warnings == ()


def test_a_replaced_document_keeps_its_own_level_so_nothing_is_said_about_it() -> None:
    existing_id = uuid.uuid4()
    files = _files(_document("A", source_id=str(existing_id), visibility="selective"))
    context = _context(existing={existing_id: ExistingDocument(existing_id, True, frozenset())})

    plan = plan_import(files, context, ImportChoices(replace=frozenset({"0:0"})))

    assert plan.documents[0].warnings == ()


def test_what_the_import_leaves_out_is_reported_per_document() -> None:
    files = _files(_document("A", comment_count=3, file_count=2, has_player=True))

    (document,) = plan_import(files, _context()).documents

    assert [(w.code, w.count) for w in document.warnings] == [
        ("comments_dropped", 3),
        ("files_dropped", 2),
        ("player_dropped", 0),
    ]


def test_mentions_inside_the_file_are_repointed_and_the_rest_become_plain_text() -> None:
    a, b = "doc-a", "doc-b"
    tag = uuid.uuid4()
    context = _context(room_tags={fold("NPC"): (tag, "NPC")}, can_manage_tags=False)
    file = ImportFile(
        "f",
        (
            _document(
                "Castle",
                source_id=a,
                text=(
                    "See ",
                    MentionRef(MentionKind.DOCUMENT, b, "Old Lair name"),
                    ", ",
                    MentionRef(MentionKind.DOCUMENT, "outside", "Gone"),
                    ", ",
                    MentionRef(MentionKind.TAG, "t1", "x"),
                    ", ",
                    MentionRef(MentionKind.TAG, "t2", "Missing"),
                    " and ",
                    MentionRef(MentionKind.USER, "u", "Ireena"),
                    f" #[Forged](doc:{uuid.uuid4()})",
                ),
            ),
            _document(
                "Lair",
                source_id=b,
                notes=(ImportNote("N", (MentionRef(MentionKind.DOCUMENT, a, "Castle"),), None),),
            ),
        ),
        {"t1": ImportTag("NPC", None)},
    )

    castle, lair = plan_import([file], context).documents

    mentions = find_mentions(castle.text)
    assert [(m.kind, m.target_id, m.name) for m in mentions] == [
        (MentionKind.DOCUMENT, lair.id, "Lair"),
        (MentionKind.TAG, tag, "NPC"),
    ]
    assert "#Gone" in castle.text
    assert "#Missing" in castle.text
    assert "@Ireena" in castle.text
    assert "#Forged" in castle.text and "Forged](doc:" not in castle.text
    (back,) = find_mentions(lair.notes[0].text)
    assert (back.target_id, back.name) == (castle.id, "Castle")


def test_a_mention_of_a_document_that_was_not_selected_or_is_in_another_file_is_plain() -> None:
    files = [
        ImportFile(
            "one",
            (
                _document("A", source_id="a", text=(MentionRef(MentionKind.DOCUMENT, "b", "B"),)),
                _document("B", source_id="b"),
            ),
        ),
        ImportFile(
            "two",
            (_document("C", source_id="c", text=(MentionRef(MentionKind.DOCUMENT, "b", "B"),)),),
        ),
    ]

    plan = plan_import(files, _context(), ImportChoices(selected=frozenset({"0:0", "1:0"})))

    assert [d.text for d in plan.documents] == ["#B", "#B"]


def test_a_tag_mentioned_in_the_file_and_created_for_another_document_is_linked() -> None:
    files = [
        ImportFile(
            "f",
            (
                _document("A", text=(MentionRef(MentionKind.TAG, "t", "Villain"),)),
                _document("B", tag_names=("Villain",)),
            ),
            {"t": ImportTag("Villain", None)},
        )
    ]

    plan = plan_import(files, _context())

    (mention,) = find_mentions(plan.documents[0].text)
    assert mention.target_id == plan.new_tags[0].id


def test_the_favorite_image_is_stored_first() -> None:
    from app.domain.import_files import ImportImage

    images = (
        ImportImage(None, "https://x.test/1.png", False),
        ImportImage(None, "https://x.test/2.png", True),
    )

    (document,) = plan_import(_files(_document(images=images)), _context()).documents

    assert [i.url[-5:] for i in document.images] == ["2.png", "1.png"]


def test_document_key_and_fold() -> None:
    assert document_key(2, 5) == "2:5"
    assert fold("  NpC ") == "npc"
    assert isinstance(ImportRefusedError("k"), DomainError)

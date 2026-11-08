"""Spec 65: the Obsidian reader and how the planner places its notes."""

import uuid
from typing import Any

import pytest

from app.domain.import_files import ImportFile, ImportRefusedError, MentionRef
from app.domain.import_obsidian import (
    is_hidden,
    is_obsidian,
    parse_notes,
    parse_uploads,
)
from app.domain.imports import ExistingDocument, ImportChoices, ImportContext, plan_import
from app.domain.mentions import MentionKind
from app.domain.models import DocumentVisibility


def _context(**fields: Any) -> ImportContext:
    base: dict[str, Any] = {
        "default_visibility": DocumentVisibility.ROOM,
        "existing": {},
        "room_tags": {},
        "can_manage_tags": True,
    }
    return ImportContext(**{**base, **fields})


JASON = """![[jasonbright_new 1.jpg]]
# Status e Affiliazione
Primogenito di Praga
[[Società dei Mostri]]

# Alleati
[[Nadezda Jakovlevna]] - Primogenito Toreador
[[Thomas Procházka]] - Proprietario del [[Lavasecco Piotr]]
"""


def _notes(*pairs: tuple[str, str]) -> ImportFile:
    return parse_notes([(path, text.encode()) for path, text in pairs])


def test_one_file_is_one_document_with_its_headings_inside() -> None:
    file = _notes(("Jason Bright 1.md", JASON))
    assert len(file.documents) == 1
    document = file.documents[0]
    assert document.name == "Jason Bright 1"
    text = "".join(p if isinstance(p, str) else f"<{p.name}>" for p in document.text)
    assert "# Status e Affiliazione" in text and "# Alleati" in text
    assert "<Società dei Mostri>" in text
    assert "jasonbright" not in text
    assert document.dropped_embeds == 1
    assert document.match_by_name


def test_wikilinks_between_notes_resolve_by_name_alias_and_heading() -> None:
    file = _notes(
        ("A.md", "See [[b]], [[Bee|the bee]], [[B#Section]] and [[B^abc]], [[#Local]]"),
        ("B.md", "---\naliases: [Bee]\n---\nbody"),
    )
    a, b = file.documents
    mentions = [p for p in a.text if isinstance(p, MentionRef)]
    assert {m.key for m in mentions} == {b.source_id}
    assert [m.name for m in mentions] == ["b", "the bee", "B", "B"]
    assert all(m.kind is MentionKind.DOCUMENT for m in mentions)
    assert "Local" in "".join(p for p in a.text if isinstance(p, str))


def test_front_matter_tags_aliases_and_inline_tags() -> None:
    file = _notes(
        (
            "Characters/Vampires/Jason.md",
            "---\ntags:\n  - npc\n  - '#clan/nosferatu'\naliases:\n  - J\ncolor: red\n---\n"
            "# Heading\nA #prague trip, `#code`, issue #12, https://x.org/#frag\n"
            "```\n#fenced\n```\n",
        ),
        ("Other.md", "---\ntags: a, b\n---\n"),
        ("Plain.md", "---\ntags: [x, y]\n---\n"),
    )
    jason = file.documents[0]
    assert jason.name == "Jason"
    assert jason.tag_names == ("npc", "nosferatu", "prague", "Vampires")
    assert file.documents[1].tag_names == ("a", "b")  # "Other.md", folder-less
    assert file.documents[2].tag_names == ("x", "y")


def test_folders_as_tags_can_be_switched_off() -> None:
    file = parse_notes([("F/N.md", b"hi")], folders_as_tags=False)
    assert file.documents[0].tag_names == ()


def test_obsidian_syntax_is_cleaned() -> None:
    file = _notes(
        (
            "N.md",
            "A %%secret%% b ==marked== c ^blk\n%%\nmulti\n%%\n> [!note] Title\n> body\n"
            "> [!warning]\n`==raw==`\n![pic](images/x.png) ![web](https://x.org/y.png)\n"
            "![[doc.pdf]] ![[Other note]]\n",
        )
    )
    document = file.documents[0]
    text = "".join(p if isinstance(p, str) else f"<{p.name}>" for p in document.text)
    assert "secret" not in text and "multi" not in text and "^blk" not in text
    assert "marked" in text and "==" in text  # only the inline code keeps its signs
    assert "> Title" in text and "> Warning" in text and "[!" not in text
    assert "images/x.png" not in text and "https://x.org/y.png" in text
    assert "<Other note>" in text
    assert document.dropped_embeds == 2


def test_hidden_folders_and_other_files_are_skipped_and_bad_utf8_refused() -> None:
    file = parse_notes(
        [(".obsidian/x.md", b"x"), (".trash/y.md", b"y"), ("pic.png", b"\x89"), ("Z.md", b"z")]
    )
    assert [d.name for d in file.documents] == ["Z"]
    with pytest.raises(ImportRefusedError):
        parse_notes([("Bad.md", b"\xff\xfe\x00")])
    assert is_hidden("a/.hidden/b.md") and not is_hidden("a/b.md")


def test_same_name_twice_gets_two_keys_and_links_go_to_the_first_path() -> None:
    file = _notes(("a/N.md", "1"), ("b/N.md", "2"), ("c/L.md", "see [[N]] and [[b/N]]"))
    first, second, link = file.documents
    assert first.source_id != second.source_id
    refs = [p for p in link.text if isinstance(p, MentionRef)]
    # A path in a link is reduced to the note name; the first path in order wins.
    assert [r.key for r in refs] == [first.source_id, first.source_id]


def test_detection() -> None:
    assert is_obsidian("---\ntags: a\n---\nhi") and is_obsidian("see [[x]]")
    assert is_obsidian("> [!note] t") and is_obsidian("a %%c%% b")
    assert not is_obsidian("# plain\ntext") and not is_obsidian('[[x]] <a id="doc-1">')


def test_parse_uploads_routes_files() -> None:
    plain = b"# Hand\ntext"
    files = parse_uploads(
        [("a.md", b"see [[b]]"), ("hand.md", plain), ("b.md", b"---\ntags: t\n---\n")]
    )
    assert [f.name for f in files] == ["vault", "hand.md"]
    assert [d.name for d in files[0].documents] == ["a", "b"]
    forced = parse_uploads([("hand.md", plain)], obsidian=True)
    assert forced[0].name == "vault" and forced[0].documents[0].name == "hand"
    off = parse_uploads([("a.md", b"# A\nsee [[b]]")], obsidian=False)
    assert off[0].name == "a.md"
    with pytest.raises(ImportRefusedError):
        parse_uploads([("bad.md", b"\xff\xfe\x00")])
    with pytest.raises(ImportRefusedError):
        parse_uploads([(".obsidian/x.md", b"[[x]]")])


# --- Planning ----------------------------------------------------------------------


def _existing(name: str, manage: bool = True) -> tuple[uuid.UUID, ExistingDocument]:
    doc_id = uuid.uuid4()
    return doc_id, ExistingDocument(doc_id, manage, frozenset(), name)


def _plan(file: ImportFile, **context: Any) -> Any:
    return plan_import([file], _context(**context), None)


def test_links_inside_the_import_become_mention_tokens() -> None:
    plan = _plan(_notes(("A.md", "see [[B]] and [[Nobody]]"), ("B.md", "x")))
    a, b = plan.documents
    assert f"(doc:{b.id})" in a.text
    assert "#Nobody" in a.text


def test_link_to_a_document_already_in_the_room_when_visible() -> None:
    doc_id, existing = _existing("Society")
    plan = _plan(_notes(("A.md", "see [[society|us]]")), existing={doc_id: existing})
    assert f"(doc:{doc_id})" in plan.documents[0].text
    # Not visible to the importer: plain text, no trace of the hidden Document.
    hidden = _plan(_notes(("A.md", "see [[Hidden Doc]]")))
    assert "#Hidden Doc" in hidden.documents[0].text
    assert "doc:" not in hidden.documents[0].text


def test_replace_by_name_only_among_visible_documents() -> None:
    doc_id, existing = _existing("Jason")
    file = _notes(("Jason.md", "new"))
    preview = _plan(file, existing={doc_id: existing})
    assert preview.documents[0].existing_id == doc_id and preview.documents[0].can_replace
    key = preview.documents[0].key
    replaced = plan_import(
        [file],
        _context(existing={doc_id: existing}),
        ImportChoices(frozenset({key}), frozenset({key})),
    )
    assert replaced.documents[0].id == doc_id and replaced.documents[0].replaces
    # A Document the importer can't see is not in the context: a plain copy.
    hidden = _plan(file)
    assert hidden.documents[0].existing_id is None and not hidden.documents[0].replaces
    # Several Documents of that name: the same one every time.
    other_id, other = _existing("jason")
    twice = _plan(file, existing={doc_id: existing, other_id: other})
    assert twice.documents[0].existing_id == min(doc_id, other_id, key=str)


def test_dropped_embeds_are_warned_about() -> None:
    plan = _plan(_notes(("A.md", "![[a.png]]")))
    assert [(w.code, w.count) for w in plan.documents[0].warnings] == [("embeds_dropped", 1)]


def test_a_note_survives_the_job_payload() -> None:
    from app.domain.import_files import file_from_json, file_to_json

    file = _notes(("A.md", "![[a.png]] [[B]]"), ("B.md", "x"))
    back = file_from_json(file_to_json(file))
    assert back.documents == file.documents
    assert back.documents[0].dropped_embeds == 1 and back.documents[0].match_by_name

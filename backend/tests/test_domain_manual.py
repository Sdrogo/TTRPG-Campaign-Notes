"""The Room PDF's layout (spec 23b Decisions 1 to 3): chapters, repeats,
mention links, the glossary, Comments and what never reaches a page."""

import uuid
from dataclasses import replace
from typing import Any

from manual_fixtures import (
    ALICE,
    BOB,
    CASTLE,
    EMPTY_TAG,
    GONE,
    IRENA,
    LABELS,
    MARA,
    NPC,
    T0,
    comment,
    document,
    image,
    make_export,
    mention,
    text,
    uid,
)

from app.domain.export import DocumentSource, ExportInput, build_export
from app.domain.manual import (
    Manual,
    ManualDocument,
    ManualOptions,
    ManualReference,
    Run,
    build_manual,
)
from app.domain.mentions import MentionKind
from app.domain.models import (
    Comment,
    Document,
    DocumentVisibility,
    Membership,
    Note,
    Room,
    RoomRole,
    RoomStatus,
    Tag,
    UserProfile,
)


def _manual(options: ManualOptions | None = None, **overrides: Any) -> Manual:
    return build_manual(make_export(**overrides), options or ManualOptions(), LABELS)


def _documents(manual: Manual) -> dict[str, ManualDocument]:
    return {
        entry.name: entry
        for chapter in manual.chapters
        for entry in chapter.entries
        if isinstance(entry, ManualDocument)
    }


def test_one_chapter_per_main_item_then_other_and_a_repeat_is_a_reference() -> None:
    manual = _manual()

    assert [c.title for c in manual.chapters] == ["NPC", "Place", "Other"]
    assert [c.id for c in manual.chapters] == ["chapter-1", "chapter-2", "chapter-3"]
    npc, place, other = manual.chapters
    assert [(type(e).__name__, e.name) for e in npc.entries] == [
        ("ManualDocument", "Castle"),
        ("ManualDocument", "Irena"),
    ]
    # Castle carries both Tags: printed in the first chapter, referenced in the second.
    assert [(type(e).__name__, e.name) for e in place.entries] == [("ManualReference", "Castle")]
    assert place.entries[0].anchor == f"doc-{CASTLE}"
    assert [e.name for e in other.entries] == ["Orphan"]
    # The contents list only what is printed.
    assert place.documents == []


def test_without_main_items_the_one_chapter_is_called_documents() -> None:
    manual = _manual(main_items=[])

    assert [(c.title, [e.name for e in c.entries]) for c in manual.chapters] == [
        ("Documents", ["Castle", "Irena", "Orphan"])
    ]


def test_a_combination_is_titled_by_its_tags_and_empty_chapters_are_dropped() -> None:
    manual = _manual(main_items=[(NPC, uid(21)), (EMPTY_TAG,), (NPC,)])

    assert [c.title for c in manual.chapters] == ["NPC + Place", "NPC", "Other"]
    assert [e.name for e in manual.chapters[0].entries] == ["Castle"]
    # Irena's first chapter is the plain NPC one; Castle is referenced there.
    assert [type(e) for e in manual.chapters[1].entries] == [ManualReference, ManualDocument]


def test_a_mention_links_only_to_a_printed_document() -> None:
    castle = _documents(_manual())["Castle"]

    first, second = castle.paragraphs
    assert list(first) == [Run("Ruled by "), Run("Irena", f"doc-{IRENA}"), Run(".")]
    # "Gone" is not in the PDF (a Tag filter left it out) and a Tag has no
    # page of its own: plain `#Name`.
    assert list(second) == [
        Run("Second paragraph, near "),
        Run("#Gone"),
        Run(", for "),
        Run("#NPC"),
        Run(" and "),
        Run("@Alice"),
        Run("."),
    ]


def test_descriptions_split_at_blank_lines_and_keep_single_breaks() -> None:
    export = make_export(
        documents=[
            document(
                CASTLE,
                "Castle",
                description=(
                    text("  One\nstill one\n \n\n\nTwo "),
                    mention(MentionKind.USER, BOB, "Bob"),
                ),
            ),
            document(IRENA, "Irena", description=(text("\n\n  \n"),)),
        ]
    )
    manual = build_manual(export, ManualOptions(), LABELS)

    documents = _documents(manual)
    assert [list(p) for p in documents["Castle"].paragraphs] == [
        [Run("One\nstill one")],
        [Run("Two "), Run("@Bob")],
    ]
    assert documents["Irena"].paragraphs == []


def test_notes_become_sidebars_in_order() -> None:
    castle = _documents(_manual())["Castle"]

    (sidebar,) = castle.notes
    assert sidebar.title == "Read aloud"
    assert [list(p) for p in sidebar.paragraphs] == [[Run("The gates creak.")]]


def test_the_glossary_lists_each_printed_document_once_by_letter_with_its_tags() -> None:
    manual = _manual()

    # Castle is in two chapters but has one entry; Gone isn't printed.
    assert [
        (group.letter, [(e.name, list(e.tags)) for e in group.entries]) for group in manual.glossary
    ] == [
        ("C", [("Castle", ["NPC", "Place"])]),
        ("I", [("Irena", ["NPC"])]),
        ("O", [("Orphan", [])]),
    ]
    assert manual.glossary[0].entries[0].anchor == f"doc-{CASTLE}"


def test_the_glossary_ignores_accents_and_case_and_puts_other_names_first() -> None:
    names = ["élise", "Zed", "Elba", "3 Ravens", "eagle", "«Odd»"]
    documents = [document(uid(40 + i), name) for i, name in enumerate(names)]
    manual = _manual(documents=documents, main_items=[])

    assert [(g.letter, [e.name for e in g.entries]) for g in manual.glossary] == [
        ("#", ["3 Ravens", "«Odd»"]),
        ("E", ["eagle", "Elba", "élise"]),
        ("Z", ["Zed"]),
    ]


def test_no_documents_means_no_glossary() -> None:
    assert _manual(documents=[]).glossary == []


def test_a_document_shows_its_favorite_image_else_its_first() -> None:
    documents = _documents(_manual())
    assert documents["Castle"].image_url == image(2).url
    assert documents["Irena"].image_url is None

    export = make_export(documents=[document(CASTLE, "Castle", images=(image(5), image(6)))])
    built = build_manual(export, ManualOptions(), LABELS)
    assert _documents(built)["Castle"].image_url == image(5).url


def test_the_cover_uses_the_chosen_documents_image_or_none() -> None:
    export = make_export()
    chosen = build_manual(export, ManualOptions(cover_document_id=CASTLE), LABELS)
    assert chosen.cover_image_url == image(2).url
    assert chosen.image_urls == {image(2).url}

    assert build_manual(export, ManualOptions(), LABELS).cover_image_url is None
    # No image on it, or not in the PDF at all (hidden or filtered out): none.
    for other in (IRENA, GONE):
        built = build_manual(export, ManualOptions(cover_document_id=other), LABELS)
        assert built.cover_image_url is None


def test_the_room_image_is_the_cover_unless_a_document_gives_one() -> None:
    # Spec 26 Decision 5.
    export = make_export()
    room_image = "https://signed.test/rooms/cover.webp"

    by_default = build_manual(export, ManualOptions(room_cover_url=room_image), LABELS)
    assert by_default.cover_image_url == room_image
    assert room_image in by_default.image_urls

    chosen = build_manual(
        export, ManualOptions(cover_document_id=CASTLE, room_cover_url=room_image), LABELS
    )
    assert chosen.cover_image_url == image(2).url
    # A cover Document that gives no image falls back to the Room's.
    for other in (IRENA, GONE):
        built = build_manual(
            export, ManualOptions(cover_document_id=other, room_cover_url=room_image), LABELS
        )
        assert built.cover_image_url == room_image


def test_the_cover_reads_the_room_and_the_day() -> None:
    manual = _manual()

    assert (manual.title, manual.game_system, manual.generated_on) == (
        "Barovia",
        "D&D 5e",
        T0.date(),
    )
    assert manual.labels is LABELS


def test_comments_are_left_out_unless_asked() -> None:
    export = make_export(
        documents=[
            document(CASTLE, "Castle", comments=(comment(1, ALICE, "Hi", as_character=IRENA),)),
            document(IRENA, "Irena"),
        ]
    )

    assert _documents(build_manual(export, ManualOptions(), LABELS))["Castle"].comments == []
    asked = build_manual(export, ManualOptions(include_comments=True), LABELS)
    assert [c.author for c in _documents(asked)["Castle"].comments] == ["Irena (played by Alice)"]


def test_only_comments_written_as_a_character_are_printed_depth_first() -> None:
    """Product owner, 2026-10-06: a Comment written as oneself and a deleted
    one stay out of the PDF; a printed reply to one of them takes its place."""
    comments = (
        comment(1, ALICE, "Top", as_character=IRENA),
        comment(2, BOB, "Out of character"),
        comment(3, MARA, "Reply", parent=1, as_character=IRENA),
        comment(4, uid(77), "Deep", parent=3, as_character=IRENA),
        comment(5, ALICE, "", parent=1, deleted=True, as_character=IRENA),
        comment(6, ALICE, "Under a deleted one", parent=5, as_character=IRENA),
        comment(7, BOB, "Answering the player", parent=2, as_character=IRENA),
        comment(8, BOB, "Not visible", as_character=uid(78)),
    )
    export = make_export(
        documents=[document(CASTLE, "Castle", comments=comments), document(IRENA, "Irena")]
    )
    manual = build_manual(export, ManualOptions(include_comments=True), LABELS)

    thread = _documents(manual)["Castle"].comments
    assert [(c.depth, c.author, c.paragraphs[0][0].text) for c in thread] == [
        (0, "Irena (played by Alice)", "Top"),
        (1, "Irena (played by Mara)", "Reply"),
        (2, "Irena (played by Unknown member)", "Deep"),
        (1, "Irena (played by Alice)", "Under a deleted one"),
        (0, "Irena (played by Unknown member)", "Answering the player"),
    ]
    assert [list(p) for p in thread[0].paragraphs] == [[Run("Top")]]
    assert thread[0].written_on == T0.date()


def test_a_description_opening_with_a_tag_or_member_mention_has_no_drop_cap() -> None:
    """The large initial would take the sigil and the letter after it."""
    opening = {
        "Tag": (mention(MentionKind.TAG, NPC, "Ghoul"), text(" di Irena")),
        "User": (mention(MentionKind.USER, ALICE, "Alice"), text(" knows")),
        "Link": (mention(MentionKind.DOCUMENT, IRENA, "Irena"), text(" rules")),
        "Plain": (text("  A vampire."),),
        "Empty": (),
    }
    export = make_export(
        documents=[
            document(uid(50 + n), name, description=spans)
            for n, (name, spans) in enumerate(opening.items())
        ]
        + [document(IRENA, "Irena")]
    )
    documents = _documents(build_manual(export, ManualOptions(), LABELS))

    assert {name: documents[name].drop_cap for name in opening} == {
        "Tag": False,
        "User": False,
        "Link": True,
        "Plain": True,
        "Empty": False,
    }


def _all_text(manual: Manual) -> str:
    """Every string a page of `manual` would print."""
    parts: list[str] = [manual.title, manual.game_system or ""]
    for chapter in manual.chapters:
        parts.append(chapter.title)
        for entry in chapter.entries:
            parts.append(entry.name)
            if isinstance(entry, ManualDocument):
                paragraphs = list(entry.paragraphs)
                for sidebar in entry.notes:
                    parts.append(sidebar.title)
                    paragraphs += list(sidebar.paragraphs)
                for c in entry.comments:
                    parts.append(c.author)
                    paragraphs += list(c.paragraphs)
                parts += [run.text for paragraph in paragraphs for run in paragraph]
    for group in manual.glossary:
        for glossary_entry in group.entries:
            parts += [glossary_entry.name, *glossary_entry.tags]
    return "\n".join(parts)


def test_nothing_hidden_from_the_requester_reaches_the_manual() -> None:
    """Through `build_export`, the way the job will call it (VR-03, VR-07,
    NFR-01): a Player's manual holds no Master-only Note or Comment, and a
    mention of a Document they can't see stays plain text."""
    room = Room(
        id=uid(1), name="Barovia", game_system="D&D 5e", status=RoomStatus.ACTIVE, created_by=MARA
    )

    def member(user: uuid.UUID, role: RoomRole, name: str) -> tuple[Membership, UserProfile]:
        return (
            Membership(id=uuid.uuid4(), room_id=room.id, user_id=user, role=role, is_admin=False),
            UserProfile(user_id=user, display_name=name, email="x@example.com"),
        )

    members = [member(MARA, RoomRole.MASTER, "Mara"), member(ALICE, RoomRole.PLAYER, "Alice")]

    def castle_note(n: int, title: str, visibility: DocumentVisibility, body: str) -> Note:
        return Note(
            id=uid(100 + n),
            document_id=CASTLE,
            title=title,
            description=body,
            visibility=visibility,
            position=n,
            created_by=MARA,
            created_at=T0,
            updated_at=T0,
        )

    def castle_comment(n: int, body: str, visibility: DocumentVisibility) -> Comment:
        return Comment(
            id=uid(200 + n),
            document_id=CASTLE,
            author_id=MARA,
            body=body,
            visibility=visibility,
            created_at=T0,
            updated_at=T0,
            deleted_at=None,
            parent_id=None,
            as_document_id=CASTLE,
        )

    source = ExportInput(
        room=room,
        viewer=members[1][0],
        members=members,
        tags=[Tag(NPC, room.id, "NPC", None, 0)],
        main_items=[(NPC,)],
        documents=[
            DocumentSource(
                document=Document(
                    id=CASTLE,
                    room_id=room.id,
                    name="Castle",
                    description=f"Beware #[Vault](doc:{GONE})",
                    visibility=DocumentVisibility.ROOM,
                    created_by=MARA,
                ),
                owner_ids=[],
                selective_ids=[],
                tag_ids=[NPC],
                images=[],
                files=[],
                notes=[
                    castle_note(1, "Public note", DocumentVisibility.ROOM, "Seen by all"),
                    castle_note(2, "Master note", DocumentVisibility.MASTER, "TOP SECRET NOTE"),
                ],
                note_grants={},
                comments=[
                    castle_comment(1, "Seen comment", DocumentVisibility.ROOM),
                    castle_comment(2, "TOP SECRET COMMENT", DocumentVisibility.MASTER),
                ],
                comment_grants={},
            )
        ],
        # The Vault exists, but the requester doesn't see it: it isn't listed.
        visible_documents={CASTLE: "Castle"},
        image_urls={},
        file_urls={},
        tag_filter=[],
        generated_at=T0,
        link_ttl_seconds=3600,
    )
    options = ManualOptions(include_comments=True)

    printed = _all_text(build_manual(build_export(source), options, LABELS))
    assert "Seen by all" in printed and "Seen comment" in printed
    assert "TOP SECRET" not in printed
    assert "Master note" not in printed
    assert "#Vault" in printed

    # The Master's own manual does have them: the filter is the viewer's, not the text's.
    as_master = _all_text(
        build_manual(build_export(replace(source, viewer=members[0][0])), options, LABELS)
    )
    assert "TOP SECRET NOTE" in as_master
    assert "TOP SECRET COMMENT" in as_master

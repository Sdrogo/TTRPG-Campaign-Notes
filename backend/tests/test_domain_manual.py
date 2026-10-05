"""The Room PDF's layout (spec 23b Decisions 1 to 3): chapters, repeats,
mention links, the index, Comments and what never reaches a page."""

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
    ORPHAN,
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


def test_a_mention_links_only_to_what_the_pdf_holds() -> None:
    castle = _documents(_manual())["Castle"]

    first, second = castle.paragraphs
    assert list(first) == [Run("Ruled by "), Run("Irena", f"doc-{IRENA}"), Run(".")]
    # "Gone" is not in the PDF (a Tag filter left it out): plain `#Name`.
    assert list(second) == [
        Run("Second paragraph, near "),
        Run("#Gone"),
        Run(", for "),
        Run("NPC", f"tag-{NPC}"),
        Run(" and "),
        Run("@Alice"),
        Run("."),
    ]


def test_a_tag_without_an_index_entry_stays_plain_text() -> None:
    manual = _manual(
        documents=[
            document(
                CASTLE,
                "Castle",
                (),
                description=(
                    mention(MentionKind.TAG, NPC, "NPC"),
                    mention(MentionKind.TAG, uid(99), "?"),
                ),
            )
        ]
    )

    assert list(_documents(manual)["Castle"].paragraphs[0]) == [Run("#NPC"), Run("#?")]


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


def test_the_index_lists_tags_with_printed_documents_in_name_order() -> None:
    manual = _manual()

    # EMPTY_TAG has no Document, so no entry; entries are by Tag name.
    assert [(e.name, [d.name for d in e.documents]) for e in manual.index] == [
        ("NPC", ["Castle", "Irena"]),
        ("Place", ["Castle"]),
    ]
    assert manual.index[0].anchor == f"tag-{NPC}"
    assert manual.index[0].documents[0].id == CASTLE


def test_no_tags_in_use_means_no_index() -> None:
    assert _manual(documents=[document(ORPHAN, "Orphan")]).index == []


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
        documents=[document(CASTLE, "Castle", comments=(comment(1, ALICE, "Hi"),))]
    )

    assert _documents(build_manual(export, ManualOptions(), LABELS))["Castle"].comments == []
    asked = build_manual(export, ManualOptions(include_comments=True), LABELS)
    assert [c.author for c in _documents(asked)["Castle"].comments] == ["Alice"]


def test_comments_nest_depth_first_and_name_characters_and_unknown_members() -> None:
    comments = (
        comment(1, ALICE, "Top"),
        comment(2, BOB, "Other top", as_character=IRENA),
        comment(3, MARA, "Reply", parent=1),
        comment(4, uid(77), "Deep", parent=3),
        comment(5, ALICE, "", parent=1, deleted=True),
    )
    export = make_export(
        documents=[document(CASTLE, "Castle", comments=comments), document(IRENA, "Irena")]
    )
    manual = build_manual(export, ManualOptions(include_comments=True), LABELS)

    thread = _documents(manual)["Castle"].comments
    assert [(c.depth, c.author) for c in thread] == [
        (0, "Alice"),
        (1, "Mara"),
        (2, "Unknown member"),
        (1, "Alice"),
        (0, "Irena (played by Unknown member)"),
    ]
    assert [c.deleted for c in thread] == [False, False, False, True, False]
    assert thread[3].paragraphs == []
    assert [list(p) for p in thread[0].paragraphs] == [[Run("Top")]]
    assert thread[0].written_on == T0.date()


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
    for tag_entry in manual.index:
        parts += [tag_entry.name, *(d.name for d in tag_entry.documents)]
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
            as_document_id=None,
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

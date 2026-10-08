"""The Room export (spec 23, FR-G1): what lands in the tree for one viewer,
mentions as spans, and the two serializations of it."""

import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any

from app.domain.export import (
    SCHEMA_VERSION,
    UNKNOWN_MEMBER,
    DocumentSource,
    Export,
    ExportFormat,
    ExportInput,
    MentionDirectory,
    MentionSpan,
    TextSpan,
    build_export,
    document_export_filename,
    export_filename,
    render_json,
    render_markdown,
    restrict_to_document,
    text_spans,
)
from app.domain.mentions import MentionKind, mention_token
from app.domain.models import (
    Comment,
    Document,
    DocumentFile,
    DocumentImage,
    DocumentVisibility,
    Membership,
    Note,
    Room,
    RoomRole,
    RoomStatus,
    Tag,
    UserProfile,
)


def _id(n: int) -> uuid.UUID:
    return uuid.UUID(int=n)


T0 = datetime(2026, 10, 2, 12, 0, tzinfo=UTC)
ROOM_ID = _id(1)
MASTER, ALICE, BOB, CARA = _id(10), _id(11), _id(12), _id(13)
NPC, PLACE, PC = _id(20), _id(21), _id(22)
CASTLE, IRENA, SECRET = _id(30), _id(31), _id(32)

ROOM = Room(
    id=ROOM_ID,
    name="Barovia",
    game_system="D&D 5e",
    status=RoomStatus.ACTIVE,
    created_by=MASTER,
)


def _member(user_id: uuid.UUID, role: RoomRole, name: str | None) -> tuple[Membership, UserProfile]:
    return (
        Membership(id=uuid.uuid4(), room_id=ROOM_ID, user_id=user_id, role=role, is_admin=False),
        UserProfile(user_id=user_id, display_name=name, email="secret@example.com"),
    )


MEMBERS = [
    _member(MASTER, RoomRole.MASTER, "Mara"),
    _member(ALICE, RoomRole.PLAYER, "Alice"),
    _member(BOB, RoomRole.PLAYER, None),
    _member(CARA, RoomRole.PLAYER, "Cara"),
]
TAGS = [Tag(NPC, ROOM_ID, "NPC", "Type", 0), Tag(PLACE, ROOM_ID, "Place", None, 1)]


def _viewer(user_id: uuid.UUID) -> Membership:
    return next(m for m, _ in MEMBERS if m.user_id == user_id)


def _document(
    doc_id: uuid.UUID,
    name: str,
    description: str = "",
    visibility: DocumentVisibility = DocumentVisibility.ROOM,
    played_by: uuid.UUID | None = None,
) -> Document:
    return Document(
        id=doc_id,
        room_id=ROOM_ID,
        name=name,
        description=description,
        visibility=visibility,
        created_by=MASTER,
        played_by=played_by,
    )


def _note(note_id: int, title: str, visibility: DocumentVisibility, description: str = "") -> Note:
    return Note(
        id=_id(note_id),
        document_id=CASTLE,
        title=title,
        description=description,
        visibility=visibility,
        position=note_id,
        created_by=MASTER,
        created_at=T0,
        updated_at=T0,
    )


def _comment(
    comment_id: int,
    author: uuid.UUID,
    body: str,
    visibility: DocumentVisibility = DocumentVisibility.ROOM,
    parent: int | None = None,
    deleted: bool = False,
    as_document: uuid.UUID | None = None,
) -> Comment:
    return Comment(
        id=_id(comment_id),
        document_id=CASTLE,
        author_id=author,
        body="" if deleted else body,
        visibility=visibility,
        created_at=T0 + timedelta(minutes=comment_id),
        updated_at=T0 + timedelta(minutes=comment_id),
        deleted_at=T0 if deleted else None,
        parent_id=None if parent is None else _id(parent),
        as_document_id=as_document,
    )


def _image(image_id: int, post: int | None = None, favorite: bool = False) -> DocumentImage:
    return DocumentImage(
        id=_id(image_id),
        document_id=CASTLE,
        storage_path=f"img/{image_id}.webp",
        created_by=MASTER,
        post_id=None if post is None else _id(post),
        is_favorite=favorite,
    )


def _file(file_id: int) -> DocumentFile:
    return DocumentFile(
        id=_id(file_id),
        document_id=CASTLE,
        storage_path=f"files/{file_id}.pdf",
        display_name="Sheet.pdf",
        size_bytes=1234,
        content_type="application/pdf",
        uploaded_by=MASTER,
        created_at=T0,
    )


def _castle(**overrides: Any) -> DocumentSource:
    fields: dict[str, Any] = {
        "document": _document(CASTLE, "Castle"),
        "owner_ids": [ALICE],
        "selective_ids": [BOB],
        "tag_ids": [PLACE, NPC],
        "images": [],
        "files": [],
        "notes": [],
        "note_grants": {},
        "comments": [],
        "comment_grants": {},
    }
    fields.update(overrides)
    return DocumentSource(**fields)


def _source(viewer: uuid.UUID, documents: list[DocumentSource], **overrides: Any) -> ExportInput:
    fields: dict[str, Any] = {
        "room": ROOM,
        "viewer": _viewer(viewer),
        "members": MEMBERS,
        "tags": TAGS,
        "main_items": [(NPC,), (PLACE,)],
        "documents": documents,
        "visible_documents": {d.document.id: d.document.name for d in documents},
        "image_urls": {},
        "file_urls": {},
        "tag_filter": [],
        "generated_at": T0,
        "link_ttl_seconds": 3600,
    }
    fields.update(overrides)
    return ExportInput(**fields)


def _export(viewer: uuid.UUID, documents: list[DocumentSource], **overrides: Any) -> Export:
    return build_export(_source(viewer, documents, **overrides))


# --- mentions ----------------------------------------------------------------

DIRECTORY = MentionDirectory(
    documents={CASTLE: "Castle Ravenloft"},
    tags={NPC: "NPC"},
    users={ALICE: "Alice", BOB: None},
)


def test_a_mention_that_resolves_is_a_span_under_its_current_name() -> None:
    old = mention_token(MentionKind.DOCUMENT, CASTLE, "Old name")
    text = f"See {old} and {mention_token(MentionKind.TAG, NPC, 'NPC')}."

    assert text_spans(text, DIRECTORY) == [
        TextSpan("See "),
        MentionSpan(MentionKind.DOCUMENT, CASTLE, "Castle Ravenloft"),
        TextSpan(" and "),
        MentionSpan(MentionKind.TAG, NPC, "NPC"),
        TextSpan("."),
    ]


def test_a_mention_the_viewer_cannot_resolve_is_plain_text_never_its_target() -> None:
    # VR-07: a hidden Document, a made-up Tag and an outsider all read as
    # the name that was written, with nothing pointing at them.
    text = (
        f"{mention_token(MentionKind.DOCUMENT, SECRET, 'Vampire lair')} "
        f"{mention_token(MentionKind.TAG, PC, 'PC')} "
        f"{mention_token(MentionKind.USER, CARA, 'Cara')}"
    )

    assert text_spans(text, DIRECTORY) == [TextSpan("#Vampire lair #PC @Cara")]


def test_a_member_without_a_display_name_keeps_the_name_written_in_the_token() -> None:
    spans = text_spans(mention_token(MentionKind.USER, BOB, "Bob"), DIRECTORY)

    assert spans == [MentionSpan(MentionKind.USER, BOB, "Bob")]


def test_text_without_mentions_is_one_span_and_empty_text_none() -> None:
    assert text_spans("Just words", DIRECTORY) == [TextSpan("Just words")]
    assert text_spans("", DIRECTORY) == []


# --- who sees what -----------------------------------------------------------


def test_notes_and_comments_the_viewer_cannot_read_are_absent() -> None:
    notes = [
        _note(1, "Public", DocumentVisibility.ROOM),
        _note(2, "Master only", DocumentVisibility.MASTER),
        _note(3, "Private", DocumentVisibility.PRIVATE),
    ]
    comments = [
        _comment(1, ALICE, "Hello"),
        _comment(2, ALICE, "Secret", DocumentVisibility.MASTER),
        _comment(3, MASTER, "Reply under the secret", parent=2),
        _comment(4, BOB, "Reply", parent=1),
    ]
    source = _castle(notes=notes, comments=comments)

    as_cara = _export(CARA, [source])
    (document,) = as_cara.documents
    assert [n.title for n in document.notes] == ["Public"]
    assert [c.id for c in document.comments] == [_id(1), _id(4)]

    as_master = _export(MASTER, [source])
    assert [n.title for n in as_master.documents[0].notes] == ["Public", "Master only", "Private"]
    assert len(as_master.documents[0].comments) == 4


def test_the_author_keeps_a_reply_whose_parent_they_cannot_read_without_its_parent_id() -> None:
    # Spec 19 Decision 6: the author sees their reply, as a placeholder
    # without a pointer to the parent.
    comments = [
        _comment(1, MASTER, "Hidden", DocumentVisibility.MASTER),
        _comment(2, BOB, "Reply", parent=1),
    ]

    (document,) = _export(BOB, [_castle(comments=comments)]).documents

    (reply,) = document.comments
    assert reply.id == _id(2)
    assert reply.parent_id is None


def test_who_is_let_in_is_listed_only_for_those_who_manage_the_content() -> None:
    source = _castle(
        document=_document(CASTLE, "Castle", visibility=DocumentVisibility.SELECTIVE),
        notes=[_note(1, "Note", DocumentVisibility.SELECTIVE)],
        note_grants={_id(1): [CARA]},
        comments=[_comment(1, ALICE, "Mine", DocumentVisibility.SELECTIVE)],
        comment_grants={_id(1): [BOB]},
    )

    # Alice owns the Document and wrote the Comment: she manages both.
    (as_owner,) = _export(ALICE, [source]).documents
    assert as_owner.selective_user_ids == [BOB]
    assert as_owner.notes[0].selective_user_ids == [CARA]
    assert as_owner.comments[0].selective_user_ids == [BOB]

    # Bob is let in to the Document and the Comment, but only reads them.
    (as_reader,) = _export(BOB, [source]).documents
    assert as_reader.visibility is DocumentVisibility.SELECTIVE
    assert as_reader.selective_user_ids is None
    assert as_reader.comments[0].selective_user_ids is None
    # the Master manages everything
    (as_master,) = _export(MASTER, [source]).documents
    assert as_master.selective_user_ids == [BOB]
    assert as_master.comments[0].selective_user_ids == [BOB]


def test_a_comment_written_as_a_character_names_it_only_when_the_viewer_sees_it() -> None:
    comments = [_comment(1, ALICE, "In character", as_document=IRENA)]
    source = _castle(comments=comments)

    seen = _export(ALICE, [source], visible_documents={CASTLE: "Castle", IRENA: "Irena"})
    assert seen.documents[0].comments[0].as_character_id == IRENA

    hidden = _export(ALICE, [source], visible_documents={CASTLE: "Castle"})
    assert hidden.documents[0].comments[0].as_character_id is None


def test_images_go_where_they_belong_and_unsigned_ones_are_left_out() -> None:
    source = _castle(
        images=[_image(1, favorite=True), _image(2), _image(3, post=1)],
        files=[_file(1), _file(2)],
        comments=[_comment(1, ALICE, "With a picture")],
    )

    (document,) = _export(
        ALICE,
        [source],
        image_urls={"img/1.webp": "https://x/1", "img/3.webp": "https://x/3"},
        file_urls={"files/1.pdf": "https://x/f1"},
    ).documents

    assert [(i.id, i.url, i.is_favorite) for i in document.images] == [
        (_id(1), "https://x/1", True)
    ]
    assert [(i.id, i.url) for i in document.comments[0].images] == [(_id(3), "https://x/3")]
    assert [(f.id, f.url, f.name) for f in document.files] == [
        (_id(1), "https://x/f1", "Sheet.pdf")
    ]


def test_documents_come_out_in_name_order_and_members_carry_no_email() -> None:
    export = _export(
        ALICE,
        [
            _castle(document=_document(CASTLE, "castle")),
            _castle(document=_document(IRENA, "Ammit")),
        ],
    )

    assert [d.name for d in export.documents] == ["Ammit", "castle"]
    assert {m.id: m.name for m in export.members}[BOB] is None
    assert "secret@example.com" not in str(render_json(export))
    assert "secret@example.com" not in render_markdown(export)


# --- JSON --------------------------------------------------------------------


def test_json_carries_the_version_ids_and_references() -> None:
    mention = mention_token(MentionKind.DOCUMENT, CASTLE, "Castle")
    source = _castle(
        document=_document(CASTLE, "Castle", description=f"Near {mention}", played_by=ALICE),
        notes=[_note(1, "Note", DocumentVisibility.ROOM, "x")],
        comments=[_comment(1, ALICE, "Top"), _comment(2, BOB, "Reply", parent=1)],
    )

    source = replace(source, images=[_image(1, favorite=True)], files=[_file(1)])
    data = render_json(
        _export(
            ALICE,
            [source],
            tag_filter=[NPC],
            image_urls={"img/1.webp": "https://x/1"},
            file_urls={"files/1.pdf": "https://x/f1"},
        )
    )

    assert data["schema_version"] == SCHEMA_VERSION == 1
    assert data["generated_at"] == T0.isoformat()
    assert data["links_expire_within_seconds"] == 3600
    assert data["room"] == {"id": str(ROOM_ID), "name": "Barovia", "game_system": "D&D 5e"}
    assert data["tag_filter"] == [str(NPC)]
    assert data["main_items"] == [[str(NPC)], [str(PLACE)]]
    assert {"id": str(NPC), "name": "NPC", "category": "Type"} in data["tags"]
    (document,) = data["documents"]
    assert document["id"] == str(CASTLE)
    assert document["tag_ids"] == sorted([str(NPC), str(PLACE)])
    assert document["owner_ids"] == [str(ALICE)]
    assert document["played_by"] == str(ALICE)
    assert document["description"] == [
        {"type": "text", "text": "Near "},
        {"type": "mention", "kind": "doc", "target_id": str(CASTLE), "name": "Castle"},
    ]
    assert document["images"] == [{"id": str(_id(1)), "url": "https://x/1", "is_favorite": True}]
    assert document["files"][0]["url"] == "https://x/f1"
    reply = document["comments"][1]
    assert reply["parent_id"] == str(_id(1))
    assert document["comments"][0]["parent_id"] is None
    assert document["notes"][0]["description"] == [{"type": "text", "text": "x"}]


def test_a_whole_room_export_has_no_tag_filter() -> None:
    assert render_json(_export(ALICE, []))["tag_filter"] is None


def test_ids_are_the_same_in_two_exports_of_the_same_content() -> None:
    source = _castle(
        comments=[_comment(1, ALICE, "Hi")], notes=[_note(1, "N", DocumentVisibility.ROOM)]
    )

    first = render_json(_export(ALICE, [source]))
    second = render_json(_export(ALICE, [source]))

    assert first == second


# --- Markdown ----------------------------------------------------------------


def test_markdown_groups_documents_like_the_list_and_links_repeats() -> None:
    other = _castle(document=_document(IRENA, "Irena"), tag_ids=[NPC])
    loose = _castle(document=_document(SECRET, "Loose"), tag_ids=[])
    text = render_markdown(_export(ALICE, [_castle(), other, loose]))

    # Castle carries both Tags: written in full under NPC, only linked under
    # Place; Documents with no Main Tag come last.
    assert text.index("## NPC") < text.index("## Place") < text.index("## Other documents")
    assert text.count(f'<a id="doc-{CASTLE}"></a>') == 1
    assert f"- [Castle](#doc-{CASTLE})" in text
    assert text.index(f'<a id="doc-{IRENA}"></a>') < text.index(f"- [Castle](#doc-{CASTLE})")
    assert f'<a id="doc-{SECRET}"></a>Loose' in text


def test_markdown_without_main_items_has_one_documents_section() -> None:
    text = render_markdown(_export(ALICE, [_castle()], main_items=[]))

    assert "## Documents" in text
    assert "## Other documents" not in text


def test_a_main_item_naming_a_missing_tag_is_ignored_and_a_combination_joins_names() -> None:
    text = render_markdown(_export(ALICE, [_castle()], main_items=[(_id(99),), (NPC, PLACE)]))

    assert "## NPC + Place" in text
    assert "99" not in text.split("## NPC + Place")[0]


def test_markdown_reads_the_header_the_tags_and_the_filter() -> None:
    text = render_markdown(_export(ALICE, [_castle()], tag_filter=[NPC]))

    assert text.startswith("# Barovia\n\nD&D 5e · Exported 2026-10-02\n")
    assert "expire within 60 minutes" in text
    assert "Only Documents tagged: NPC" in text
    assert f'- <a id="tag-{NPC}"></a>NPC (Type)' in text
    assert f'- <a id="tag-{PLACE}"></a>Place\n' in text


def test_markdown_without_a_game_system_or_tags_skips_those_lines() -> None:
    room = Room(
        id=ROOM_ID, name="Quiet", game_system=None, status=RoomStatus.ACTIVE, created_by=MASTER
    )

    text = render_markdown(_export(ALICE, [], room=room, tags=[], main_items=[]))

    assert text.startswith("# Quiet\n\nExported 2026-10-02\n")
    assert "## Tags" not in text


def test_markdown_describes_a_document_with_its_facts_notes_and_mentions() -> None:
    link = mention_token(MentionKind.DOCUMENT, CASTLE, "Castle")
    hidden_by_filter = mention_token(MentionKind.DOCUMENT, IRENA, "Irena")
    tag = mention_token(MentionKind.TAG, NPC, "NPC")
    user = mention_token(MentionKind.USER, ALICE, "Alice")
    source = _castle(
        document=_document(
            CASTLE,
            "Castle",
            description=f"{link} {hidden_by_filter} {tag} {user}",
            visibility=DocumentVisibility.SELECTIVE,
            played_by=BOB,
        ),
        selective_ids=[CARA],
        owner_ids=[ALICE, _id(99)],
        images=[_image(1)],
        files=[_file(1)],
        notes=[
            _note(1, "Rumor", DocumentVisibility.ROOM, "Heard in town"),
            _note(2, "Empty", DocumentVisibility.ROOM),
        ],
    )

    text = render_markdown(
        _export(
            MASTER,
            [source],
            visible_documents={CASTLE: "Castle", IRENA: "Irena"},
            image_urls={"img/1.webp": "https://x/1"},
            file_urls={"files/1.pdf": "https://x/f1"},
        )
    )

    assert "- Visibility: selective" in text
    assert "- Tags: NPC, Place" in text or "- Tags: Place, NPC" in text
    assert f"- Owners: Alice, {UNKNOWN_MEMBER}" in text
    assert f"- Played by: {UNKNOWN_MEMBER}" in text
    assert "- Shared with: Cara" in text
    # A mention of a Document in the export links; one the Tag filter left
    # out stays plain; a Tag links to its entry; a member is @Name.
    assert f"[Castle](#doc-{CASTLE}) #Irena [#NPC](#tag-{NPC}) @Alice" in text
    assert "- ![image](https://x/1)" in text
    assert "- [Sheet.pdf](https://x/f1)" in text
    assert "#### Rumor\n\nHeard in town" in text
    assert "#### Empty\n\n" in text


def test_markdown_nests_replies_and_marks_deleted_and_in_character_comments() -> None:
    comments = [
        _comment(1, ALICE, "First line\nsecond line"),
        _comment(2, BOB, "A reply", parent=1),
        _comment(3, CARA, "Deeper", parent=2),
        _comment(4, ALICE, "", deleted=True),
        _comment(5, ALICE, "As Irena", as_document=IRENA),
    ]
    source = _castle(comments=comments, images=[_image(1, post=5)])

    text = render_markdown(
        _export(
            MASTER,
            [source],
            visible_documents={CASTLE: "Castle", IRENA: "Irena"},
            image_urls={"img/1.webp": "https://x/1"},
        )
    )

    assert "- **Alice** (2026-10-02): First line\n  second line\n" in text
    assert f"  - **{UNKNOWN_MEMBER}** (2026-10-02): A reply" in text
    assert "    - **Cara** (2026-10-02): Deeper" in text
    assert "- **Alice** (2026-10-02): _(deleted)_" in text
    assert "- **Irena (played by Alice)** (2026-10-02): As Irena\n  - ![image](https://x/1)" in text


def test_markdown_never_has_a_run_of_blank_lines_and_ends_with_one_newline() -> None:
    text = render_markdown(_export(ALICE, [_castle(comments=[_comment(1, ALICE, "a\n\n\n\nb")])]))

    assert "\n\n\n" not in text
    assert text.endswith("\n") and not text.endswith("\n\n")


def test_markdown_escapes_names_so_they_cannot_break_headings_or_links() -> None:
    # Review of PR #93: a name with brackets, emphasis marks or a line break
    # is written escaped and on one line wherever it becomes Markdown syntax.
    nasty = "A [B]* _c_\nd <e> \\f"
    safe = "A \\[B\\]\\* \\_c\\_ d \\<e\\> \\\\f"
    tags = [Tag(NPC, ROOM_ID, nasty, nasty, 0)]
    link = mention_token(MentionKind.DOCUMENT, CASTLE, nasty)
    tag_link = mention_token(MentionKind.TAG, NPC, nasty)
    source = _castle(
        document=_document(CASTLE, nasty, description=f"{link} {tag_link}", played_by=ALICE),
        tag_ids=[NPC],
        files=[replace(_file(1), display_name=nasty)],
        notes=[_note(1, nasty, DocumentVisibility.ROOM)],
        comments=[_comment(1, ALICE, "hi", as_document=CASTLE)],
    )
    room = Room(
        id=ROOM_ID, name=nasty, game_system=nasty, status=RoomStatus.ACTIVE, created_by=MASTER
    )
    members = [_member(MASTER, RoomRole.MASTER, nasty), _member(ALICE, RoomRole.PLAYER, nasty)]

    text = render_markdown(
        _export(
            MASTER,
            [source],
            room=room,
            tags=tags,
            main_items=[(NPC,)],
            members=members,
            tag_filter=[NPC],
            file_urls={"files/1.pdf": "https://x/f1"},
            visible_documents={CASTLE: nasty},
        )
    )

    assert f"# {safe}\n\n{safe} · Exported" in text
    assert f"Only Documents tagged: {safe}" in text
    assert f"</a>{safe} ({safe})" in text
    assert f"## {safe}\n" in text
    assert f'### <a id="doc-{CASTLE}"></a>{safe}\n' in text
    assert f"- Tags: {safe}" in text
    assert f"- Played by: {safe}" in text
    assert f"[{safe}](https://x/f1)" in text
    assert f"#### {safe}\n" in text
    assert f"[{safe}](#doc-{CASTLE}) [#{safe}](#tag-{NPC})" in text
    assert f"**{safe} (played by {safe})**" in text
    assert "A [B]" not in text


# --- file name ---------------------------------------------------------------


def test_the_file_name_is_the_room_and_the_date() -> None:
    assert export_filename("Barovia", T0, ExportFormat.JSON) == "barovia-2026-10-02.json"
    assert export_filename("La Città di Ravenloft!", T0, ExportFormat.MARKDOWN) == (
        "la-citta-di-ravenloft-2026-10-02.md"
    )
    # Nothing ASCII left, so a header-safe fallback.
    assert export_filename("龍", T0, ExportFormat.JSON) == "room-2026-10-02.json"
    assert export_filename('a"b\r\nc', T0, ExportFormat.JSON) == "a-b-c-2026-10-02.json"


# --- one Document (spec 27) ---------------------------------------------------


def test_a_single_document_export_keeps_only_what_the_document_refers_to() -> None:
    description = (
        f"{mention_token(MentionKind.TAG, PLACE, 'Place')} and "
        f"{mention_token(MentionKind.USER, CARA, 'Cara')}"
    )
    castle = _castle(
        document=_document(CASTLE, "Castle", description, played_by=BOB),
        tag_ids=[NPC],
        owner_ids=[ALICE],
        selective_ids=[],
        comments=[_comment(1, ALICE, "In character", as_document=IRENA)],
    )
    other = DocumentSource(**{**castle.__dict__, "document": _document(IRENA, "Irena")})
    export = _export(
        MASTER,
        [castle, other],
        visible_documents={CASTLE: "Castle", IRENA: "Irena", SECRET: "Secret"},
    )

    one = restrict_to_document(export, CASTLE)

    assert [d.id for d in one.documents] == [CASTLE]
    # The Tag it carries and the one it mentions; its Owner, player, Comment
    # author and the member it mentions - nobody else.
    assert {t.id for t in one.tags} == {NPC, PLACE}
    assert {m.id for m in one.members} == {ALICE, BOB, CARA}
    assert one.main_items == () and one.tag_filter == ()
    # The Documents Comments were written as stay named, no other Document does.
    assert set(one.visible_documents) == {CASTLE, IRENA}
    assert (one.room_name, one.generated_at) == (export.room_name, export.generated_at)


def test_a_document_file_is_named_after_it_with_a_fallback() -> None:
    assert document_export_filename("La Torre", T0, ExportFormat.JSON) == "la-torre-2026-10-02.json"
    assert document_export_filename("龍", T0, ExportFormat.MARKDOWN) == "document-2026-10-02.md"

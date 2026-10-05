"""The Room export (FR-G1, UC-17, spec 23): what one member may see of a Room,
as a format-independent tree (`build_export`) that `render_json` and
`render_markdown` serialize with the same content.

Everything here is pure. The Documents it is given are already the ones the
requester sees (`access` + the Tag filter, Invariant 1); this module applies
the Note and Comment rules on top (VR-03, spec 19) and decides what is shown
about who may read what, so a hidden Note, Comment or image never reaches
either format (VR-07, NFR-01)."""

import re
import unicodedata
import uuid
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

from app.domain.comments import can_edit_comment
from app.domain.documents import is_owner
from app.domain.mentions import MentionKind, find_mentions
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
    Tag,
    UserProfile,
)
from app.domain.visibility import (
    is_comment_visible_in_thread,
    is_note_visible,
    is_parent_hidden,
)

# Bumped when the JSON shape changes: 1 is the first release, with replies
# (spec 19) and mention ids (spec 20) already part of it.
SCHEMA_VERSION = 1

# Shown for a member with no display name: emails are never exported
# (NFR-03).
UNKNOWN_MEMBER = "Unknown member"
_OTHER_DOCUMENTS = "Other documents"
_DOCUMENTS = "Documents"


class ExportFormat(StrEnum):
    """The two serializations of one export tree."""

    JSON = "json"
    MARKDOWN = "md"


@dataclass(frozen=True)
class DocumentSource:
    """What the export reads about one Document the requester sees: its
    rows, with every Note and Comment (filtered in `build_export`) and the
    images and files the requester may see (filtered by the caller, since
    that filter reads Comments, Invariant 1)."""

    document: Document
    owner_ids: Sequence[uuid.UUID]
    selective_ids: Sequence[uuid.UUID]
    tag_ids: Sequence[uuid.UUID]
    images: Sequence[DocumentImage]
    files: Sequence[DocumentFile]
    notes: Sequence[Note]
    note_grants: Mapping[uuid.UUID, Collection[uuid.UUID]]
    comments: Sequence[Comment]
    comment_grants: Mapping[uuid.UUID, Collection[uuid.UUID]]


@dataclass(frozen=True)
class ExportInput:
    """Everything `build_export` needs. `visible_documents` is the name of
    every Document of the Room the requester sees, including ones a Tag
    filter leaves out: a mention or a Character can point at them. The URL
    mappings are keyed by Storage path and hold only signed links; an item
    Storage couldn't sign is left out, like in the API."""

    room: Room
    viewer: Membership
    members: Sequence[tuple[Membership, UserProfile]]
    tags: Sequence[Tag]
    main_items: Sequence[Sequence[uuid.UUID]]
    documents: Sequence[DocumentSource]
    visible_documents: Mapping[uuid.UUID, str]
    image_urls: Mapping[str, str]
    file_urls: Mapping[str, str]
    tag_filter: Sequence[uuid.UUID]
    generated_at: datetime
    link_ttl_seconds: int


@dataclass(frozen=True)
class TextSpan:
    """A run of plain text."""

    text: str


@dataclass(frozen=True)
class MentionSpan:
    """A mention of a Document, a Tag or a member that resolved to something
    the requester sees, under its current name."""

    kind: MentionKind
    target_id: uuid.UUID
    name: str


Span = TextSpan | MentionSpan


@dataclass(frozen=True)
class ExportMember:
    """A member by name; the email is never exported (NFR-03)."""

    id: uuid.UUID
    name: str | None


@dataclass(frozen=True)
class ExportTag:
    """A Tag of the Room (every member sees every Tag, D-14)."""

    id: uuid.UUID
    name: str
    category: str | None


@dataclass(frozen=True)
class ExportImage:
    """An image as a signed link, no bytes."""

    id: uuid.UUID
    url: str
    is_favorite: bool


@dataclass(frozen=True)
class ExportFile:
    """A PDF Attachment as a signed link, no bytes."""

    id: uuid.UUID
    name: str
    size_bytes: int
    content_type: str
    url: str


@dataclass(frozen=True)
class ExportNote:
    """A Note the requester sees. `selective_user_ids` is None unless they
    may manage it, like in the API."""

    id: uuid.UUID
    title: str
    description: Sequence[Span]
    position: int
    visibility: DocumentVisibility
    selective_user_ids: Sequence[uuid.UUID] | None


@dataclass(frozen=True)
class ExportComment:
    """A Comment the requester sees, a deleted one as a placeholder with an
    empty body (FR-T5). `parent_id` is None for a top-level Comment and for a
    reply whose parent the requester can't see (spec 19 Decision 6);
    `as_character_id` only names a Document the requester sees (VR-13)."""

    id: uuid.UUID
    parent_id: uuid.UUID | None
    author_id: uuid.UUID
    as_character_id: uuid.UUID | None
    body: Sequence[Span]
    created_at: datetime
    updated_at: datetime
    deleted: bool
    visibility: DocumentVisibility
    selective_user_ids: Sequence[uuid.UUID] | None
    images: Sequence[ExportImage]


@dataclass(frozen=True)
class ExportDocument:
    """A Document the requester sees, with everything on it they see.
    `selective_user_ids` is None unless they may manage it."""

    id: uuid.UUID
    name: str
    description: Sequence[Span]
    visibility: DocumentVisibility
    selective_user_ids: Sequence[uuid.UUID] | None
    tag_ids: Sequence[uuid.UUID]
    owner_ids: Sequence[uuid.UUID]
    played_by: uuid.UUID | None
    images: Sequence[ExportImage]
    files: Sequence[ExportFile]
    notes: Sequence[ExportNote]
    comments: Sequence[ExportComment]


@dataclass(frozen=True)
class Export:
    """The whole export, before it is serialized."""

    room_id: uuid.UUID
    room_name: str
    game_system: str | None
    generated_at: datetime
    link_ttl_seconds: int
    members: Sequence[ExportMember]
    tags: Sequence[ExportTag]
    main_items: Sequence[Sequence[uuid.UUID]]
    tag_filter: Sequence[uuid.UUID]
    documents: Sequence[ExportDocument]
    # The name of every Document the requester sees, a Tag filter's leftovers
    # included: the Characters Comments were written as are named from it.
    visible_documents: Mapping[uuid.UUID, str]


@dataclass(frozen=True)
class MentionDirectory:
    """What a mention can resolve to for this requester: the Documents they
    see, the Room's Tags and its members' names. Anything else stays plain
    text, so a mention never reveals a hidden Document (VR-07)."""

    documents: Mapping[uuid.UUID, str]
    tags: Mapping[uuid.UUID, str]
    users: Mapping[uuid.UUID, str | None]


def text_spans(text: str, directory: MentionDirectory) -> list[Span]:
    """`text` as spans: plain text and the mentions that resolve in
    `directory` under their current name. A token that doesn't resolve is
    written back as plain `#Name` or `@Name`, its stored name."""
    spans: list[Span] = []
    last = 0

    def add_text(value: str) -> None:
        if not value:
            return
        if spans and isinstance(spans[-1], TextSpan):
            spans[-1] = TextSpan(spans[-1].text + value)
        else:
            spans.append(TextSpan(value))

    for mention in find_mentions(text):
        add_text(text[last : mention.start])
        sigil = "@" if mention.kind is MentionKind.USER else "#"
        name = _resolve(mention.kind, mention.target_id, directory)
        if name is None:
            add_text(f"{sigil}{mention.name}")
        else:
            spans.append(MentionSpan(mention.kind, mention.target_id, name or mention.name))
        last = mention.end
    add_text(text[last:])
    return spans


def _resolve(kind: MentionKind, target_id: uuid.UUID, directory: MentionDirectory) -> str | None:
    """The current name of a mention's target, "" for a member with no
    display name (the stored name is used then), or None when it doesn't
    resolve for this requester."""
    if kind is MentionKind.DOCUMENT:
        return directory.documents.get(target_id)
    if kind is MentionKind.TAG:
        return directory.tags.get(target_id)
    if target_id not in directory.users:
        return None
    return directory.users[target_id] or ""


def build_export(source: ExportInput) -> Export:
    """The export tree for `source.viewer`. Notes are filtered by their own
    visibility and Comments by their effective one, parents included (spec
    19); a Note or Comment the viewer can't read is simply absent. Documents
    come out in name order."""
    directory = MentionDirectory(
        documents=source.visible_documents,
        tags={tag.id: tag.name for tag in source.tags},
        users={m.user_id: profile.display_name for m, profile in source.members},
    )
    documents = [_export_document(item, source, directory) for item in source.documents]
    documents.sort(key=lambda d: (d.name.casefold(), str(d.id)))
    return Export(
        room_id=source.room.id,
        room_name=source.room.name,
        game_system=source.room.game_system,
        generated_at=source.generated_at,
        link_ttl_seconds=source.link_ttl_seconds,
        members=[
            ExportMember(m.user_id, profile.display_name)
            for m, profile in sorted(source.members, key=lambda pair: str(pair[0].user_id))
        ],
        tags=[
            ExportTag(tag.id, tag.name, tag.category)
            for tag in sorted(source.tags, key=lambda t: (t.name.casefold(), str(t.id)))
        ],
        main_items=[tuple(item) for item in source.main_items],
        tag_filter=list(source.tag_filter),
        documents=documents,
        visible_documents=source.visible_documents,
    )


def _images(images: Sequence[DocumentImage], urls: Mapping[str, str]) -> list[ExportImage]:
    """The images that have a signed link."""
    return [
        ExportImage(image.id, urls[image.storage_path], image.is_favorite)
        for image in images
        if image.storage_path in urls
    ]


def _export_document(
    item: DocumentSource, source: ExportInput, directory: MentionDirectory
) -> ExportDocument:
    """One Document with its visible Notes, Comments, images and files."""
    viewer = source.viewer
    document = item.document
    manages = is_owner(viewer.role, viewer.user_id, item.owner_ids)
    notes = [
        ExportNote(
            id=note.id,
            title=note.title,
            description=text_spans(note.description, directory),
            position=note.position,
            visibility=note.visibility,
            selective_user_ids=(sorted(item.note_grants.get(note.id, ())) if manages else None),
        )
        for note in item.notes
        if is_note_visible(
            note,
            viewer.user_id,
            viewer.role,
            item.owner_ids,
            item.note_grants.get(note.id, ()),
        )
    ]
    by_id = {comment.id: comment for comment in item.comments}
    comment_images: dict[uuid.UUID, list[DocumentImage]] = {}
    for image in item.images:
        if image.post_id is not None:
            comment_images.setdefault(image.post_id, []).append(image)
    comments = [
        _export_comment(comment, item, by_id, comment_images, source, directory)
        for comment in item.comments
        if is_comment_visible_in_thread(
            comment, by_id, item.comment_grants, viewer.user_id, viewer.role
        )
    ]
    return ExportDocument(
        id=document.id,
        name=document.name,
        description=text_spans(document.description, directory),
        visibility=document.visibility,
        selective_user_ids=sorted(item.selective_ids) if manages else None,
        tag_ids=sorted(item.tag_ids, key=str),
        owner_ids=sorted(item.owner_ids, key=str),
        played_by=document.played_by,
        images=_images([i for i in item.images if i.post_id is None], source.image_urls),
        files=[
            ExportFile(
                f.id, f.display_name, f.size_bytes, f.content_type, source.file_urls[f.storage_path]
            )
            for f in item.files
            if f.storage_path in source.file_urls
        ],
        notes=notes,
        comments=comments,
    )


def _export_comment(
    comment: Comment,
    item: DocumentSource,
    by_id: Mapping[uuid.UUID, Comment],
    comment_images: Mapping[uuid.UUID, Sequence[DocumentImage]],
    source: ExportInput,
    directory: MentionDirectory,
) -> ExportComment:
    """One Comment the viewer is known to see."""
    viewer = source.viewer
    parent_hidden = is_parent_hidden(
        comment, by_id, item.comment_grants, viewer.user_id, viewer.role
    )
    author_or_master = can_edit_comment(comment, viewer.user_id) or viewer.role is RoomRole.MASTER
    return ExportComment(
        id=comment.id,
        parent_id=None if parent_hidden else comment.parent_id,
        author_id=comment.author_id,
        as_character_id=(
            comment.as_document_id if comment.as_document_id in source.visible_documents else None
        ),
        body=text_spans(comment.body, directory),
        created_at=comment.created_at,
        updated_at=comment.updated_at,
        deleted=comment.deleted_at is not None,
        visibility=comment.visibility,
        selective_user_ids=(
            sorted(item.comment_grants.get(comment.id, ())) if author_or_master else None
        ),
        images=_images(comment_images.get(comment.id, ()), source.image_urls),
    )


def _file_stem(room_name: str, generated_at: datetime) -> str:
    """`<room>-<date>`: the Room's name reduced to ASCII letters and digits
    joined by hyphens, so it is safe in a `Content-Disposition` header
    whatever the name holds; `room` when nothing is left."""
    ascii_name = unicodedata.normalize("NFKD", room_name).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")[:60].strip("-")
    return f"{slug or 'room'}-{generated_at:%Y-%m-%d}"


def export_filename(room_name: str, generated_at: datetime, export_format: ExportFormat) -> str:
    """`<room>-<date>.json|md` (spec 23 Decision 5)."""
    return f"{_file_stem(room_name, generated_at)}.{export_format.value}"


def pdf_filename(room_name: str, generated_at: datetime) -> str:
    """`<room>-<date>.pdf`, named like the other exports (spec 23b)."""
    return f"{_file_stem(room_name, generated_at)}.pdf"


# --- JSON --------------------------------------------------------------------


def _json_spans(spans: Sequence[Span]) -> list[dict[str, Any]]:
    """Spans as `{type: "text", text}` and `{type: "mention", kind,
    target_id, name}` objects."""
    return [
        (
            {"type": "text", "text": span.text}
            if isinstance(span, TextSpan)
            else {
                "type": "mention",
                "kind": span.kind.value,
                "target_id": str(span.target_id),
                "name": span.name,
            }
        )
        for span in spans
    ]


def _ids(values: Sequence[uuid.UUID] | None) -> list[str] | None:
    """Ids as strings, keeping None."""
    return None if values is None else [str(value) for value in values]


def render_json(export: Export) -> dict[str, Any]:
    """The export as plain JSON-ready data (`schema_version` first, UUIDs as
    strings, times as ISO 8601). Every object carries its id and references
    other objects by id: Documents to Tags, Owners and the player, a reply to
    its parent, a mention to its target."""
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": export.generated_at.isoformat(),
        "links_expire_within_seconds": export.link_ttl_seconds,
        "room": {
            "id": str(export.room_id),
            "name": export.room_name,
            "game_system": export.game_system,
        },
        "tag_filter": _ids(export.tag_filter) if export.tag_filter else None,
        "members": [{"id": str(m.id), "name": m.name} for m in export.members],
        "tags": [{"id": str(t.id), "name": t.name, "category": t.category} for t in export.tags],
        "main_items": [[str(tag_id) for tag_id in item] for item in export.main_items],
        "documents": [_json_document(document) for document in export.documents],
    }


def _json_image(image: ExportImage) -> dict[str, Any]:
    """An image object."""
    return {"id": str(image.id), "url": image.url, "is_favorite": image.is_favorite}


def _json_document(document: ExportDocument) -> dict[str, Any]:
    """A Document object with its Notes, Comments, images and files."""
    return {
        "id": str(document.id),
        "name": document.name,
        "description": _json_spans(document.description),
        "visibility": document.visibility.value,
        "selective_user_ids": _ids(document.selective_user_ids),
        "tag_ids": _ids(document.tag_ids),
        "owner_ids": _ids(document.owner_ids),
        "played_by": None if document.played_by is None else str(document.played_by),
        "images": [_json_image(image) for image in document.images],
        "files": [
            {
                "id": str(f.id),
                "name": f.name,
                "size_bytes": f.size_bytes,
                "content_type": f.content_type,
                "url": f.url,
            }
            for f in document.files
        ],
        "notes": [
            {
                "id": str(n.id),
                "title": n.title,
                "description": _json_spans(n.description),
                "position": n.position,
                "visibility": n.visibility.value,
                "selective_user_ids": _ids(n.selective_user_ids),
            }
            for n in document.notes
        ],
        "comments": [
            {
                "id": str(c.id),
                "parent_id": None if c.parent_id is None else str(c.parent_id),
                "author_id": str(c.author_id),
                "as_character_id": None if c.as_character_id is None else str(c.as_character_id),
                "body": _json_spans(c.body),
                "created_at": c.created_at.isoformat(),
                "updated_at": c.updated_at.isoformat(),
                "deleted": c.deleted,
                "visibility": c.visibility.value,
                "selective_user_ids": _ids(c.selective_user_ids),
                "images": [_json_image(image) for image in c.images],
            }
            for c in document.comments
        ],
    }


# --- Markdown ----------------------------------------------------------------

_BLANK_RUN = re.compile(r"\n{3,}")
_MARKDOWN_SPECIAL = re.compile(r"([\\`*_\[\]<>])")


def _md(name: str) -> str:
    """A name written into a heading, a link or a bold run: on one line, with
    the characters Markdown would read as syntax escaped, so a Document called
    `A [B]` or `x*y` can't break its own link or heading. Descriptions and
    Comment bodies aren't passed through here: they are the author's own
    prose."""
    return _MARKDOWN_SPECIAL.sub(r"\\\1", " ".join(name.split()))


def _plain(spans: Sequence[Span], exported: Collection[uuid.UUID]) -> str:
    """Spans as Markdown: a Document in the export is a link to its section
    (`#doc-<id>`), a Tag a link to the Tags list, a member `@Name`; a Document
    left out by the Tag filter is plain `#Name`."""
    parts: list[str] = []
    for span in spans:
        if isinstance(span, TextSpan):
            parts.append(span.text)
        elif span.kind is MentionKind.DOCUMENT:
            parts.append(
                f"[{_md(span.name)}](#doc-{span.target_id})"
                if span.target_id in exported
                else f"#{_md(span.name)}"
            )
        elif span.kind is MentionKind.TAG:
            parts.append(f"[#{_md(span.name)}](#tag-{span.target_id})")
        else:
            parts.append(f"@{_md(span.name)}")
    return "".join(parts)


def _indented(text: str, prefix: str) -> str:
    """`text` with every line after the first indented by `prefix`, so a
    multi-line body stays inside its list item."""
    first, *rest = text.split("\n")
    return "\n".join([first, *[f"{prefix}{line}" if line else "" for line in rest]])


def group_documents(
    export: Export,
) -> list[tuple[tuple[uuid.UUID, ...] | None, list[ExportDocument]]]:
    """The Documents bucketed like the Documents list (spec 10, 11_2): by the
    Room's Main items in order, a Document under every item whose Tags it
    all carries (the group is keyed by the item's Tag ids), then the ones
    matching none, keyed `None` and always last. Empty groups are kept, so a
    caller can tell the Room has Main items; an item that names a missing Tag
    is ignored."""
    tag_ids = {tag.id for tag in export.tags}
    groups: list[tuple[tuple[uuid.UUID, ...] | None, list[ExportDocument]]] = []
    matched: set[uuid.UUID] = set()
    for item in export.main_items:
        if not all(tag_id in tag_ids for tag_id in item):
            continue
        members = [d for d in export.documents if all(t in d.tag_ids for t in item)]
        matched.update(d.id for d in members)
        groups.append((tuple(item), members))
    groups.append((None, [d for d in export.documents if d.id not in matched]))
    return groups


def _group_documents(export: Export) -> list[tuple[str, list[ExportDocument]]]:
    """`group_documents` as Markdown headings: the Tag names of an item joined
    by " + ", then "Other documents" (or "Documents" when the Room has no
    Main item to group by). Empty groups are dropped."""
    tag_names = {tag.id: tag.name for tag in export.tags}
    groups = group_documents(export)
    titled = [
        (
            (
                " + ".join(_md(tag_names[tag_id]) for tag_id in item)
                if item is not None
                else (_OTHER_DOCUMENTS if len(groups) > 1 else _DOCUMENTS)
            ),
            documents,
        )
        for item, documents in groups
    ]
    return [(title, documents) for title, documents in titled if documents]


def render_markdown(export: Export) -> str:
    """The export as one readable Markdown file: the Room, its Tags, then the
    Documents grouped like the list. A Document is written in full under the
    first group it belongs to and only linked under the others; each has an
    anchor `doc-<id>`, each Tag `tag-<id>`. Links to images and files expire
    (said at the top)."""
    names = {m.id: m.name or UNKNOWN_MEMBER for m in export.members}
    exported = {d.id for d in export.documents}
    doc_names = export.visible_documents
    lines: list[str] = [f"# {_md(export.room_name)}", ""]
    meta = []
    if export.game_system:
        meta.append(_md(export.game_system))
    meta.append(f"Exported {export.generated_at:%Y-%m-%d}")
    lines += [" · ".join(meta), ""]
    lines += [
        f"Links to images and files expire within {export.link_ttl_seconds // 60} minutes "
        "of the export.",
        "",
    ]
    if export.tag_filter:
        tag_names = {t.id: t.name for t in export.tags}
        shown = ", ".join(_md(tag_names.get(tag_id, str(tag_id))) for tag_id in export.tag_filter)
        lines += [f"Only Documents tagged: {shown}", ""]

    if export.tags:
        lines += ["## Tags", ""]
        for tag in export.tags:
            category = f" ({_md(tag.category)})" if tag.category else ""
            lines.append(f'- <a id="tag-{tag.id}"></a>{_md(tag.name)}{category}')
        lines.append("")

    written: set[uuid.UUID] = set()
    for title, documents in _group_documents(export):
        lines += [f"## {title}", ""]
        for document in documents:
            if document.id in written:
                lines += [f"- [{_md(document.name)}](#doc-{document.id})", ""]
                continue
            written.add(document.id)
            lines += _markdown_document(document, export, names, exported, doc_names)
    return _BLANK_RUN.sub("\n\n", "\n".join(lines)).rstrip() + "\n"


def _markdown_document(
    document: ExportDocument,
    export: Export,
    names: Mapping[uuid.UUID, str],
    exported: Collection[uuid.UUID],
    doc_names: Mapping[uuid.UUID, str],
) -> list[str]:
    """One Document's section: heading with its anchor, facts, description,
    images, files, Notes and the Comment thread."""
    tag_names = {t.id: t.name for t in export.tags}
    lines = [f'### <a id="doc-{document.id}"></a>{_md(document.name)}', ""]
    facts = [f"Visibility: {document.visibility.value}"]
    if document.tag_ids:
        facts.append("Tags: " + ", ".join(_md(tag_names.get(t, str(t))) for t in document.tag_ids))
    if document.owner_ids:
        facts.append(
            "Owners: " + ", ".join(_md(names.get(o, UNKNOWN_MEMBER)) for o in document.owner_ids)
        )
    if document.played_by is not None:
        facts.append(f"Played by: {_md(names.get(document.played_by, UNKNOWN_MEMBER))}")
    if document.selective_user_ids:
        facts.append(
            "Shared with: "
            + ", ".join(_md(names.get(u, UNKNOWN_MEMBER)) for u in document.selective_user_ids)
        )
    lines += [f"- {fact}" for fact in facts] + [""]
    description = _plain(document.description, exported).strip()
    if description:
        lines += [description, ""]
    if document.images:
        lines += ["**Images**", ""]
        lines += [f"- ![image]({image.url})" for image in document.images] + [""]
    if document.files:
        lines += ["**Files**", ""]
        lines += [f"- [{_md(f.name)}]({f.url})" for f in document.files] + [""]
    if document.notes:
        lines += ["**Notes**", ""]
        for note in document.notes:
            lines += [f"#### {_md(note.title)}", ""]
            text = _plain(note.description, exported).strip()
            if text:
                lines += [text, ""]
    if document.comments:
        lines += ["**Comments**", ""]
        lines += _markdown_thread(document.comments, names, exported, doc_names)
        lines.append("")
    return lines


def _markdown_thread(
    comments: Sequence[ExportComment],
    names: Mapping[uuid.UUID, str],
    exported: Collection[uuid.UUID],
    doc_names: Mapping[uuid.UUID, str],
) -> list[str]:
    """The Comments as a nested list, replies under their parent. Every
    reply in the export has its parent in it: a reply whose parent the viewer
    can't see comes with no `parent_id` and is a top-level item."""
    children: dict[uuid.UUID | None, list[ExportComment]] = {}
    for comment in comments:
        children.setdefault(comment.parent_id, []).append(comment)

    lines: list[str] = []

    def write(parent: uuid.UUID | None, depth: int) -> None:
        for comment in children.get(parent, []):
            author = _md(names.get(comment.author_id, UNKNOWN_MEMBER))
            if comment.as_character_id is not None and comment.as_character_id in doc_names:
                author = f"{_md(doc_names[comment.as_character_id])} (played by {author})"
            body = "_(deleted)_" if comment.deleted else _plain(comment.body, exported).strip()
            indent = "  " * depth
            head = f"{indent}- **{author}** ({comment.created_at:%Y-%m-%d}): "
            lines.append(head + _indented(body, indent + "  "))
            for image in comment.images:
                lines.append(f"{indent}  - ![image]({image.url})")
            write(comment.id, depth + 1)

    write(None, 0)
    return lines

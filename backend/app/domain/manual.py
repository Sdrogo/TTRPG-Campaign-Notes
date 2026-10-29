"""The Room PDF as a manual (spec 23b, Decisions 1 to 3): the export tree of
spec 23 laid out as a cover, chapters, Document sections, an optional
Comments appendix per Document and a glossary of the Documents' names.

Everything here is pure and works on an `Export`, which already holds only what
the requester sees (Invariant 1, VR-07), so nothing hidden can reach a page.
Page numbers are not computed here: the template links to anchors and the
print CSS asks WeasyPrint for the page of each (`target-counter`)."""

import re
import unicodedata
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date
from enum import StrEnum

from app.domain.export import (
    Export,
    ExportComment,
    ExportDocument,
    ExportImage,
    MentionSpan,
    Span,
    TextSpan,
    group_documents,
)
from app.domain.markdown import (
    Node,
    markdown_tree,
    placeholder,
    split_placeholders,
    without_placeholder_marks,
)
from app.domain.mentions import MentionKind


class ManualStyle(StrEnum):
    """The built-in looks (spec 23b Decision 4), in the order they were built.
    Each has a template `<value>.html.j2` and a stylesheet `<value>.css`."""

    GOTHIC = "gothic"
    MODERN = "modern"
    PRINT = "print"
    PARCHMENT = "parchment"


class PageSize(StrEnum):
    """The paper sizes (Decision 5); the value is the CSS `size` keyword."""

    A4 = "A4"
    LETTER = "Letter"


_PARAGRAPH_BREAK = re.compile(r"\n[ \t]*\n\s*")
_SIGILS = ("#", "@")
# A `#` that opens a word, as a plain `#Name` mention reads (spec 20: at the
# start of the text, after whitespace or after an opening bracket). Only
# before a letter, so "#1" or a lone "#" stay as written.
_PLAIN_HASHTAG = re.compile(r"(?<![^\s(\[{])#(?=[^\W\d_])")


@dataclass(frozen=True)
class ManualLabels:
    """The fixed texts of the PDF, in the requester's language (spec 23b
    Frontend). `played_by` is a template with `{character}` and `{player}`."""

    contents: str
    glossary: str
    other: str
    documents: str
    comments: str
    unknown_member: str
    played_by: str
    page_abbreviation: str


@dataclass(frozen=True)
class ManualOptions:
    """What the requester chose that changes the content: Comments as an
    appendix (off by default) and the Document whose favorite image is the
    cover's, if any. `room_cover_url` is the Room's image (spec 26), the
    cover when no Document gives one; None when the requester didn't want it
    or the Room has none."""

    include_comments: bool = False
    cover_document_id: uuid.UUID | None = None
    room_cover_url: str | None = None


@dataclass(frozen=True)
class Run:
    """A piece of a paragraph. With a `target` (an anchor id) it is a link the
    template prints with its page ("Drago Rosso → p. 12"); without, plain
    text."""

    text: str
    target: str | None = None


Paragraph = Sequence[Run]

# A block of a description or a Note read as Markdown (spec 48): its leaves
# are runs, so a mention keeps its page cross-reference anywhere in it.
Block = Node[Run]


@dataclass(frozen=True)
class ManualNote:
    """A Note, printed as a subheading and its text after the description."""

    title: str
    blocks: Sequence[Block]


@dataclass(frozen=True)
class ManualComment:
    """A Comment in a Document's appendix, always one written as a Character.
    `depth` is 0 for a top-level Comment and grows by one per printed reply
    level."""

    depth: int
    author: str
    written_on: date
    paragraphs: Sequence[Paragraph]


@dataclass(frozen=True)
class ManualDocument:
    """A Document's section: its anchor is `doc-<id>`. `subtitle` is printed
    under the name (spec 28_0)."""

    id: uuid.UUID
    name: str
    image_url: str | None
    blocks: Sequence[Block]
    notes: Sequence[ManualNote]
    comments: Sequence[ManualComment]
    subtitle: str | None = None

    @property
    def anchor(self) -> str:
        """The id the section carries and every link to it points at."""
        return f"doc-{self.id}"

    @property
    def drop_cap(self) -> bool:
        """Whether the description opens with a large initial. Not when it
        opens with a member mention or a "#" that stayed: the initial would
        take the "@" or "#" and the letter after it together ("@G" over
        "ina"). Nor when it opens with anything but a paragraph (a heading,
        a list: spec 48 Decision 9)."""
        if not self.blocks or self.blocks[0].tag != "p" or not self.blocks[0].children:
            return False
        first = self.blocks[0].children[0]
        return isinstance(first, Run) and not first.text.startswith(_SIGILS)


@dataclass(frozen=True)
class ManualReference:
    """A Document printed in an earlier chapter, listed again where it also
    belongs ("→ p. 12", spec 23b Decision 1)."""

    id: uuid.UUID
    name: str

    @property
    def anchor(self) -> str:
        """The anchor of the section it points at."""
        return f"doc-{self.id}"


@dataclass(frozen=True)
class ManualChapter:
    """A chapter: one Main item, or the closing "Other" (or "Documents")
    chapter."""

    id: str
    title: str
    entries: Sequence[ManualDocument | ManualReference]

    @property
    def documents(self) -> list[ManualDocument]:
        """The Documents printed in this chapter, for the contents."""
        return [entry for entry in self.entries if isinstance(entry, ManualDocument)]


@dataclass(frozen=True)
class GlossaryEntry:
    """A printed Document in the glossary, with the names of its Tags in the
    Room's Tag order; the template prints its page."""

    id: uuid.UUID
    name: str
    tags: Sequence[str]

    @property
    def anchor(self) -> str:
        """The anchor of the Document's section."""
        return f"doc-{self.id}"


@dataclass(frozen=True)
class GlossaryLetter:
    """The entries whose name starts with `letter`, in name order. A name
    that doesn't start with a letter is under "#"."""

    letter: str
    entries: Sequence[GlossaryEntry]


@dataclass(frozen=True)
class Manual:
    """The whole PDF before it is typeset. A `single_document` manual is the
    PDF of one Document (spec 27b): no cover and no contents, its one chapter
    (titled with the Room's name) starts on page 1."""

    title: str
    game_system: str | None
    generated_on: date
    cover_image_url: str | None
    labels: ManualLabels
    chapters: Sequence[ManualChapter]
    glossary: Sequence[GlossaryLetter]
    single_document: bool = False

    @property
    def image_urls(self) -> frozenset[str]:
        """Every image the pages will ask for: the renderer fetches these and
        nothing else from the network."""
        urls = {document.image_url for chapter in self.chapters for document in chapter.documents}
        urls.add(self.cover_image_url)
        return frozenset(url for url in urls if url)


def _chosen_image(images: Sequence[ExportImage]) -> str | None:
    """The favorite image of a Document, or its first one when none is marked
    (the Documents list shows the same); None without images."""
    for image in images:
        if image.is_favorite:
            return image.url
    return images[0].url if images else None


def _trim(runs: list[Run]) -> list[Run]:
    """`runs` without the whitespace around the paragraph, and without runs
    that were only whitespace there."""
    if runs and runs[0].target is None:
        runs[0] = Run(runs[0].text.lstrip())
    if runs and runs[-1].target is None:
        runs[-1] = Run(runs[-1].text.rstrip())
    return [run for run in runs if run.text]


def _paragraphs(spans: Sequence[Span], resolve: Callable[[MentionSpan], Run]) -> list[Paragraph]:
    """`spans` as paragraphs, split at blank lines (a single line break stays
    inside its paragraph; the CSS keeps it). Mentions become runs through
    `resolve`; paragraphs with nothing but whitespace are dropped. A plain
    `#Name` in the text (written before mentions had ids, or a mention that
    doesn't resolve for the requester) loses its `#`, as a mention does."""
    paragraphs: list[list[Run]] = [[]]
    for span in spans:
        if isinstance(span, TextSpan):
            first, *rest = _PARAGRAPH_BREAK.split(_PLAIN_HASHTAG.sub("", span.text))
            if first:
                paragraphs[-1].append(Run(first))
            for piece in rest:
                paragraphs.append([Run(piece)] if piece else [])
        else:
            paragraphs[-1].append(resolve(span))
    trimmed = [_trim(paragraph) for paragraph in paragraphs]
    return [tuple(paragraph) for paragraph in trimmed if paragraph]


def _blocks(spans: Sequence[Span], resolve: Callable[[MentionSpan], Run]) -> list[Block]:
    """A description or Note text read as Markdown (spec 48): each mention
    is lifted out before parsing and comes back as its run through `resolve`
    (Decision 4), so a token never reads as a Markdown link. Inside code a
    mention is printed as its plain name. A plain `#Name` loses its `#`, as
    in `_paragraphs`. Markdown `#` headings sit under the Note titles (h3)."""
    runs: list[Run] = []
    parts: list[str] = []
    for span in spans:
        if isinstance(span, TextSpan):
            parts.append(without_placeholder_marks(_PLAIN_HASHTAG.sub("", span.text)))
        else:
            parts.append(placeholder(len(runs)))
            runs.append(resolve(span))

    def leaf(value: str) -> Run:
        return Run(
            "".join(
                runs[part].text if isinstance(part, int) else part
                for part in split_placeholders(value)
            )
        )

    return markdown_tree(
        "".join(parts), leaf=leaf, mention=lambda index: runs[index], top_heading=4
    )


def build_manual(export: Export, options: ManualOptions, labels: ManualLabels) -> Manual:
    """The manual for `export` (spec 23b Decision 1).

    One chapter per Main item in the Documents list's order, a Document that
    belongs to several printed once in the first and referenced from the
    others, the rest in a last chapter ("Other", or "Documents" when the Room
    has no Main item), then the glossary of every printed Document. A
    mention of a printed Document becomes a link; any other mention (a Tag,
    a member, a Document the PDF doesn't hold) stays plain text, so it can't
    point at something the PDF doesn't hold (Decision 3). A Tag or Document
    reads as its bare name, without the "#" (product owner, 2026-10-21); a
    member keeps its "@"."""
    all_groups = group_documents(export)
    groups = [(item, documents) for item, documents in all_groups if documents]
    first_group: dict[uuid.UUID, int] = {}
    for position, (_item, documents) in enumerate(groups):
        for document in documents:
            first_group.setdefault(document.id, position)

    def resolve(span: MentionSpan) -> Run:
        if span.kind is MentionKind.DOCUMENT and span.target_id in first_group:
            return Run(span.name, f"doc-{span.target_id}")
        return Run(f"@{span.name}" if span.kind is MentionKind.USER else span.name)

    members = {member.id: member.name or labels.unknown_member for member in export.members}
    tag_names = {tag.id: tag.name for tag in export.tags}
    chapters: list[ManualChapter] = []
    for position, (item, documents) in enumerate(groups):
        if item is None:
            title = labels.other if len(all_groups) > 1 else labels.documents
        else:
            title = " + ".join(tag_names[tag_id] for tag_id in item)
        entries: list[ManualDocument | ManualReference] = [
            (
                _manual_document(document, export, options, members, labels, resolve)
                if first_group[document.id] == position
                else ManualReference(document.id, document.name)
            )
            for document in documents
        ]
        chapters.append(ManualChapter(f"chapter-{position + 1}", title, entries))

    by_id = {document.id: document for document in export.documents}
    cover = by_id.get(options.cover_document_id) if options.cover_document_id else None
    return Manual(
        title=export.room_name,
        game_system=export.game_system,
        generated_on=export.generated_at.date(),
        cover_image_url=(_chosen_image(cover.images) if cover else None) or options.room_cover_url,
        labels=labels,
        chapters=chapters,
        glossary=_glossary(export, first_group),
    )


def build_document_manual(
    export: Export, document_id: uuid.UUID, options: ManualOptions, labels: ManualLabels
) -> Manual:
    """The PDF of one Document of `export` (spec 27b): its section exactly as
    in the Room manual, alone in a chapter titled with the Room's name, with
    no cover, contents or glossary (product owner, 2026-10-28). A mention of
    another Document reads as its bare name, since the PDF doesn't hold it;
    one of the Document itself links to its own section. `export` holds the
    Document (the caller checked the requester sees it)."""
    document = next(document for document in export.documents if document.id == document_id)

    def resolve(span: MentionSpan) -> Run:
        if span.kind is MentionKind.DOCUMENT and span.target_id == document_id:
            return Run(span.name, f"doc-{document_id}")
        return Run(f"@{span.name}" if span.kind is MentionKind.USER else span.name)

    members = {member.id: member.name or labels.unknown_member for member in export.members}
    section = _manual_document(document, export, options, members, labels, resolve)
    return Manual(
        title=document.name,
        game_system=export.game_system,
        generated_on=export.generated_at.date(),
        cover_image_url=None,
        labels=labels,
        chapters=[ManualChapter("chapter-1", export.room_name, [section])],
        glossary=[],
        single_document=True,
    )


def _sort_key(name: str) -> tuple[str, str]:
    """`name` for ordering: accents and case ignored ("Élise" next to
    "Elise"), the name itself breaking ties so the order is stable."""
    folded = unicodedata.normalize("NFKD", name.strip())
    return ("".join(c for c in folded if not unicodedata.combining(c)).casefold(), name)


def _letter(name: str) -> str:
    """The glossary letter of `name`: its first character without accents,
    upper case, or "#" when that isn't a letter."""
    first = _sort_key(name)[0][:1]
    return first.upper() if first.isalpha() else "#"


def _glossary(export: Export, printed: Mapping[uuid.UUID, int]) -> list[GlossaryLetter]:
    """Every printed Document once, by initial letter ("#" first), in name
    order (product owner, 2026-10-06: the glossary is on the Documents' names,
    not on the Tags). Each lists its Tags, which the PDF used to index."""
    by_letter: dict[str, list[GlossaryEntry]] = {}
    for document in sorted(export.documents, key=lambda document: _sort_key(document.name)):
        if document.id in printed:
            tags = [tag.name for tag in export.tags if tag.id in document.tag_ids]
            entry = GlossaryEntry(document.id, document.name, tags)
            by_letter.setdefault(_letter(document.name), []).append(entry)
    order = sorted(by_letter, key=lambda letter: (letter != "#", letter))
    return [GlossaryLetter(letter, by_letter[letter]) for letter in order]


def _manual_document(
    document: ExportDocument,
    export: Export,
    options: ManualOptions,
    members: Mapping[uuid.UUID, str],
    labels: ManualLabels,
    resolve: Callable[[MentionSpan], Run],
) -> ManualDocument:
    """One Document's section, with its Notes in the order the export has
    them and, when asked, its Comments."""
    return ManualDocument(
        id=document.id,
        name=document.name,
        subtitle=document.subtitle,
        image_url=_chosen_image(document.images),
        blocks=_blocks(document.description, resolve),
        notes=[
            ManualNote(note.title, _blocks(note.description, resolve)) for note in document.notes
        ],
        comments=(
            _comment_thread(document.comments, export, members, labels, resolve)
            if options.include_comments
            else []
        ),
    )


def _comment_thread(
    comments: Sequence[ExportComment],
    export: Export,
    members: Mapping[uuid.UUID, str],
    labels: ManualLabels,
    resolve: Callable[[MentionSpan], Run],
) -> list[ManualComment]:
    """The Comments written as a Character, depth first, replies right under
    their parent (product owner, 2026-10-06: the PDF tells the story, so a
    Comment written as oneself and a deleted one are left out). A reply to a
    Comment left out takes its place in the thread. Every reply in the export
    has its parent in it (a reply whose parent the requester can't see comes
    with no `parent_id`, so it is top level). A Comment carries the
    Character's name and, as in the Markdown export, who played it."""
    children: dict[uuid.UUID | None, list[ExportComment]] = {}
    for comment in comments:
        children.setdefault(comment.parent_id, []).append(comment)

    thread: list[ManualComment] = []

    def write(parent: uuid.UUID | None, depth: int) -> None:
        for comment in children.get(parent, []):
            character = (
                export.visible_documents.get(comment.as_character_id)
                if comment.as_character_id
                else None
            )
            if comment.deleted or character is None:
                write(comment.id, depth)
                continue
            player = members.get(comment.author_id, labels.unknown_member)
            thread.append(
                ManualComment(
                    depth=depth,
                    author=labels.played_by.format(character=character, player=player),
                    written_on=comment.created_at.date(),
                    paragraphs=_paragraphs(comment.body, resolve),
                )
            )
            write(comment.id, depth + 1)

    write(None, 0)
    return thread


def with_image_urls(manual: Manual, urls: Mapping[str, str]) -> Manual:
    """`manual` with every image link swapped for `urls[link]`; an image with
    no entry (it couldn't be fetched) is left out of its page. The job uses it
    to embed images it downloaded and downscaled for print (spec 23b)."""

    def swap(url: str | None) -> str | None:
        return urls.get(url) if url else None

    return replace(
        manual,
        cover_image_url=swap(manual.cover_image_url),
        chapters=[
            replace(
                chapter,
                entries=[
                    replace(entry, image_url=swap(entry.image_url))
                    if isinstance(entry, ManualDocument)
                    else entry
                    for entry in chapter.entries
                ],
            )
            for chapter in manual.chapters
        ],
    )

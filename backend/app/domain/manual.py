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
from app.domain.mentions import MentionKind


class ManualStyle(StrEnum):
    """The built-in looks (spec 23b Decision 4), in the order they were built.
    Each has a template `<value>.html.j2` and a stylesheet `<value>.css`."""

    GOTHIC = "gothic"
    MODERN = "modern"
    PRINT = "print"


class PageSize(StrEnum):
    """The paper sizes (Decision 5); the value is the CSS `size` keyword."""

    A4 = "A4"
    LETTER = "Letter"


_PARAGRAPH_BREAK = re.compile(r"\n[ \t]*\n\s*")


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
    deleted_comment: str
    played_by: str
    page_abbreviation: str


@dataclass(frozen=True)
class ManualOptions:
    """What the requester chose that changes the content: Comments as an
    appendix (off by default) and the Document whose favorite image is the
    cover's, if any."""

    include_comments: bool = False
    cover_document_id: uuid.UUID | None = None


@dataclass(frozen=True)
class Run:
    """A piece of a paragraph. With a `target` (an anchor id) it is a link the
    template prints with its page ("Drago Rosso → p. 12"); without, plain
    text."""

    text: str
    target: str | None = None


Paragraph = Sequence[Run]


@dataclass(frozen=True)
class ManualNote:
    """A Note, printed as a subheading and paragraphs after the description."""

    title: str
    paragraphs: Sequence[Paragraph]


@dataclass(frozen=True)
class ManualComment:
    """A Comment in a Document's appendix. `depth` is 0 for a top-level
    Comment and grows by one per reply level; a deleted one has no text."""

    depth: int
    author: str
    written_on: date
    deleted: bool
    paragraphs: Sequence[Paragraph]


@dataclass(frozen=True)
class ManualDocument:
    """A Document's section: its anchor is `doc-<id>`."""

    id: uuid.UUID
    name: str
    image_url: str | None
    paragraphs: Sequence[Paragraph]
    notes: Sequence[ManualNote]
    comments: Sequence[ManualComment]

    @property
    def anchor(self) -> str:
        """The id the section carries and every link to it points at."""
        return f"doc-{self.id}"


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
    """The whole PDF before it is typeset."""

    title: str
    game_system: str | None
    generated_on: date
    cover_image_url: str | None
    labels: ManualLabels
    chapters: Sequence[ManualChapter]
    glossary: Sequence[GlossaryLetter]

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
    `resolve`; paragraphs with nothing but whitespace are dropped."""
    paragraphs: list[list[Run]] = [[]]
    for span in spans:
        if isinstance(span, TextSpan):
            first, *rest = _PARAGRAPH_BREAK.split(span.text)
            if first:
                paragraphs[-1].append(Run(first))
            for piece in rest:
                paragraphs.append([Run(piece)] if piece else [])
        else:
            paragraphs[-1].append(resolve(span))
    trimmed = [_trim(paragraph) for paragraph in paragraphs]
    return [tuple(paragraph) for paragraph in trimmed if paragraph]


def build_manual(export: Export, options: ManualOptions, labels: ManualLabels) -> Manual:
    """The manual for `export` (spec 23b Decision 1).

    One chapter per Main item in the Documents list's order, a Document that
    belongs to several printed once in the first and referenced from the
    others, the rest in a last chapter ("Other", or "Documents" when the Room
    has no Main item), then the glossary of every printed Document. A
    mention of a printed Document becomes a link; any other mention (a Tag,
    a member, a Document the PDF doesn't hold) stays plain text, so it can't
    point at something the PDF doesn't hold (Decision 3)."""
    all_groups = group_documents(export)
    groups = [(item, documents) for item, documents in all_groups if documents]
    first_group: dict[uuid.UUID, int] = {}
    for position, (_item, documents) in enumerate(groups):
        for document in documents:
            first_group.setdefault(document.id, position)

    def resolve(span: MentionSpan) -> Run:
        if span.kind is MentionKind.DOCUMENT and span.target_id in first_group:
            return Run(span.name, f"doc-{span.target_id}")
        return Run(f"@{span.name}" if span.kind is MentionKind.USER else f"#{span.name}")

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
        cover_image_url=_chosen_image(cover.images) if cover else None,
        labels=labels,
        chapters=chapters,
        glossary=_glossary(export, first_group),
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
        image_url=_chosen_image(document.images),
        paragraphs=_paragraphs(document.description, resolve),
        notes=[
            ManualNote(note.title, _paragraphs(note.description, resolve))
            for note in document.notes
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
    """The Comments depth first, replies right under their parent. Every reply
    in the export has its parent in it (a reply whose parent the requester
    can't see comes with no `parent_id`, so it is top level). A Comment written
    as a Character carries the Character's name and, as in the Markdown export,
    who played it."""
    children: dict[uuid.UUID | None, list[ExportComment]] = {}
    for comment in comments:
        children.setdefault(comment.parent_id, []).append(comment)

    thread: list[ManualComment] = []

    def write(parent: uuid.UUID | None, depth: int) -> None:
        for comment in children.get(parent, []):
            author = members.get(comment.author_id, labels.unknown_member)
            character = (
                export.visible_documents.get(comment.as_character_id)
                if comment.as_character_id
                else None
            )
            if character is not None:
                author = labels.played_by.format(character=character, player=author)
            thread.append(
                ManualComment(
                    depth=depth,
                    author=author,
                    written_on=comment.created_at.date(),
                    deleted=comment.deleted,
                    paragraphs=[] if comment.deleted else _paragraphs(comment.body, resolve),
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

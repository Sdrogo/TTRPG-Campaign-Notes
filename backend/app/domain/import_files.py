"""Reading an import file (spec 27 Decision 7): a JSON file of spec 23 (a Room
or a single Document), a Markdown file the app exported, or a Markdown file
written by hand, all turned into the same format-independent `ImportFile`.

Everything here is pure and reads what the file says, nothing more: no id of
the file is trusted to mean anything in the target Room (`app/domain/imports.py`
decides that), no URL is fetched, and raw HTML in a text stays text (Decision
17). A file that can't be read is refused with an `ImportRefusedError`; nothing
is written by this module in any case."""

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from app.domain.errors import DomainError
from app.domain.export import SCHEMA_VERSION
from app.domain.mentions import MentionKind

MAX_FILE_BYTES = 5 * 1024 * 1024

_MARKDOWN_SPECIAL_ESCAPED = re.compile(r"\\([\\`*_\[\]<>])")


class ImportRefusedError(DomainError):
    """The import can't run as asked: an unreadable file, a limit, an empty
    choice. Answered with 422; nothing has been written."""


class ImportFileTooLargeError(DomainError):
    """A file is over `MAX_FILE_BYTES`. Answered with 413."""


class ImportCannotReplaceError(DomainError):
    """A Replace was chosen for a Document the importer doesn't manage
    (spec 27 Decision 6). Answered with 403."""


@dataclass(frozen=True)
class MentionRef:
    """A mention in the file: what it pointed at there (`key`, the source id
    of a Document, Tag or member) and the name it showed."""

    kind: MentionKind
    key: str
    name: str


Piece = str | MentionRef
Text = tuple[Piece, ...]


@dataclass(frozen=True)
class ImportNote:
    """A Note of a Document in the file."""

    title: str
    text: Text
    visibility: str | None


@dataclass(frozen=True)
class ImportImage:
    """An image link of a Document. `source_id` is the image's id in the file
    (JSON exports only): a Replace does not fetch again one the Document still
    has."""

    source_id: str | None
    url: str
    is_favorite: bool


@dataclass(frozen=True)
class ImportTag:
    """A Tag the file lists, matched to the Room's by name."""

    name: str
    category: str | None


@dataclass(frozen=True)
class ImportDocument:
    """A Document of the file. `source_id` is its id there, None for a file
    that has none. The counts are of what the import leaves out (Comments and
    PDF Attachments, Decisions 13 and 15); `has_player` is a Character's
    player link, not imported (Decision 10)."""

    source_id: str | None
    name: str
    text: Text
    visibility: str | None
    tag_names: tuple[str, ...]
    notes: tuple[ImportNote, ...]
    images: tuple[ImportImage, ...]
    comment_count: int = 0
    file_count: int = 0
    has_player: bool = False


@dataclass(frozen=True)
class ImportFile:
    """One parsed file: its name, its Documents in order, and its Tags by the
    id the file gives them (what a Tag mention points at)."""

    name: str
    documents: tuple[ImportDocument, ...]
    tags: Mapping[str, ImportTag] = field(default_factory=dict)


# --- Entry point -------------------------------------------------------------


def parse_file(name: str, data: bytes) -> ImportFile:
    """The file `name` holding `data`, read as JSON or Markdown (by its
    extension, else by its first character). 422 when it is not UTF-8, not
    one of the formats, or holds no Document; `schema_version` higher than
    this app's is refused so a newer file is never half-read."""
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise _unreadable(name) from exc
    lowered = name.lower()
    is_json = lowered.endswith(".json") or (
        not lowered.endswith((".md", ".markdown", ".txt")) and text.lstrip().startswith(("{", "["))
    )
    parsed = _parse_json(name, text) if is_json else _parse_markdown(name, text)
    if not parsed.documents:
        raise ImportRefusedError("errors.import.noDocuments", name=name)
    return parsed


def _unreadable(name: str) -> ImportRefusedError:
    """The refusal for a file that isn't in a format this import reads."""
    return ImportRefusedError("errors.import.unreadable", name=name)


def _unescape(value: str) -> str:
    """A name the Markdown export escaped, as it was."""
    return _MARKDOWN_SPECIAL_ESCAPED.sub(r"\1", value)


def _joined(pieces: Sequence[Piece]) -> Text:
    """`pieces` with neighbouring plain runs merged and empty ones dropped."""
    merged: list[Piece] = []
    for piece in pieces:
        if isinstance(piece, str):
            if not piece:
                continue
            if merged and isinstance(merged[-1], str):
                merged[-1] = merged[-1] + piece
                continue
        merged.append(piece)
    return tuple(merged)


def _clean_names(names: Sequence[str]) -> tuple[str, ...]:
    """Tag names trimmed, blanks dropped and case-insensitive repeats
    removed, in order."""
    seen: set[str] = set()
    cleaned: list[str] = []
    for raw in names:
        name = raw.strip()
        if name and name.casefold() not in seen:
            seen.add(name.casefold())
            cleaned.append(name)
    return tuple(cleaned)


# --- JSON --------------------------------------------------------------------


def _parse_json(name: str, text: str) -> ImportFile:
    """A JSON file of spec 23: an object with `documents` (or just the list of
    Documents). Extra fields are ignored and ids are optional."""
    try:
        data = json.loads(text)
    except (ValueError, RecursionError) as exc:
        raise _unreadable(name) from exc
    if isinstance(data, list):
        raw_documents: Any = data
        raw_tags: Any = []
    elif isinstance(data, dict):
        version = data.get("schema_version", SCHEMA_VERSION)
        if not isinstance(version, int) or isinstance(version, bool):
            raise _unreadable(name)
        if version > SCHEMA_VERSION:
            raise ImportRefusedError(
                "errors.import.unsupportedSchema", name=name, version=version, max=SCHEMA_VERSION
            )
        raw_documents = data.get("documents")
        raw_tags = data.get("tags", [])
    else:
        raise _unreadable(name)
    if not isinstance(raw_documents, list) or not isinstance(raw_tags, list):
        raise _unreadable(name)

    tags: dict[str, ImportTag] = {}
    for raw in raw_tags:
        item = _object(raw, name)
        tag_name = _optional_str(item.get("name"), name)
        tag_id = _optional_str(item.get("id"), name)
        if tag_name and tag_name.strip() and tag_id:
            tags[tag_id] = ImportTag(tag_name.strip(), _optional_str(item.get("category"), name))
    documents = tuple(_json_document(_object(raw, name), name, tags) for raw in raw_documents)
    return ImportFile(name, documents, tags)


def _object(value: Any, name: str) -> dict[str, Any]:
    """`value` as an object, else the file is unreadable."""
    if not isinstance(value, dict):
        raise _unreadable(name)
    return value


def _optional_str(value: Any, name: str) -> str | None:
    """A string field, None when absent; anything else is unreadable."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    raise _unreadable(name)


def _list(value: Any, name: str) -> list[Any]:
    """A list field, empty when absent; anything else is unreadable."""
    if value is None:
        return []
    if not isinstance(value, list):
        raise _unreadable(name)
    return value


def _json_text(value: Any, name: str) -> Text:
    """A description or body: a string, or the export's list of text and
    mention spans. A mention of an unknown kind stays its plain name."""
    if value is None:
        return ()
    if isinstance(value, str):
        return _joined([value])
    pieces: list[Piece] = []
    for raw in _list(value, name):
        if isinstance(raw, str):
            pieces.append(raw)
            continue
        span = _object(raw, name)
        if span.get("type") == "mention":
            kind = _mention_kind(span.get("kind"))
            label = _optional_str(span.get("name"), name) or ""
            key = _optional_str(span.get("target_id"), name)
            if kind is None or key is None:
                pieces.append(label)
            else:
                pieces.append(MentionRef(kind, key, label))
        else:
            pieces.append(_optional_str(span.get("text"), name) or "")
    return _joined(pieces)


def _mention_kind(value: Any) -> MentionKind | None:
    """The kind a span names, or None for one this app doesn't know."""
    try:
        return MentionKind(value)
    except ValueError:
        return None


def _json_document(raw: dict[str, Any], name: str, tags: Mapping[str, ImportTag]) -> ImportDocument:
    """One Document object of the file."""
    tag_names: list[str] = []
    for tag_id in _list(raw.get("tag_ids"), name):
        known = tags.get(str(tag_id))
        if known is not None:
            tag_names.append(known.name)
    notes = tuple(
        ImportNote(
            title=_optional_str(item.get("title"), name) or "",
            text=_json_text(item.get("description"), name),
            visibility=_optional_str(item.get("visibility"), name),
        )
        for item in (_object(note, name) for note in _list(raw.get("notes"), name))
    )
    images = []
    for item in (_object(image, name) for image in _list(raw.get("images"), name)):
        url = _optional_str(item.get("url"), name)
        if url:
            images.append(
                ImportImage(
                    _optional_str(item.get("id"), name), url, item.get("is_favorite") is True
                )
            )
    return ImportDocument(
        source_id=_optional_str(raw.get("id"), name),
        name=(_optional_str(raw.get("name"), name) or "").strip(),
        text=_json_text(raw.get("description"), name),
        visibility=_optional_str(raw.get("visibility"), name),
        tag_names=_clean_names(tag_names),
        notes=notes,
        images=tuple(images),
        comment_count=len(_list(raw.get("comments"), name)),
        file_count=len(_list(raw.get("files"), name)),
        has_player=raw.get("played_by") is not None,
    )


# --- Markdown ----------------------------------------------------------------

_DOC_HEADING = re.compile(r'^### <a id="doc-([0-9a-fA-F-]{36})"></a>(.*)$')
_TAG_ITEM = re.compile(r'^- <a id="tag-([0-9a-fA-F-]{36})"></a>(.*)$')
_FACT = re.compile(r"^- (Visibility|Tags|Owners|Played by|Shared with): ?(.*)$")
_MENTION_LINK = re.compile(r"\[((?:\\.|[^\]\\])*)\]\(#(doc|tag)-([0-9a-fA-F-]{36})\)")
_IMAGE_ITEM = re.compile(r"^- !\[[^\]]*\]\((.+)\)\s*$")
_IMAGE_LINE = re.compile(r"^!\[[^\]]*\]\((\S+)\)\s*$")
_CATEGORY = re.compile(r"^(.*) \((.*)\)$")
_COMMENT_ITEM = re.compile(r"^\s*- \*\*")
_MARKERS = {"**Images**", "**Files**", "**Notes**", "**Comments**"}
_FENCE = re.compile(r"^\s*(```|~~~)")


def _parse_markdown(name: str, text: str) -> ImportFile:
    """A Markdown file: the layout the app exports when it holds the export's
    Document anchors, else the hand-written one (every `#` heading a
    Document)."""
    lines = text.splitlines()
    if any(_DOC_HEADING.match(line) for line in lines):
        return _exported_markdown(name, lines)
    return ImportFile(name, _handwritten_markdown(lines))


def _exported_markdown(name: str, lines: list[str]) -> ImportFile:
    """The app's own Markdown export (spec 23 layout), read best effort: the
    Tags list, then each Document's facts, description, images, Notes. A
    Document's section runs to the next Document or group heading."""
    tags: dict[str, ImportTag] = {}
    known_names: set[str] = set()
    for line in lines:
        item = _TAG_ITEM.match(line)
        if item:
            raw = item.group(2)
            category = _CATEGORY.match(raw)
            label, group = (category.group(1), category.group(2)) if category else (raw, None)
            tags[item.group(1)] = ImportTag(_unescape(label).strip(), group and _unescape(group))
            known_names.add(label)

    documents: list[ImportDocument] = []
    starts = [i for i, line in enumerate(lines) if _DOC_HEADING.match(line)]
    for position, start in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else len(lines)
        for index in range(start + 1, end):
            if lines[index].startswith("## "):
                end = index
                break
        heading = _DOC_HEADING.match(lines[start])
        assert heading is not None
        documents.append(
            _exported_document(
                heading.group(1), heading.group(2), lines[start + 1 : end], known_names
            )
        )
    return ImportFile(name, tuple(documents), tags)


def _exported_document(
    source_id: str, heading_name: str, body: list[str], known_names: set[str]
) -> ImportDocument:
    """One Document section of the app's Markdown export."""
    index = 0
    facts: dict[str, str] = {}
    while index < len(body) and not body[index].strip():
        index += 1
    while index < len(body):
        fact = _FACT.match(body[index])
        if fact is None:
            break
        facts[fact.group(1)] = fact.group(2)
        index += 1

    mode = "body"
    description: list[str] = []
    images: list[ImportImage] = []
    notes: list[tuple[str, list[str]]] = []
    files = comments = 0
    for line in body[index:]:
        if line in _MARKERS:
            mode = line.strip("*").lower()
        elif mode == "body":
            description.append(line)
        elif mode == "images":
            image = _IMAGE_ITEM.match(line)
            if image:
                images.append(ImportImage(None, image.group(1), False))
        elif mode == "files":
            files += line.startswith("- ")
        elif mode == "notes":
            if line.startswith("#### "):
                notes.append((_unescape(line[5:]).strip(), []))
            elif notes:
                notes[-1][1].append(line)
        elif _COMMENT_ITEM.match(line):
            comments += 1

    return ImportDocument(
        source_id=source_id,
        name=_unescape(heading_name).strip(),
        text=_markdown_text("\n".join(description)),
        visibility=facts.get("Visibility", "").strip() or None,
        tag_names=_clean_names(
            [_unescape(n) for n in _split_names(facts.get("Tags", ""), known_names)]
        ),
        notes=tuple(
            ImportNote(title, _markdown_text("\n".join(note_lines)), None)
            for title, note_lines in notes
        ),
        images=tuple(images),
        comment_count=comments,
        file_count=files,
        has_player="Played by" in facts,
    )


def _split_names(value: str, known: set[str]) -> list[str]:
    """The names in a "Tags:" fact, joined by ", ". A name that holds ", "
    itself is told apart by the Tags list of the file: the longest known name
    that fits wins, else the text up to the next ", " is a name."""
    names: list[str] = []
    rest = value.strip()
    while rest:
        fitting = [
            k
            for k in known
            if rest.startswith(k) and (len(rest) == len(k) or rest[len(k) :].startswith(", "))
        ]
        if fitting:
            best = max(fitting, key=len)
            names.append(best)
            rest = rest[len(best) + 2 :]
        else:
            piece, _, rest = rest.partition(", ")
            names.append(piece)
    return names


def _markdown_text(text: str) -> Text:
    """A description or Note body of the app's Markdown export: its links to
    Documents (`[Name](#doc-<id>)`) and Tags (`[#Name](#tag-<id>)`) become
    mentions, the rest stays as written."""
    text = text.strip()
    pieces: list[Piece] = []
    last = 0
    for match in _MENTION_LINK.finditer(text):
        pieces.append(text[last : match.start()])
        label = _unescape(match.group(1))
        if match.group(2) == "doc":
            pieces.append(MentionRef(MentionKind.DOCUMENT, match.group(3), label))
        else:
            pieces.append(MentionRef(MentionKind.TAG, match.group(3), label.removeprefix("#")))
        last = match.end()
    pieces.append(text[last:])
    return _joined(pieces)


def _handwritten_markdown(lines: list[str]) -> tuple[ImportDocument, ...]:
    """A hand-written file: each `#` heading is a Document and the text up to
    the next one its description; each `##` heading under it a Note (title and
    text); an optional first line `Tags: a, b` sets the Tags and a line that
    holds only `![...](url)` is an image of the Document. Headings inside a
    code fence are text. Nothing else is interpreted."""
    documents: list[dict[str, Any]] = []
    in_fence = False
    for line in lines:
        if _FENCE.match(line):
            in_fence = not in_fence
        heading = None if in_fence else re.match(r"^(#{1,2}) +(.+?)\s*$", line)
        if heading and heading.group(1) == "#":
            documents.append(
                {"name": heading.group(2), "lines": [], "notes": [], "images": [], "tags": None}
            )
        elif documents and heading:
            documents[-1]["notes"].append((heading.group(2), []))
        elif documents:
            current = documents[-1]
            image = None if in_fence else _IMAGE_LINE.match(line)
            tags = (
                re.match(r"^Tags:\s*(.*)$", line, re.IGNORECASE)
                if not in_fence
                and current["tags"] is None
                and not current["notes"]
                and not any(current["lines"])
                and line.strip()
                else None
            )
            if image:
                current["images"].append(ImportImage(None, image.group(1), False))
            elif tags:
                current["tags"] = tags.group(1).split(",")
            elif current["notes"]:
                current["notes"][-1][1].append(line)
            else:
                current["lines"].append(line)
    return tuple(
        ImportDocument(
            source_id=None,
            name=document["name"],
            text=_joined(["\n".join(document["lines"]).strip()]),
            visibility=None,
            tag_names=_clean_names(document["tags"] or []),
            notes=tuple(
                ImportNote(title, _joined(["\n".join(body).strip()]), None)
                for title, body in document["notes"]
            ),
            images=tuple(document["images"]),
        )
        for document in documents
    )


# --- The stored form of a parsed file (the import job's payload) --------------


def _text_to_json(text: Text) -> list[Any]:
    """`text` as plain JSON: strings and `[kind, key, name]` mentions."""
    return [p if isinstance(p, str) else [p.kind.value, p.key, p.name] for p in text]


def _text_from_json(data: list[Any]) -> Text:
    """The inverse of `_text_to_json`."""
    return tuple(
        p if isinstance(p, str) else MentionRef(MentionKind(p[0]), p[1], p[2]) for p in data
    )


def file_to_json(file: ImportFile) -> dict[str, Any]:
    """A parsed file as plain JSON, for the job row: the parsed content only,
    never the uploaded bytes (Decision 17)."""
    return {
        "name": file.name,
        "tags": {key: [tag.name, tag.category] for key, tag in file.tags.items()},
        "documents": [
            {
                "source_id": d.source_id,
                "name": d.name,
                "text": _text_to_json(d.text),
                "visibility": d.visibility,
                "tag_names": list(d.tag_names),
                "notes": [[n.title, _text_to_json(n.text), n.visibility] for n in d.notes],
                "images": [[i.source_id, i.url, i.is_favorite] for i in d.images],
                "comment_count": d.comment_count,
                "file_count": d.file_count,
                "has_player": d.has_player,
            }
            for d in file.documents
        ],
    }


def file_from_json(data: dict[str, Any]) -> ImportFile:
    """The inverse of `file_to_json`."""
    return ImportFile(
        name=data["name"],
        tags={key: ImportTag(tag[0], tag[1]) for key, tag in data["tags"].items()},
        documents=tuple(
            ImportDocument(
                source_id=d["source_id"],
                name=d["name"],
                text=_text_from_json(d["text"]),
                visibility=d["visibility"],
                tag_names=tuple(d["tag_names"]),
                notes=tuple(ImportNote(n[0], _text_from_json(n[1]), n[2]) for n in d["notes"]),
                images=tuple(ImportImage(i[0], i[1], i[2]) for i in d["images"]),
                comment_count=d["comment_count"],
                file_count=d["file_count"],
                has_player=d["has_player"],
            )
            for d in data["documents"]
        ),
    )

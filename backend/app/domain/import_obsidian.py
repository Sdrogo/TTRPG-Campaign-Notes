"""Reading Obsidian notes (spec 65): a translation layer from Obsidian
Markdown to the same `ImportFile` the rest of the import reads.

One note is one Document, named after its file. Wikilinks between the notes
of the same set become mentions (resolved when the import is planned, by
name), front matter and inline `#tags` become Tags, and the Obsidian-only
syntax (`%%comments%%`, `==highlights==`, `^block-ids`, callout markers) is
cleaned. Everything is pure: the bytes of the notes in, a parsed file out. No
file is fetched and nothing is written."""

import re
from collections.abc import Sequence

from app.domain.import_files import (
    OBSIDIAN_KEY_PREFIX as KEY_PREFIX,
)
from app.domain.import_files import (
    ImportDocument,
    ImportFile,
    ImportRefusedError,
    MentionRef,
    Piece,
    Text,
    _joined,
)
from app.domain.mentions import MentionKind

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif")
# Folders Obsidian keeps its own data in; never read.
_HIDDEN_PARTS = (".obsidian", ".trash")

_FRONT_MATTER = re.compile(
    r"\A---[ \t]*\r?\n(.*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|\Z)", re.DOTALL
)
_OBSIDIAN_SIGN = re.compile(r"\[\[[^\]\n]+\]\]|^\s*>\s*\[![\w-]+\]|%%", re.MULTILINE)
_EXPORT_ANCHOR = re.compile(r'<a id="doc-')
_WIKILINK = re.compile(r"(!?)\[\[([^\]\n]+?)\]\]")
_MD_IMAGE = re.compile(r"!\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
_INLINE_TAG = re.compile(r"(?<![\w#&/\\\[(])#([\w][\w/\-]*)")
_FENCE = re.compile(r"^\s*(```|~~~)")
_INLINE_CODE = re.compile(r"(`+)(?:(?!\1).)+?\1")
_HIGHLIGHT = re.compile(r"==(?=\S)(.+?)(?<=\S)==")
_BLOCK_ID = re.compile(r"[ \t]+\^[\w-]+[ \t]*$", re.MULTILINE)
_CALLOUT = re.compile(r"^(\s*>\s*)\[!([\w-]+)\][+-]?[ \t]*(.*)$")


def folded_key(name: str) -> str:
    """The key a note is known by: its name, case and edge spaces ignored."""
    return KEY_PREFIX + name.strip().casefold()


def is_obsidian(text: str) -> bool:
    """Whether a Markdown text reads as an Obsidian note: it opens with front
    matter or holds an Obsidian-only sign, and is not the app's own export."""
    if _EXPORT_ANCHOR.search(text):
        return False
    return bool(_FRONT_MATTER.match(text) or _OBSIDIAN_SIGN.search(text))


def is_hidden(path: str) -> bool:
    """Whether `path` is inside a folder Obsidian keeps for itself, or a
    hidden file."""
    parts = [p for p in path.replace("\\", "/").split("/") if p]
    return any(p in _HIDDEN_PARTS or p.startswith(".") for p in parts)


def _stem(path: str) -> str:
    """A note's name: its file name without the extension."""
    base = path.replace("\\", "/").rsplit("/", 1)[-1]
    return base.rsplit(".", 1)[0] if "." in base else base


def _folder(path: str) -> str | None:
    """The name of the folder a note sits in, if any."""
    parts = [p for p in path.replace("\\", "/").split("/") if p]
    return parts[-2] if len(parts) >= 2 else None


# --- Front matter ---------------------------------------------------------------


def _front_matter(text: str) -> tuple[dict[str, list[str]], str]:
    """The `tags` and `aliases` of a note's front matter, and the text after
    it. A small reader of the YAML Obsidian writes (inline lists, block lists,
    comma or space separated strings); any other key is ignored."""
    match = _FRONT_MATTER.match(text)
    if match is None:
        return {}, text
    values: dict[str, list[str]] = {}
    current: str | None = None
    for line in (match.group(1) or "").splitlines():
        item = re.match(r"^\s+-\s*(.*)$", line) or re.match(r"^-\s*(.*)$", line)
        key = re.match(r"^(tags?|aliases|alias)\s*:\s*(.*)$", line, re.IGNORECASE)
        if key:
            name = "tags" if key.group(1).lower().startswith("tag") else "aliases"
            current = name
            values.setdefault(name, [])
            values[name].extend(_scalar_list(key.group(2), name == "tags"))
        elif item and current:
            values[current].extend(_scalar_list(item.group(1), False))
        elif not item:
            current = None
    return values, text[match.end() :]


def _scalar_list(raw: str, tags: bool) -> list[str]:
    """A YAML value as a list of strings: an inline list `[a, b]`, or one value.
    Tags in a plain string are separated by commas or spaces (Obsidian allows
    `tags: a b`); an alias is never split on spaces or on a comma outside a
    list."""
    raw = raw.strip()
    if not raw:
        return []
    if raw.startswith("[") and raw.endswith("]"):
        parts = raw[1:-1].split(",")
    elif tags:
        parts = re.split(r"[,\s]+", raw)
    else:
        parts = [raw]
    return [p.strip().strip("'\"").lstrip("#") for p in parts if p.strip().strip("'\"")]


# --- Text -------------------------------------------------------------------------


def _split_code(line: str) -> list[tuple[str, bool]]:
    """`line` as (text, is_code) runs, so inline code is left alone."""
    runs: list[tuple[str, bool]] = []
    last = 0
    for match in _INLINE_CODE.finditer(line):
        if match.start() > last:
            runs.append((line[last : match.start()], False))
        runs.append((match.group(0), True))
        last = match.end()
    if last < len(line):
        runs.append((line[last:], False))
    return runs or [("", False)]


def _translate(body: str, index: dict[str, str]) -> tuple[Text, list[str], int]:
    """A note's body in the app's form: the text with its wikilinks as
    mentions, the inline Tags it uses and how many embeds (images, files) could
    not be kept. `index` holds the notes of the set by folded name or alias."""
    pieces: list[Piece] = []
    tags: list[str] = []
    dropped = 0
    in_fence = False
    in_comment = False
    lines = body.split("\n")
    for position, line in enumerate(lines):
        if not in_fence:
            line, in_comment = _strip_comments(line, in_comment)
        if _FENCE.match(line):
            in_fence = not in_fence
            pieces.append(line)
        elif in_fence:
            pieces.append(line)
        else:
            callout = _CALLOUT.match(line)
            if callout:
                line = callout.group(1) + (callout.group(3) or callout.group(2).capitalize())
            line = _BLOCK_ID.sub("", line)
            for chunk, is_code in _split_code(line):
                if is_code:
                    pieces.append(chunk)
                    continue
                chunk = _HIGHLIGHT.sub(r"\1", chunk)
                for found in _INLINE_TAG.finditer(chunk):
                    name = found.group(1).split("/")[-1]
                    if name and not name.isdigit():
                        tags.append(name)
                chunk, removed = _drop_images(chunk)
                dropped += removed
                _wikilinks(chunk, index, pieces)
        if position < len(lines) - 1:
            pieces.append("\n")
    return _joined(pieces), tags, dropped


def _strip_comments(line: str, inside: bool) -> tuple[str, bool]:
    """`line` without its `%%comments%%`, and whether a comment is still open at
    its end (they may span lines). Never called inside a code fence."""
    kept: list[str] = []
    for index, part in enumerate(line.split("%%")):
        if index:
            inside = not inside
        if not inside:
            kept.append(part)
    return "".join(kept), inside


def _drop_images(chunk: str) -> tuple[str, int]:
    """`chunk` without its `![alt](relative/path)` images (counted); a link to
    an `http(s)` address stays as written."""
    count = 0

    def keep(match: re.Match[str]) -> str:
        nonlocal count
        if match.group(1).lower().startswith(("http://", "https://")):
            return match.group(0)
        count += 1
        return ""

    return _MD_IMAGE.sub(keep, chunk), count


def _wikilinks(chunk: str, index: dict[str, str], pieces: list[Piece]) -> None:
    """Appends `chunk` to `pieces`, each `[[Note|alias]]` a mention of the note
    (or of the Room's Document of that name, decided when the import is
    planned), and each `![[...]]` of a picture or file dropped."""
    last = 0
    for match in _WIKILINK.finditer(chunk):
        pieces.append(chunk[last : match.start()])
        last = match.end()
        embed = match.group(1) == "!"
        target, _, alias = match.group(2).partition("|")
        page = re.split(r"[#^]", target, maxsplit=1)[0].strip().rsplit("/", 1)[-1].strip()
        if embed and page.lower().endswith(IMAGE_EXTENSIONS + (".pdf", ".mp3", ".mp4")):
            pieces.append("\x00embed")  # counted by the caller
            continue
        label = alias.strip() or page or target.strip()
        if not page:  # [[#Heading]]: a link inside the note
            pieces.append(label)
            continue
        key = index.get(page.casefold(), folded_key(page))
        pieces.append(MentionRef(MentionKind.DOCUMENT, key, label))
    pieces.append(chunk[last:])


def _count_embeds(text: Text) -> tuple[Text, int]:
    """`text` without the embed markers `_wikilinks` left, and how many."""
    count = 0
    cleaned: list[Piece] = []
    for piece in text:
        if isinstance(piece, str) and "\x00embed" in piece:
            count += piece.count("\x00embed")
            piece = piece.replace("\x00embed", "")
        cleaned.append(piece)
    return _joined(cleaned), count


# --- The set of notes ---------------------------------------------------------------


def parse_notes(
    notes: Sequence[tuple[str, bytes]], *, folders_as_tags: bool = True, name: str = "vault"
) -> ImportFile:
    """The notes `(path, bytes)` of an Obsidian vault (or just some files of
    one) as one `ImportFile`: a Document each, in path order, named after its
    file. A file that is not UTF-8 is refused (422), as for any import; hidden
    folders (`.obsidian`, `.trash`) are never read. The links between the notes
    are resolved here by name (and by front matter alias); the ones to a name
    the set lacks are left for the planner, which looks in the Room."""
    texts: list[tuple[str, str]] = []
    for path, data in sorted(notes):
        if is_hidden(path) or not path.lower().endswith((".md", ".markdown")):
            continue
        try:
            texts.append((path, data.decode("utf-8-sig")))
        except UnicodeDecodeError as exc:
            raise ImportRefusedError("errors.import.unreadable", name=path[-200:]) from exc

    parsed = [(path, *_front_matter(text)) for path, text in texts]
    index: dict[str, str] = {}
    keys: list[str] = []
    seen: dict[str, int] = {}
    for path, meta, _ in parsed:
        stem = _stem(path)
        base = folded_key(stem)
        seen[base] = seen.get(base, 0) + 1
        key = base if seen[base] == 1 else f"{base}#{seen[base]}"
        keys.append(key)
        index.setdefault(stem.strip().casefold(), base)
        for alias in meta.get("aliases", []):
            index.setdefault(alias.strip().casefold(), base)

    documents: list[ImportDocument] = []
    for (path, meta, body), key in zip(parsed, keys, strict=True):
        text, inline_tags, images = _translate(body.strip("\n"), index)
        text, embeds = _count_embeds(text)
        tag_names = [t.split("/")[-1] for t in meta.get("tags", [])] + inline_tags
        folder = _folder(path) if folders_as_tags else None
        if folder:
            tag_names.append(folder)
        documents.append(
            ImportDocument(
                source_id=key,
                name=_stem(path).strip(),
                text=text,
                visibility=None,
                tag_names=_dedupe(tag_names),
                notes=(),
                images=(),
                dropped_embeds=images + embeds,
                match_by_name=True,
            )
        )
    return ImportFile(name, tuple(documents))


def _dedupe(names: Sequence[str]) -> tuple[str, ...]:
    """Tag names trimmed, blanks dropped and case-insensitive repeats removed,
    in order."""
    seen: set[str] = set()
    out: list[str] = []
    for raw in names:
        cleaned = raw.strip()
        if cleaned and cleaned.casefold() not in seen:
            seen.add(cleaned.casefold())
            out.append(cleaned)
    return tuple(out)


def parse_uploads(
    uploads: Sequence[tuple[str, bytes]], *, obsidian: bool | None = None
) -> list[ImportFile]:
    """The uploaded files `(name, bytes)` as parsed files (spec 65 Decision 2).
    Markdown files that read as Obsidian notes (or all of them when `obsidian`
    is true, none when false) are read together as one set, so their wikilinks
    find each other; the set takes the place of its first file. Everything else
    goes through `parse_file` as before."""
    from app.domain.import_files import parse_file

    notes: list[tuple[str, bytes]] = []
    slots: list[ImportFile | None] = []
    for name, data in uploads:
        lowered = name.lower()
        if lowered.endswith((".md", ".markdown")) and obsidian is not False:
            try:
                text = data.decode("utf-8-sig")
            except UnicodeDecodeError as exc:
                raise ImportRefusedError("errors.import.unreadable", name=name) from exc
            if obsidian or is_obsidian(text):
                if not notes:
                    slots.append(None)
                notes.append((name, data))
                continue
        slots.append(parse_file(name, data))
    if not notes:
        return [slot for slot in slots if slot is not None]
    vault = parse_notes(notes)
    if not vault.documents:
        raise ImportRefusedError("errors.import.noDocuments", name=notes[0][0])
    return [vault if slot is None else slot for slot in slots]

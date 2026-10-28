"""Markdown in Document descriptions and Note texts (spec 48).

The text is stored as written, mention tokens included. These helpers read
it: as a tree of blocks for the Room PDF, as plain words for search excerpts,
and as the ranges where a name must not be linked (code, links). Raw HTML in
the text is never passed through: markdown-it reads it as text (Decision 3).

Pure functions; markdown-it-py does the parsing."""

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from markdown_it import MarkdownIt
from markdown_it.tree import SyntaxTreeNode

from app.domain.mentions import find_mentions

# CommonMark plus the GitHub tables and strikethrough the app shows
# (Decision 2); a single line break is a line break, so text written before
# spec 48 reads as it did.
_PARSER = MarkdownIt("commonmark", {"breaks": True, "html": False}).enable(
    ["table", "strikethrough"]
)

# Each lifted mention stands in the text as a placeholder of private-use
# characters, which Markdown reads as an ordinary word (Decision 4).
_OPEN = ""
_CLOSE = ""
_PLACEHOLDER = re.compile(f"{_OPEN}(\\d+){_CLOSE}")

# Only these addresses are links (Decision 3).
_SAFE_URL = re.compile(r"^(https?://|mailto:)", re.IGNORECASE)


def placeholder(index: int) -> str:
    """The placeholder standing for the `index`th lifted mention."""
    return f"{_OPEN}{index}{_CLOSE}"


def without_placeholder_marks(text: str) -> str:
    """`text` without the placeholder characters, so one the writer pasted
    never reads as a lifted mention."""
    return text.replace(_OPEN, "").replace(_CLOSE, "")


def split_placeholders(text: str) -> list[str | int]:
    """`text` split into plain runs and the indexes of its placeholders."""
    parts: list[str | int] = []
    last = 0
    for match in _PLACEHOLDER.finditer(text):
        if match.start() > last:
            parts.append(text[last : match.start()])
        parts.append(int(match.group(1)))
        last = match.end()
    if last < len(text):
        parts.append(without_placeholder_marks(text[last:]))
    return parts


def safe_url(url: str) -> str | None:
    """`url` when it may be a link (http, https or mailto), else None."""
    url = url.strip()
    return url if _SAFE_URL.match(url) else None


@dataclass(frozen=True)
class Node[T]:
    """A Markdown element. `tag` is an HTML tag name (headings already
    scaled down, see `markdown_tree`); `children` are elements and leaves
    (`T`, e.g. the PDF's runs); `href` is set on a safe link only."""

    tag: str
    children: tuple["Node[T] | T", ...] = ()
    href: str | None = None


# Inline and block markdown-it node types and the tag each becomes.
_TAGS = {
    "paragraph": "p",
    "bullet_list": "ul",
    "ordered_list": "ol",
    "list_item": "li",
    "blockquote": "blockquote",
    "table": "table",
    "thead": "thead",
    "tbody": "tbody",
    "tr": "tr",
    "th": "th",
    "td": "td",
    "strong": "strong",
    "em": "em",
    "s": "s",
    "hr": "hr",
    "softbreak": "br",
    "hardbreak": "br",
}


def markdown_tree[T](
    source: str, leaf: Callable[[str], T], mention: Callable[[int], T], top_heading: int
) -> list[Node[T]]:
    """`source` (a text whose mentions were swapped for `placeholder`s) as
    blocks. Text becomes leaves through `leaf`, a placeholder through
    `mention`; inside code a placeholder is left to `leaf` as is, for the
    caller to show as written. `#` becomes an `h<top_heading>`, each further
    `#` one level lower down to h6 (Decision 5). A link to an address that
    isn't safe is a plain span; an image is a link to it, never loaded."""

    def text(value: str, in_code: bool) -> list[Node[T] | T]:
        if in_code:
            return [leaf(value)]
        return [
            mention(part) if isinstance(part, int) else leaf(part)
            for part in split_placeholders(value)
        ]

    def convert(node: SyntaxTreeNode, in_code: bool = False) -> list[Node[T] | T]:
        kind = node.type
        if kind == "text":
            return text(node.content, in_code)
        if kind == "code_inline":
            return [Node("code", tuple(text(node.content, True)))]
        if kind in ("fence", "code_block"):
            return [Node("pre", (Node("code", tuple(text(node.content.rstrip("\n"), True))),))]
        children = tuple(item for child in node.children for item in convert(child, in_code))
        if kind == "root":
            return list(children)
        if kind == "inline":
            return list(children)
        if kind == "heading":
            level = min(int(node.tag[1]) + top_heading - 1, 6)
            return [Node(f"h{level}", children)]
        if kind == "paragraph" and node.hidden:
            # A tight list item's paragraph: just its words.
            return list(children)
        if kind == "link":
            href = safe_url(str(node.attrs.get("href", "")))
            return [Node("a", children, href) if href else Node("span", children)]
        if kind == "image":
            href = safe_url(str(node.attrs.get("src", "")))
            label = children or tuple(text(href or "", in_code))
            return [Node("a", label, href) if href else Node("span", label)]
        tag = _TAGS.get(kind)
        return [Node(tag, children)] if tag else list(children)

    tree = SyntaxTreeNode(_PARSER.parse(source))
    return [node for node in convert(tree) if isinstance(node, Node)]


def markdown_plain(text: str) -> str:
    """The words of `text` without its Markdown signs (Decision 6), blocks
    joined by a space: `**Drakon**` reads `Drakon`, a link its text. Mention
    tokens (`#[Name](doc:<uuid>)`) are kept as written."""
    tokens: list[str] = []
    parts: list[str] = []
    last = 0
    for found in find_mentions(text):
        parts.append(without_placeholder_marks(text[last : found.start]))
        parts.append(placeholder(len(tokens)))
        tokens.append(text[found.start : found.end])
        last = found.end
    parts.append(text[last:])

    words: list[str] = []

    def collect(nodes: Sequence[Node[str] | str]) -> None:
        for node in nodes:
            if isinstance(node, str):
                words.append(node)
            elif node.tag == "br":
                words.append(" ")
            else:
                if node.tag in _BLOCKS:
                    words.append(" ")
                collect(node.children)
                if node.tag in _BLOCKS:
                    words.append(" ")

    collect(
        markdown_tree(
            "".join(parts),
            leaf=lambda value: _PLACEHOLDER.sub(lambda m: tokens[int(m.group(1))], value),
            mention=lambda index: tokens[index],
            top_heading=1,
        )
    )
    return re.sub(r"\s+", " ", "".join(words)).strip()


_BLOCKS = frozenset(
    {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "tr", "th", "td", "hr"}
)

# --- Where a name must not be linked (Decision 11) ---------------------------

_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_INLINE_CODE = re.compile(r"(`+)(?!`).+?(?<!`)\1(?!`)", re.DOTALL)
# The address may hold one level of brackets, as in a Wikipedia link.
_LINK = re.compile(r"!?\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\)")
_AUTOLINK = re.compile(r"<(?:https?://|mailto:)[^>\s]*>|\bhttps?://[^\s<>()]+", re.IGNORECASE)


def protected_ranges(text: str) -> list[tuple[int, int]]:
    """The `(start, end)` ranges of `text` where a name is never linked:
    fenced code blocks, inline code, Markdown links and images (their text
    and address) and bare addresses. Sorted and merged."""
    ranges: list[tuple[int, int]] = []
    offset = 0
    fence: str | None = None
    fence_start = 0
    for line in text.splitlines(keepends=True):
        opening = _FENCE.match(line)
        if fence is None and opening:
            fence, fence_start = opening.group(1)[0] * 3, offset
        elif fence is not None and opening and opening.group(1).startswith(fence):
            ranges.append((fence_start, offset + len(line)))
            fence = None
        offset += len(line)
    if fence is not None:
        ranges.append((fence_start, len(text)))
    for pattern in (_INLINE_CODE, _LINK, _AUTOLINK):
        ranges += [(match.start(), match.end()) for match in pattern.finditer(text)]
    return merge_ranges(ranges)


def merge_ranges(ranges: Sequence[tuple[int, int]]) -> list[tuple[int, int]]:
    """`ranges` sorted, the overlapping and touching ones joined."""
    merged: list[tuple[int, int]] = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged

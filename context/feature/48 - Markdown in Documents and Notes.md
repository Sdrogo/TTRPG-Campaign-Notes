# 48 - Markdown in Documents and Notes

## Goals

- Product owner's request (2026-10-28, translated): "I'd like the
  Documents and Notes we have in the app to support the Markdown format."
- A Document's description and a Note's text are read as **Markdown**:
  headings, bold and italics, lists, quotes, links, tables, code. Wherever
  the app shows that text in full (the Document page, the split view, the
  Session 0 DDI step, the PDF) it shows it formatted.
- `requirements.md` FR-D1 already says "description (rich text or
  Markdown)": this ticket builds it and adds no new requirement. The
  stored text does not change form (still a plain string with the
  mention tokens of spec 20), so **no migration** and no change to the
  API, the JSON export or the History.

## Decisions (defaults picked 2026-10-28, confirmed by the product owner the same day)

1. **Which texts**: Document descriptions and Note texts. Not Comments
   (spec 19, short chat-like replies, with `@` member mentions), not the
   subtitle, not Room descriptions, not Session 0 post-its (*proposed*;
   Comments can follow in a later ticket).
2. **Syntax**: CommonMark plus the GitHub extras people know (tables,
   ~~strikethrough~~, `- [ ]` task lists shown as read-only checkboxes,
   bare URLs as links). **A single line break stays a line break**, so
   every text written before this ticket reads exactly as today (today
   the text is shown with `white-space: pre-wrap`).
3. **Safe by construction**: raw HTML in the text is shown as text, never
   run. Links open in a new tab (`rel="noopener noreferrer"`) and only
   `http`, `https` and `mailto` are links; anything else (`javascript:`,
   `data:`) is plain text. **No inline images** (`![…](url)` shows as a
   link): a Document's images stay in its gallery (D-09), and an image
   loaded from any address would let a writer see who reads the text.
4. **Mentions keep working inside Markdown**: `#Name` mentions (spec 20)
   are lifted out of the text before it is parsed and put back as the
   same links (hover preview, open menu, spec 32 and 37), so the token
   `#[Name](doc:<uuid>)`, which looks like a Markdown link, is never read
   as one. A mention works in headings, lists, quotes, tables and
   bold text; inside `code` it is shown as written (`#Name`), not linked.
5. **Headings are scaled down**: `#` in a text is at most the size of a
   Note title (the page's own heading stays bigger), `##`…`######` step
   down from there, so a description can't out-shout the Document name.
6. **Short previews stay plain**: the Document card (2 or 5 lines), the
   mention hover preview, "Mentioned in" excerpts, search excerpts and
   the map-card preview show the text **without** its Markdown signs
   (`**Drakon**` reads `Drakon`; a list item reads as its words), so a
   clamped card never shows a half table or a raw `##`.
7. **The editor stays a textarea** (product owner, 2026-10-28, on a
   decision card, over a plain textarea and a WYSIWYG editor): the same
   `MentionTextarea` with the `#` popup, plus a small toolbar above it
   (bold, italic, heading, bulleted list, numbered list, quote, link) that
   wraps or prefixes the selected text, the usual shortcuts (Ctrl/Cmd+B,
   Ctrl/Cmd+I, Ctrl/Cmd+K), and a **Write / Preview** switch that shows
   the text as it will read. The hint under the field says Markdown is
   supported, with a link to a one-screen cheat sheet.
8. **Read aloud** (spec 30) reads the words, never the signs: headings,
   list items and table cells are read as sentences, links by their text.
9. **PDF** (spec 23b, 35): descriptions and Notes are printed formatted in
   all four styles (Modern, Gothic, Parchment, Print). A mention keeps its
   page cross-reference; a link prints its text with the address after
   it in smaller type; the Gothic/Parchment drop cap stays on the first
   paragraph only when the text starts with a paragraph (not a heading
   or a list).
10. **Search** (spec 21) indexes the text as stored; the signs don't
    hinder matching (Postgres ignores `*`, `#`, `|`), and excerpts are
    shown plain (Decision 6).
11. **Generate mentions and auto-linking on save** (spec 39) skip code
    (inline and fenced) and the address part of a Markdown link, so a
    name is never linked inside a URL or a code sample. The link text
    `[la locanda](https://…)` is also left alone (a link inside a link
    can't work).
12. **Export and import** (spec 23, 27): the Markdown export already
    writes descriptions and Notes as the author's prose, so formatting
    now survives into the `.md` file as is. Importing a hand-written
    Markdown file keeps its rules (`#` = Document, `##` = Note) and now
    keeps everything else as Markdown, so a `###` heading, a list or a
    table inside a section becomes formatting in the Document. The JSON
    export is unchanged (the text was always stored as is).
13. **History** (spec 24b) compares the text as written (Markdown signs
    included), like today.

## Questions for the product owner

1. **Editor**: answered 2026-10-28, textarea + toolbar + Write/Preview
   (Decision 7).
2. **Comments**: answered 2026-10-28 ("ok prosegui" on the proposal):
   plain (Decision 1).

## Design

### 48_1 Frontend rendering

- Dependencies: `react-markdown`, `remark-gfm`, `remark-breaks`,
  `unified`, `remark-parse` (and `@types/mdast`, `@types/hast` for the
  types), caret ranges like the others. `react-markdown` builds React
  elements, never `innerHTML`, and drops raw HTML by default.
- `lib/markdownText.ts`: placeholders (`mentionPlaceholder`,
  `splitPlaceholders`), `safeLinkUrl`, and `markdownToPlain(text)` that
  strips Markdown for Decision 6 and 8 (tokens kept; blocks joined by a
  separator; `sentences` adds a full stop to headings, list items and
  rows). The segments `MentionText` computes moved to
  `hooks/useMentionSegments.ts`, and one mention renders through the
  exported `MentionSegmentView`.
- `components/mentions/MarkdownText.tsx`: parses the lifted text,
  maps text nodes back through the same rendering `MentionText` uses
  (split into `MentionSegment`s), maps elements to Mantine (`Title`
  with the scaled order of Decision 5, `List`, `Blockquote`, `Table`,
  `Code`, `Anchor` with the URL check of Decision 3). `MentionText`
  keeps its `linked` and `members` props and is used for the plain
  previews.
- `DocumentView` (also in the split view), `NoteItem`, `DdiModule`: the full
  texts move from `MentionText` + `pre-wrap` to `MarkdownText`.
  `DocumentCard`, `DocumentMentionPreview`, `Backlinks`, search results:
  `MentionText` over `toPlainText`.
- `lib/speech.ts`: reads `toPlainText` with sentence breaks per block.
- Styles in `index.css` under `.markdown-text` (spacing, table borders,
  quote bar in `--accent-primary`), light and dark.

Built: a link that is not `http`, `https` or `mailto` is shown as its
text; a `javascript:` address is not even read as a link by the parsers.

### 48_2 Frontend editor

- `components/mentions/MarkdownEditor.tsx` around `MentionTextarea` in
  `DocumentFields` and `NoteForm`: buttons with tooltips, shortcuts. Each
  action (`lib/markdownEditing.ts::markdownEdit`) is a list of insertions
  in display coordinates, applied through the textarea's new `controlRef`
  (`replaceDisplayRange` with empty ranges), so tokens survive.
- Write / Preview `SegmentedControl` above the field; Preview renders
  `MarkdownText` with the current value.
- The `#` popup does not open for a `#` at the start of a line until a
  name starts (`isHeadingStart`, only with `MentionTextarea`'s `markdown`
  prop, so Comments keep the old behaviour).
- Cheat sheet: a small `Popover` from the hint link.
- Strings in all 12 languages; "Markdown" kept as is in the glossary.

### 48_3 Backend

- Dependency: `markdown-it-py` with its built-in tables and
  strikethrough, `html` option off (a task list prints as its `[ ]`).
- `domain/markdown.py`: `markdown_tree` (blocks of `Node`s whose leaves
  the caller chooses), `markdown_plain`, `protected_ranges`.
- PDF (`domain/manual.py`, `pdf/templates/_base.html.j2`): descriptions and
  Notes carry `blocks` (`Node[Run]`) instead of `paragraphs`: the spans are
  lifted (mention → placeholder), parsed, and every leaf is a run, so a
  mention still prints its `p.` cross-reference. Comments keep
  `paragraphs`. The template renders blocks with a recursive `markdown`
  macro; `base.css` styles headings (h4-h6), lists, quotes, code, tables
  and prints a web link's address after it.
- Search excerpts: `searchable_text(text, markdown=True)` strips the
  signs before Postgres marks the matches (titles are left as they are).
  Backlink excerpts are stripped in the browser.
- `domain/mention_suggestions.py` (generate + `link_new_names`): skip
  ranges inside inline code, fenced code and Markdown links.
- `domain/import_files.py`: no change in rules; a test that a `###`
  heading, a list and a table survive into the imported text.
- Read aloud is frontend only; JSON export, Room duplication and History
  need no change.

## Tests

- Frontend: headings/lists/tables/quotes/code render; a single newline is
  a `<br>`; raw `<script>` and `javascript:` links render as text; a
  Document mention inside bold, a list and a table is a link with its
  preview; a mention inside code is not a link; a card shows plain text;
  speech reads no `*` or `#`; toolbar wraps the selection and keeps a
  token inside it; the `#` popup doesn't open for `# `.
- Backend: the PDF HTML holds `<h…>`, `<ul>`, `<table>` and keeps the
  mention cross-reference inside a list item; generate-mentions doesn't
  propose a name inside code or a URL; search excerpts have no `**`;
  import keeps `###` and tables.

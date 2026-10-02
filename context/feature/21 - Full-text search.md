## Goals

- FR-N5: search a Room's content from anywhere inside it, and only ever find what the viewer may see (VR-07, NFR-01).
- Today there is no text search: the Documents list filters by Tag, the Comment toolbar filters the Comments already loaded on one page.

## Decisions (product discussion, 2026-10-02)

These complete FR-N5 in `requirements.md` and don't change it.

1. **What is searched**: Document names and descriptions, Notes (title and text), Comments (replies included once ticket 19 lands), Tag names. The Glossary entity (FR-N3) doesn't exist yet; it joins the search when it does.
2. **Where**: a search field in the header of every page inside a Room (`AppHeader`), opened by click, `/` or `Ctrl+K` (`Cmd+K` on macOS). It searches **the current Room only**.
3. **Results**: grouped by kind (Documents, Notes, Comments, Tags), each with a short excerpt and the matched words highlighted. A click opens the exact place: the Document, the Note on its page, the Comment in its Thread (expanding its branch), the Documents list filtered by the Tag.
4. **How it matches**: Postgres full-text search, ignoring accents and case, with **prefix matching** ("dra" finds "drago"). One configuration for every language (`simple` + `unaccent`, no stemming), because a Room can mix Italian and English.
5. **Visibility**: filtered on the server with the same domain functions as every other read path; result counts and excerpts never reveal hidden content (an excerpt is built only from text the viewer may read).
6. **Filters**: by Tag (results from Documents carrying the Tags, and their Notes and Comments) and by kind. No author or date filter in v1.
7. **Search across all Rooms**: later, not in this ticket.

## Design

### Backend (21_1)

- **Migration**: enable `unaccent` (Supabase ships it) and add an `IMMUTABLE` wrapper (`f_unaccent`) so it can be used in indexes; a generated `tsvector` column with a GIN index on `documents` (name weighted above description), `document_notes` (title above text), `comments` (body) and `tags` (name). Deleted Comments (placeholders) are excluded.
- Text with mention tokens (ticket 20) is indexed by its visible names, not by the token syntax.
- **Route** `GET /rooms/{id}/search?q=&kind=&tag=` (members only): parses `q` into prefix terms (`term:*`, ANDed; a query under 2 characters returns nothing), finds the matches in the Room, **filters them with the existing visibility functions** (Document, Note, effective Comment visibility), ranks with `ts_rank`, and returns at most 10 per kind with a `has_more` flag. Excerpts (`ts_headline`) are computed **after** filtering, on visible rows only. The highlight markers are returned as offsets, not HTML.
- Filtering happens in the domain layer after a Room-scoped SQL match, like the other list routes. Fine for the expected Room sizes; if a Room grows past what this handles (NFR-04), move the visibility predicate into SQL.
- Tests at 100%: accent and case insensitivity, prefix match, a Master-only Document / Note / Comment never found by a Player (and not counted), the Master finds everything, excerpts from hidden text never returned, Tag and kind filters, another Room's content never found.

### Frontend (21_2)

- `components/search/SearchSpotlight.tsx`: Mantine `Spotlight` (or a `Modal` with a list) opened from the header field and the shortcuts; debounced query (about 250 ms) through a TanStack hook `useSearch`; results grouped per Decision 3, keyboard navigation, "show more" per kind.
- Deep links: `#note-<id>` and `#comment-<id>` anchors on the Document page, scrolled into view and briefly highlighted; a Comment inside a collapsed branch expands it.
- Mobile: the header shows a search icon that opens the same panel full screen.
- New strings in `en.json` and `it.json`.

## Implementation

- **21_1** backend and migration, then **21_2** frontend, two branches into `staging`. Independent of 19 and 20; whichever lands first, the later one adds its content to the index (replies, mention tokens).
- Update `architecture.md` (search: indexes, visibility after match).

## Definition of Done

- In a Room with Italian and English text, "citta" finds "Città", "dra" finds "Drago", and a Tag name finds the Tag.
- A Player never finds a Master-only Document, Note or Comment, and counts don't hint at them; the Master finds them.
- `Ctrl+K` opens search on every Room page; a Comment result scrolls to that Comment.
- Checks green.

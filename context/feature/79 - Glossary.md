# 79 - Glossary

## Goals

- Product owner's request (2026-11-27): "definiamo e poi sviluppiamo la
  feature del glossario" (let's define, then build, the Glossary feature).
- `requirements.md` already specifies it and it was never built (section
  14): **FR-N3** (entries with a definition, Tags and links to related
  Documents), **FR-N4** (filter by one or more Tags, D-14), **FR-N5**
  (search covers the Glossary), **FR-N6** (recognize terms in text, Could),
  **VR-10** (an entry has a visibility and never reveals hidden content),
  **UC-10** (consult the Glossary), the `GlossaryEntry` entity (term,
  definition, Tags, visibility, Room), and the matrix row "Manage Tags and
  Glossary" (Administrator and Master).
- The Room Index (spec 44) is **not** the Glossary: it is a navigation over
  Main Tags and maps. This ticket builds the entity of terms and
  definitions. `requirements.md` is **not** edited here (protected); at the
  end §14 changes from "not built" to "built" only if the product owner
  asks.
- Needs **one migration** (new tables). Split in two slices so the first is
  usable on its own: **79** (entries, page, Tags, visibility, search,
  Documents links, import/export, Room duplication) and **79b** (terms in
  text: `#` mentions of an entry and recognition, FR-N6).

## Today (what the code does)

- No `glossary` table or router (`architecture.md`: "There is no Glossary
  router"). `SearchKind` has a comment "the Glossary joins once it exists"
  (`app/domain/search.py`).
- The words "Glossary" in the UI (`glossary.*` keys, `RoomIndex.tsx`,
  `lib/tags.ts`) are the Room Index of specs 10, 11_3 and 44. To avoid
  confusion the Index's user-facing label is kept as it is; the new page is
  called **Glossary** (it is the term the spec uses).
- Patterns to reuse: Notes (spec 12: titled block, own visibility with
  `Room / Master / Private / Selective` and grants), Tags and their
  filter (spec 10), search kinds (spec 21), `#Name` mentions (specs 06, 20,
  39), reveal (spec 22b), history (spec 22), export/import schema
  versions (specs 23, 27, 56), Room copy (spec 33).

## Decisions

*Proposed 2026-11-27, to confirm with the product owner (see Open
questions).*

1. **An entry** belongs to a Room and has: **term** (required, ≤120
   characters, unique in the Room ignoring case and accents), optional
   **aliases** (e.g. "Strahd" / "Count von Zarovich"; up to 10, ≤120 each,
   also unique among terms and aliases), a **definition** (Markdown as in
   spec 48, with the usual `#[Name](doc:id)` mentions of Documents, max
   10 000 characters), **Tags** (the Room's existing Tags, same picker as
   Documents), **related Documents** (explicit list, up to 20, shown as
   links), a **visibility** and `created_by`.
2. **Visibility** is the Notes model: Room (all members), Master only,
   Private (its author and the Master) or Selective (listed members), with
   the Room's default visibility as the starting value. VR-10 holds by
   construction: every exit point (list, search, Tag filter, counts,
   export, PDF, "View as", Room copy) goes through the same visibility
   check as Notes; a related Document the viewer can't see is dropped from
   the links silently, never counted. The Master can Reveal an entry like a
   Note (spec 22b).
3. **Who manages entries**: Administrators and Masters, as the matrix says
   ("Manage Tags and Glossary"). Players read what they see. *Open
   question 1: let Players propose or write their own entries?*
4. **Where it lives**: a **Glossary page** at `/rooms/:id/glossary`, linked
   from the Room's Documents/Maps navigation and from the Room Index card
   (a "Glossary" link beside "Maps"). It lists entries **A to Z** with a
   letter bar (accents and case ignored, as the PDF's glossary), a **Tag
   filter** (one or more Tags, combinable, FR-N4) and a text filter on term
   and aliases. Each entry is a card: term, definition (clamped, "read
   more"), Tag chips, related Documents; clicking opens it in the **split
   pane** (spec 37) on desktop and a full page on phone. The Master's
   "New entry" button opens a compact form (spec 25 style).
5. **Search**: `SearchKind.GLOSSARY` joins the results of spec 21 (term and
   aliases ranked above definition text, same ranking and per-kind cap).
6. **Backlinks**: a Document's info panel shows "Glossary entries that
   mention this Document" (entries whose related Documents or definition
   mentions list it, visibility checked).
7. **Import / export** (specs 23, 27, 56): the Room JSON file's
   `schema_version` goes up by one; `glossary` is a list (term, aliases,
   definition, tags by name, related documents by key, visibility). The
   Markdown export gets a "Glossary" section; the Room PDF **keeps** its
   Documents-names glossary (a different thing, product owner 2026-10-06)
   and adds a **Terms** chapter at the end only if the Room has visible
   entries. Obsidian import (spec 65) is unchanged. Older files without
   the list still import.
8. **Room duplication** (spec 33) copies entries, their Tags and Documents
   links, remapped to the copy.
9. **History and audit**: creation, edit, deletion and reveal go to the
   Room's visibility history (spec 22) like Notes.
10. **Slice 79b, terms in text** (FR-N6, Could): (a) a new mention kind
    `#[Term](term:id)` picked from the same `#` autocomplete, shown as a
    chip that opens the entry in the split pane; (b) optional
    **recognition**: in Document descriptions and Notes, a whole-word match
    of a visible term or alias gets a dotted underline and a tooltip with
    the first line of the definition, switchable per user in the Account
    page. Recognition is display-only: nothing is stored in the text.
    Needs the mention grammar and backend span builder extended (`kind:
    term`), so it is its own slice.

## Open questions (with proposals)

1. **Who writes entries?** Proposal: Master and Administrator only (matrix).
   Alternative: Players can add entries visible to themselves and the
   Master, like a private note.
2. **Entry or Document?** A Document already can be an NPC with a
   description. Proposal: the Glossary is for **short, reusable terms**
   (rules, jargon, world words, titles), not for characters or places,
   which stay Documents. Alternative: allow "promote an entry to a
   Document".
3. **Aliases** (Decision 1): keep, or leave them out of the first version?
   Proposal: keep, they make search and 79b recognition useful.
4. **Slice 79b** right after 79, or only 79 for now? Proposal: build 79
   first, ask again.
5. **Languages**: the 12 UI languages get the new strings (as always); the
   entries' own text is whatever the Room writes. No translation of entries.

## Tests

- Backend: entry CRUD and permissions (Master/Admin yes, Player 403,
  non-member 404), term uniqueness (case/accents), visibility at every exit
  (list, Tag filter, search, backlinks, counts, export, PDF, View as, Room
  copy), Selective grants, aliases, caps, Reveal.
- Frontend: Glossary page (letters, Tag filter, filter box, empty and
  loading states, phone layout), form, split pane, search results, keys
  parity in 12 languages.
- Import/export round trip with and without the `glossary` list.

## Estimate (Claude's own build time)

Slice 79: one long session, about 3 hours of work (migration, API, domain,
page, search, import/export, copy, 12 languages, tests). Slice 79b: about
1 to 1.5 hours. The product owner then needs to apply one migration to
staging and later to production.

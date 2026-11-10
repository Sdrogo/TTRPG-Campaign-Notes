# 69 - Update same-name Documents on import

## Goals

- Product owner's request (2026-11-10): after **Duplicate Room** every
  Document has a new id, so importing the original Room's JSON into its copy
  finds no match by id and **copies every Document again**, even though the
  names are the same. The owner wants to be able to **update** those
  Documents instead of duplicating them.
- Keep spec 27's Copy / Replace choice (Decisions 5 and 6) exactly as it is;
  only widen **what counts as "already exists in the Room"**.
- **Backend + frontend, no migration, no new endpoint.** `schema_version` of
  the export stays 4 (nothing new in the file).

## How it works today

- `plan_import` (`backend/app/domain/imports.py`, `_existing_for`) looks up the
  file Document's `source_id` in the Room's Documents the importer sees. Only
  a match opens the "already in the Room" step (`ImportExistingStep`), where
  each Document is **Copy** (default) or **Replace** (rewrites information
  only, Decision 6), with "apply to all".
- Obsidian notes (spec 65) already match **by name** (`match_by_name`), using
  `_by_name` (case and edge spaces ignored, first by id if several).
- A duplicated Room has fresh ids, so a Room export never matches in it.

## Decisions (proposed defaults, to confirm)

1. **Id first, name as fallback.** For a file Document: if its id points at a
   Document of the Room the importer sees, that is the match (as today).
   Otherwise the match is the visible Document of the Room with the **same
   name** (`_by_name`: case and edge spaces ignored). No match, nothing asked.
2. **Still Copy by default.** The user must choose Replace; nothing is updated
   silently. The existing step shows a small hint "Same name, different id"
   next to the Documents matched only by name, so it is clear why they appear.
   The "Replace all" button works as today.
3. **One target, one Document.** A Room Document can be replaced by **at most
   one** file Document. If two file Documents share a name, only the one that
   matched by id (else the first in the file) is offered Replace; the others
   are offered Copy only. This also stops two Documents of the file from
   overwriting each other.
4. **Same rights as today.** Replace needs the right to manage the target
   (`can_replace`), else it is disabled with the existing hint. Documents the
   importer can't see are never matched (no name leak).
5. **Mentions** inside the file are re-pointed to the replaced (or new) id as
   they are today, so links among updated Documents keep working.
6. **Single-Document and Markdown files** follow the same rule (the id fallback
   needs `source_id`; Markdown has none, so Markdown keeps Copy unless it is an
   Obsidian note, already by name).

## Design

- Backend: `_existing_for` falls back to `_by_name` when the id gives no match;
  `plan_import` skips a target already taken by another file Document
  (Decision 3); the preview adds `matched_by_name: bool` to each Document
  (`api/imports.py` schema, `lib/documentImport.ts`).
- Frontend: `ImportExistingStep` shows the hint for `matchedByName`; en/it
  strings added.
- Tests: backend (id match wins over name, name fallback, two same-name file
  Documents, no visible match, cannot-manage target), frontend (hint shown,
  Replace on a name match).

## Definition of Done

- Importing Room 1's JSON into "Room 1 (Copy)" offers Copy / Replace for every
  Document and Replace updates them in place (information only).
- Nothing changes when importing into a Room with no same-name Documents.
- Context docs and the progress tracker updated; backend and frontend suites
  green.

## Open Questions

1. Name match as a fallback for **all** imports (proposed), or only when the
   whole Room is imported? (Default: all.)
2. Should the Replace default be pre-selected for name-only matches, to save
   clicks after a duplication? (Default: no, Copy stays the default; use
   "Replace all".)

## Answers (product owner, 2026-11-10)

1. Name fallback for **all** imports: yes.
2. Copy stays the default; the "Replace all" button of the choices step is
   the one-click way to update everything (kept, no change).

## Built (2026-11-10)

- `imports.py::_match_existing` computes each file Document's match once for
  the whole file set (so unticking a Document never changes another's):
  id matches claim first, then name matches (file order), each Room Document
  offered to one file Document only. Markdown without an id stays Copy.
- `matched_by_name` on `PlannedDocument` and `PreviewDocumentResponse`; the
  choices step shows "Same name, different id" (`documentImport.existing.byName`,
  all 10 languages). No migration, no new endpoint.

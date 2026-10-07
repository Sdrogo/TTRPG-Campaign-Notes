## Goals

- Product owner's request (2026-10-07): **export a single Document** on its own, and **import one or more Documents** from a JSON or Markdown file. The same import must accept a **whole Room export** (spec 23), so a Room's content can be moved or copied into another Room, or restored from a backup.
- The Room export (spec 23) stays as it is: `GET /rooms/{id}/export` and its `schema_version` 1 file are not changed by this ticket. The import reads that file as it is.
- Import is the first write path that takes content from a file, so it must go through the same rules as creating a Document by hand: who may create, visibility, limits, mention tokens, the image pipeline (NFR-01, I-01, VR-07).

## Decisions (proposed 2026-10-07, confirm in the PR)

### Single-Document export

1. **Same format as the Room export, one Document in it.** JSON with `schema_version` 1 and the `ExportJson` shape (Room, members, Tags, `main_items`, `documents` with one item), and Markdown with the same layout as spec 23. No new schema: a single-Document file is a Room export that holds one Document, so the import needs one reader for both. `tags` and `members` list only what the Document refers to; `main_items` is empty; `tag_filter` is null.
2. **Content and visibility as spec 23**: description, Tags, Owners, Character player, Notes, Comments with replies, mentions, images and PDF Attachments as signed links that expire. Exactly what the requester sees (the same `load_export` read, filtered to one Document; 404 for a Document they can't see). Follows `X-View-As`, so the Master exports "as player X". A mention of another Document keeps its id in JSON (the requester sees it) and is plain `#Name` in Markdown, the rule spec 23 uses for Documents the Tag filter left out.
3. **Who and where**: every member who sees the Document, from the Document page's "⋮" menu ("Export"), a small dialog with JSON / Markdown. PDF of one Document is **not** in this ticket (Open Question 1).
4. **File name**: `<document>-<date>.json|md`, same ASCII rule as `export_filename`.

### Import

5. **Always creates new Documents, never overwrites.** Every imported Document, Note and Tag gets a fresh id; the ids in the file are only used to link objects *inside* the file (Document → Tags, mention → Document). So **id collisions can't happen**: importing the same file twice gives two copies, and importing into the Room it came from never touches the originals. Updating existing Documents from a file is out of scope (Open Question 2).
6. **Formats accepted**:
   - **JSON**: a file of spec 23 (`schema_version` 1, from a Room or a single Document). A higher `schema_version` is refused (422) with a clear message; extra fields are ignored; `id`s are optional (missing ones are generated), so a hand-written or Agent-written JSON with just `name` and `description` works.
   - **Markdown, exported by the app**: recognised by the spec 23 layout (`### <a id="doc-<uuid>"></a>Name` headings, the facts list, `**Notes**` with `####` titles). Read best effort: the facts list gives Tags (by name) and visibility; `[Name](#doc-<id>)` links become mentions when the Document is in the file. Comments in a Markdown export are not read (see Decision 11).
   - **Markdown, written by hand**: every `#` heading is a Document, its text up to the next `#` heading is the description, every `##` heading under it is a Note (title + text). An optional first line `Tags: a, b` under the `#` heading sets the Tags. Nothing else is interpreted.
   - JSON is the lossless path; the dialog says so.
7. **One or more files at once**, up to 10 files per import, each **at most 5 MB**, UTF-8 only. At most **200 Documents** per import, and each Document within the existing limits (50 Notes, 200-character Note title, 20 images, Comment and description limits). An import over a limit is refused before anything is written, with the reason.
8. **Preview, then import.** Uploading the files returns a preview without writing anything: the Documents found (name, Notes count, Tags), the Tags that match the Room's and the ones that would be created, and per-Document warnings (what will be dropped or changed, Decisions 9 to 13). The user unticks what they don't want and confirms. The import then runs **in one transaction, all or nothing**; images are fetched after the commit (Decision 12).
9. **Who**: whoever may create Documents in the Room (D-13: the Master, and Players when "Players can create Documents" is on), else 403. The importer is the **Owner** of every imported Document (D-12, the creator's default); Owners in the file are ignored (Open Question 3). Refused while previewing as a member (`X-View-As` refuses every write, spec 22b). The Character player link (`played_by`) is **not** imported: it names a member and is AuditLogged (D-23); the warning says so.
10. **Tags** are matched **by name** (case and surrounding spaces ignored) to the Room's Tags. A Tag the Room doesn't have is created, with its category from the file, **only when the importer may manage Tags** (Administrator or Master, as `POST /tags`); otherwise it is dropped from those Documents and the preview says so. `main_items` (the Room's grouping) is not imported: it is Room setup, not content.
11. **Visibility**: each Document and Note keeps its level (`room`, `master`, `private`) when the importer may set it, else the Room's default visibility (spec 22). **Selective** becomes **Private**: grant lists name members by id, and member ids don't carry across Rooms (Open Question 3 for the same-Room case). A file with no visibility (hand-written Markdown) uses the Room's default. Visibility of imported content is not AuditLogged as a "change": it is the Document's first state.
12. **Comments are not imported.** A Comment belongs to its author (D-24, the Thread's rules), and an import can't write in someone else's name. The preview shows how many are dropped. Open Question 4 asks whether to keep their text somehow.
13. **Mentions**: a mention of a Document or Tag in the same file is re-pointed to the new id; a Tag mention to the matched Tag. A mention of a Document outside the file keeps its id only if that Document exists in the target Room **and the importer sees it**; otherwise it becomes plain `#Name`. A member mention becomes plain `@Name` unless that user is a member of the target Room. Tokens are written in the stored format (`#[Name](doc:id)`), so backlinks (spec 20) and search (spec 21) pick them up as for any edit.
14. **Images**: the export holds signed links that expire within an hour. An image is imported only when its link is **still valid and points at this app's own Supabase Storage** (an allowlist of the configured project host, nothing else), through the existing image pipeline (`remote_images`: public addresses only, pinned IP, no redirects beyond 3, 20 MB cap; then validated by content, EXIF stripped, WebP). The favorite flag is kept. Expired or foreign links are skipped and listed in the result. At most 200 images per import, a few at a time. **PDF Attachments are not imported** (Open Question 5). Comment images go with their Comments (not imported).
15. **History**: each imported Document starts a fresh version history (spec 24b) whose first revision is the import, by the importer. No Reveals, no visibility history, no reactions, pins or read state come from the file.
16. **Safety**: the file is parsed with size and depth limits before anything else (no JSON bomb, no unbounded Markdown); everything goes through the same validation as `POST /documents` and `POST /notes`; raw HTML in Markdown stays text (it is never rendered as HTML, like any description today); the only `<a id>` read is the exact export anchor. No URL in the file is fetched except the images of Decision 14. Not stored: the uploaded file itself is read and dropped.

## Open Questions

1. **PDF of one Document**: worth adding now (the 23b job with a Document filter), or later?
2. **Update instead of copy**: should importing into the *same* Room offer "replace the Document with this id" (a restore)? Proposed: no, copies only, until there is a real need.
3. **Same-Room import**: when the file's `room.id` is the target Room, keep Owners, Selective grants and member mentions for users who are still members? Proposed: no in this ticket (one rule for every import).
4. **Comments**: drop them (proposed), or append their text to the Document as one Note "Imported comments" (author name, date, body, visibility Private)?
5. **PDF Attachments**: skip (proposed), or fetch them from still-valid own-Storage links like images (10 MB each, 10 per Document)?
6. **Images from other hosts**: only this app's Storage (proposed), or any public URL as "Add image from URL" already allows? The latter turns one file into up to 200 server-side fetches of arbitrary hosts.
7. **Big imports**: synchronous with the limits above (proposed), or a background job like the Room PDF (spec 23b) when there are images?

## Design

### Backend (27_1, export)

- `app/api/export.py::load_export` takes an optional `document_id` and reads only that Document (still through `is_document_visible`); `tags` and `members` trimmed to what it refers to. No change to the Room export's output (a test pins it).
- `GET /rooms/{id}/documents/{doc}/export?format=json|md` in `app/api/export.py`: members only (403), 404 for a Document the requester can't see, same headers and `ExportJson` response model as the Room export.

### Backend (27_2, import)

- `app/domain/imports.py` (pure): `parse_json`, `parse_markdown` (export layout or hand-written) → a format-independent `ImportBundle` (Documents, Notes, Tags by name, mention spans, image links, warnings), and `plan_import(bundle, room context, importer)` → what will be created, matched, changed or dropped (Decisions 9 to 14). Easy to test without a database.
- `POST /rooms/{id}/imports/preview` (multipart, up to 10 files) → the plan, nothing written. `POST /rooms/{id}/imports` (the same files plus the selected Document keys) → re-parses, re-plans, then creates Tags, Documents, Owners, Notes and the first history revision in one transaction, in a fixed number of statements per kind (NFR-04). After the commit, images are fetched and attached best effort; the response lists the created Documents and what was skipped.
- Errors (i18n keys in `errors.import.*`): 403 not allowed to create, 413 file too big, 422 unreadable file / unsupported `schema_version` / over a limit.
- Tests at 100%: a Room export (both formats) round-trips into another Room with names, Notes, Tags and mentions; a single-Document export too; same file twice gives two copies; a Player can't create Tags or set `master`; Selective → Private; Comments and `played_by` dropped; a mention of a Document the importer can't see becomes `#Name`; an expired or foreign image link is never fetched; oversize, too many Documents, bad JSON, unknown schema refused with nothing written; refused with `X-View-As`.

### Frontend (27_3)

- Document page "⋮" → "Export": `ExportDocumentModal` (JSON / Markdown), reusing `apiDownload` and `saveBlob`.
- Room title "⋮" → "Import Documents" (only for members who may create Documents): `ImportDocumentsModal` with a file picker (multiple, `.json,.md`), the preview (ticks per Document, Tags to create, warnings), "Import", then a result with links to the new Documents and what was skipped. Hooks `usePreviewImport`, `useImportDocuments` invalidating the Documents list and Tags.
- New strings in `en.json` and `it.json`.

## Implementation

- **27_1** export, **27_2** import backend, **27_3** frontend, into `staging`. No migration expected (import writes existing tables).
- Update `architecture.md` (Document export, import rules, the image allowlist) and `progress-tracker.md`.

## Definition of Done

- A member exports one Document as JSON and Markdown; a Player's file holds nothing hidden from them.
- A Master exports a whole Room and imports it into a new Room: Documents, Notes, Tags and mentions between them come across; Comments and the Character link are listed as dropped; images come across while their links are valid.
- A Player imports a hand-written Markdown file of two Documents in a Room where Players may create Documents.
- Nothing is written when the file is refused; the originals are never changed.
- Backend `pytest` (100% coverage), `ruff`, `mypy`; frontend `npm run build`, `npm run lint`, `npm test`.

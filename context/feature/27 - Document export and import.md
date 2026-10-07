## Goals

- Product owner's request (2026-10-07): **export a single Document** on its own, and **import one or more Documents** from a JSON or Markdown file. The same import must accept a **whole Room export** (spec 23), so a Room's content can be moved or copied into another Room, or restored from a backup.
- The Room export (spec 23) stays as it is: `GET /rooms/{id}/export` and its `schema_version` 1 file are not changed by this ticket. The import reads that file as it is.
- Import is the first write path that takes content from a file, so it must go through the same rules as creating or editing a Document by hand: who may create or manage, visibility, limits, mention tokens, the image pipeline (NFR-01, I-01, VR-07).
- Sibling: **27b** (one Document as a PDF), product owner 2026-10-07.

## Decisions (proposed 2026-10-07; the product owner answered the Open Questions the same day, see the last section)

### Single-Document export

1. **Same format as the Room export, one Document in it.** JSON with `schema_version` 1 and the `ExportJson` shape (Room, members, Tags, `main_items`, `documents` with one item), and Markdown with the same layout as spec 23. No new schema: a single-Document file is a Room export that holds one Document, so the import needs one reader for both. `tags` and `members` list only what the Document refers to; `main_items` is empty; `tag_filter` is null.
2. **Content and visibility as spec 23**: description, Tags, Owners, Character player, Notes, Comments with replies, mentions, images and PDF Attachments as signed links that expire. Exactly what the requester sees (the same `load_export` read, filtered to one Document; 404 for a Document they can't see). Follows `X-View-As`, so the Master exports "as player X". A mention of another Document keeps its id in JSON (the requester sees it) and is plain `#Name` in Markdown, the rule spec 23 uses for Documents the Tag filter left out.
3. **Who and where**: every member who sees the Document, from the Document page's "⋮" menu ("Export"), a dialog with JSON / Markdown (PDF comes with 27b).
4. **File name**: `<document>-<date>.json|md`, same ASCII rule as `export_filename`.

### Import

5. **Copy by default, replace when asked.** A copied Document, Note or Tag gets a fresh id; the ids in the file link objects *inside* the file (Document → Tags, mention → Document) and are used for one more thing only: spotting a Document of the file that **still exists in the target Room** (same id, the importer sees it). When there is at least one, a **modal asks what to do with them**: **Copy** (a new Document, the original untouched) or **Replace** (Decision 6), per Document with "apply to all" (product owner, 2026-10-07). With no match nothing is asked and everything is copied, so importing into another Room never touches anything that exists.
6. **Replace** overwrites the existing Document's **information only**: name, description, Tags and Notes (the existing Notes are removed and the file's are created in their place). Everything else on it stays as it is: id, Owners, visibility and grants, Character player, Comments, PDF Attachments, Reveals. Images: the existing ones stay; an image of the file whose id the Document still has is not fetched again, the others are added (Decision 15) up to the 20-image cap. Only someone who **may manage that Document** (an Owner or the Master, D-12) can replace it; for anyone else the modal offers Copy only. The replace is one new revision in the Document's history (spec 24b), so it can be undone by restoring the previous one.
7. **Formats accepted**:
   - **JSON**: a file of spec 23 (`schema_version` 1, from a Room or a single Document). A higher `schema_version` is refused (422) with a clear message; extra fields are ignored; `id`s are optional (missing ones are generated), so a hand-written or Agent-written JSON with just `name` and `description` works.
   - **Markdown, exported by the app**: recognised by the spec 23 layout (`### <a id="doc-<uuid>"></a>Name` headings, the facts list, `**Images**`, `**Notes**` with `####` titles). Read best effort: the facts list gives Tags (by name) and visibility; `[Name](#doc-<id>)` links become mentions when the Document is in the file; the `![image](url)` lines are its images. Comments are not read (Decision 13).
   - **Markdown, written by hand**: every `#` heading is a Document, its text up to the next `#` heading is the description, every `##` heading under it is a Note (title + text). An optional first line `Tags: a, b` under the `#` heading sets the Tags; a line holding only `![...](url)` is an image of that Document. Nothing else is interpreted.
   - JSON is the lossless path; the dialog says so.
8. **One or more files at once**, up to 10 files per import, each **at most 5 MB**, UTF-8 only. At most **200 Documents** and **200 images** per import, and each Document within the existing limits (50 Notes, 200-character Note title, 20 images, description limits). An import over a limit is refused before anything is written, with the reason.
9. **Preview, then a background job.** Uploading the files returns a preview at once, without writing or fetching anything: the Documents found (name, Notes count, images count, Tags), which of them exist in the Room (the modal of Decision 5), the Tags that match the Room's and the ones that would be created, and per-Document warnings (what will be dropped or changed). The user unticks what they don't want and confirms. The import then runs as a **background job** (product owner, 2026-10-07), like the Room PDF (spec 23b): Documents, Notes and Tags are written **in one transaction, all or nothing**, then images are fetched and attached best effort. The dialog follows the job and can be closed meanwhile; the result lists the Documents created or replaced (with links) and everything skipped.
10. **Who**: whoever may create Documents in the Room (D-13: the Master, and Players when "Players can create Documents" is on), else 403; replacing also needs Decision 6's right on each replaced Document. The importer is the **Owner** of every copied Document (D-12, the creator's default); **Owners in the file are ignored**, also in the Room the file came from (product owner, 2026-10-07: only the information is copied). Refused while previewing as a member (`X-View-As` refuses every write, spec 22b). The Character player link (`played_by`) is **not** imported: it names a member and is AuditLogged (D-23); the warning says so. The job re-checks at start that the importer is still a member with these rights, else it fails.
11. **Tags** are matched **by name** (case and surrounding spaces ignored) to the Room's Tags. A Tag the Room doesn't have is created, with its category from the file, **only when the importer may manage Tags** (Administrator or Master, as `POST /tags`); otherwise it is dropped from those Documents and the preview says so. `main_items` (the Room's grouping) is not imported: it is Room setup, not content.
12. **Visibility** (copied Documents and every imported Note): each keeps its level (`room`, `master`, `private`) when the importer may set it, else the Room's default visibility (spec 22). **Selective** becomes **Private**: grant lists name members by id and are never copied, also in the same Room (product owner, 2026-10-07). A file with no visibility (hand-written Markdown) uses the Room's default. A replaced Document keeps its own visibility (Decision 6). The visibility of new content is its first state, not an AuditLogged change.
13. **Comments are not imported** (product owner, 2026-10-07). A Comment belongs to its author (D-24, the Thread's rules), and an import can't write in someone else's name. The preview shows how many are dropped. Their images go with them.
14. **Mentions**: a mention of a Document or Tag in the same file is re-pointed to the new (or replaced) Document and to the matched Tag. Every other mention becomes plain text: a Document outside the file becomes `#Name` and a member becomes `@Name`, the same rule for every import, also in the Room the file came from (only the information is copied). Tokens are written in the stored format (`#[Name](doc:id)`), so backlinks (spec 20) and search (spec 21) pick them up as for any edit. A consequence to know: replacing one Document from its own export turns its mentions of other Documents into plain text; importing them together keeps the links.
15. **Images: every image in the file is copied** (product owner, 2026-10-07), from any public URL, through the existing "add image from URL" pipeline: `remote_images` (http(s) to public addresses only, each redirect hop re-checked, at most 3, the connection pinned to the checked IP so DNS rebinding can't bypass it, timeout, 20 MB streaming cap), then validated by content, EXIF stripped, longest side at most 1920 px, re-encoded as WebP, stored in the app's bucket like any Document image. A few at a time, in the job, after the Documents are committed; one that fails (expired export link, not an image, too big, unreachable) is skipped and listed, never failing the import. The favorite flag is kept. **PDF Attachments are not imported** (product owner, 2026-10-07).
16. **History**: a copied Document starts a fresh version history (spec 24b) whose first revision is the import, by the importer; a replaced one gets one new revision (Decision 6). No Reveals, no visibility history, no reactions, pins or read state come from the file.
17. **Safety**: the file is parsed with size and depth limits before anything else (no JSON bomb, no unbounded Markdown); everything goes through the same validation as `POST /documents` and `POST /notes`; raw HTML in Markdown stays text (it is never rendered as HTML, like any description today); the only `<a id>` read is the exact export anchor. No URL in the file is fetched except its images (Decision 15), and only by the job. The uploaded files are not kept: the job holds only the parsed content and the user's choices, cleared when it finishes.

## Design

### Backend (27_1, export)

- `app/api/export.py::load_export` takes an optional `document_id` and reads only that Document (still through `is_document_visible`); `tags` and `members` trimmed to what it refers to. No change to the Room export's output (a test pins it).
- `GET /rooms/{id}/documents/{doc}/export?format=json|md` in `app/api/export.py`: members only (403), 404 for a Document the requester can't see, same headers and `ExportJson` response model as the Room export.

### Backend (27_2, import)

- `app/domain/imports.py` (pure): `parse_json`, `parse_markdown` (export layout or hand-written) → a format-independent `ImportBundle` (Documents, Notes, Tags by name, mention spans, image links, warnings), and `plan_import(bundle, room context, importer, choices)` → what will be created, replaced, matched, changed or dropped (Decisions 5 to 15). Easy to test without a database.
- Migration: table `import_jobs` (`room_id` cascade, `requested_by`, `status` queued|running|done|failed, `payload` JSONB = the parsed bundle and choices, cleared when the job ends, `result` JSONB = created / replaced Document ids and the skipped items, `error`, times), RLS + deny policy, a partial unique index allowing one queued or running import per user and Room.
- `POST /rooms/{id}/imports/preview` (multipart, up to 10 files) → the plan, nothing written, nothing fetched. `POST /rooms/{id}/imports` (the same files, the selected Document keys, and Copy / Replace per existing Document) → re-parses, re-plans, stores the job and answers **202**; **409** when one is already active. `GET /rooms/{id}/imports/{job}` → status and result, the requester's own only (404 otherwise). Started after the request's commit like `export_pdf_job.spawn`.
- The run: re-check rights (Decision 10); in one transaction create Tags, copied Documents, Owners, Notes, replace the chosen Documents' information, write the history revisions, in a fixed number of statements per kind (NFR-04); then fetch images (a semaphore, a few at a time) and attach them with the usual Storage order (`record_pending_upload`, upload, `confirm_upload`), so a crash leaks nothing; record the result. A Document deleted before its images arrive just drops them.
- Housekeeping with the export sweeper: active jobs failed at startup (`interrupted`, same single-process assumption as `export_jobs`), jobs active for over 30 minutes failed (`stale`), finished rows deleted after 7 days.
- Errors (i18n keys in `errors.import.*`): 403 not allowed to create or to replace, 409 an import already running, 413 file too big, 422 unreadable file / unsupported `schema_version` / over a limit.
- Tests at 100%: a Room export (both formats) round-trips into another Room with names, Notes, Tags, mentions and images (served by a test server); a single-Document export too; Copy gives two Documents and Replace overwrites name, description, Tags and Notes but keeps Owners, visibility, Comments and Attachments, with a history revision; a Player who doesn't manage a Document can't replace it; a Player can't create Tags or set `master`; Selective → Private; Comments and `played_by` dropped; mentions outside the file become `#Name` / `@Name`; a private-address or failing image is skipped and the rest imported; oversize, too many Documents or images, bad JSON, unknown schema refused with nothing written; the job's payload is cleared; refused with `X-View-As`.

### Frontend (27_3)

- Document page "⋮" → "Export": `ExportDocumentModal` (JSON / Markdown), reusing `apiDownload` and `saveBlob`.
- Room title "⋮" → "Import Documents" (only for members who may create Documents): `ImportDocumentsModal` with a file picker (multiple, `.json,.md`), the preview (ticks per Document, Tags to create, warnings), then, when some exist in the Room, the **Copy / Replace** modal (per Document, "apply to all", Replace only where allowed), "Import", then the job's progress and result with links to the Documents and what was skipped. Hooks `usePreviewImport`, `useStartImport`, `useImportJob` (polling while running) invalidating the Documents list, Tags and the replaced Documents.
- New strings in `en.json` and `it.json`.

## Implementation

- **27_1** export, **27_2** import backend, **27_3** frontend, into `staging`. 27_2 carries a migration (`import_jobs`): apply it to the staging database before merging and to production before the release.
- Update `architecture.md` (Document export, import rules and job) and `progress-tracker.md`.

## Definition of Done

- A member exports one Document as JSON and Markdown; a Player's file holds nothing hidden from them.
- A Master exports a whole Room and imports it into a new Room: Documents, Notes, Tags, images and mentions between them come across; Comments and the Character link are listed as dropped.
- Importing a Document's own export back into its Room asks Copy or Replace; Replace changes only its information and can be undone from its history.
- A Player imports a hand-written Markdown file of two Documents in a Room where Players may create Documents.
- Nothing is written when the file is refused.
- Backend `pytest` (100% coverage), `ruff`, `mypy`; frontend `npm run build`, `npm run lint`, `npm test`.

## Open Questions, answered by the product owner (2026-10-07)

1. PDF of one Document: yes, as a follow-up ticket, **27b**.
2. Update instead of copy: ask at import time in a modal (Decisions 5 and 6).
3. Same-Room import keeping Owners and permissions: no, only the information is copied (Decisions 10, 12, 14).
4. Comments: dropped (Decision 13).
5. PDF Attachments: skipped (Decision 15).
6. Images: copy all of them (Decision 15).
7. Big imports: background job (Decision 9).

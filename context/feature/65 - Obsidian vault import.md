# 65 - Obsidian vault import

## Goals

- Product owner's request (2026-11-08): "we should be also able to import
  massive quantity of md file, making a translation layer for Obsidian
  format." This is the redefined **27b** (bulk import in an Obsidian-compatible
  format, product owner 2026-11-05). The old 27b "Document PDF" ticket keeps
  its file and is unrelated.
- Example file (`Jason Bright 1.md`, a Vampire NPC sheet) shows what an Obsidian
  note looks like: an image embed `![[jasonbright_new 1.jpg]]`, `#` headings used
  as sections of one note (Status, Dominio, Alleati, Descrizione, Background),
  and wikilinks `[[Società dei Mostri]]`, `[[Nadezda Jakovlevna]]` that point at
  other notes by **file name**.
- The import of spec 27 already reads Markdown, but in two layouts that clash
  with Obsidian: the app's own export, and "hand-written" where **every `#`
  heading is a Document**. An Obsidian file with five `#` headings would become
  five Documents, and `[[links]]` and `![[images]]` would stay raw text.
- A new reader (a **translation layer**) turns Obsidian Markdown into the same
  `ImportBundle` the rest of spec 27 uses, so preview, Copy/Replace, Tags,
  limits, the background job and image blocks (spec 59) are reused unchanged.
- **Backend reader and a small frontend change. No migration** (the job payload
  is JSONB; unless Q5 chooses a column). `requirements.md` unchanged.

## Decisions (proposed 2026-11-08, awaiting the product owner)

1. **One file = one Document.** The Document's name is the file name without
   `.md` (as Obsidian shows it). The first `# Title` line is not a name; all
   headings stay inside the description as Markdown (spec 48 renders them).
   Why not Notes: Obsidian sections are part of one page and the app's Notes are
   separate, visibility-controlled blocks. Q1 offers the alternative.
2. **Detection.** A `.md` file is read as Obsidian when it has YAML front matter
   or an Obsidian-only sign (`[[...]]`, `![[...]]`, `> [!callout]`, `%%comment%%`)
   and no export anchors. Files with none of these keep today's hand-written
   rule, so existing imports don't change. The dialog also has an explicit
   "Obsidian vault" choice that forces the Obsidian reader (Q2).
3. **Syntax translated** (everything else stays Markdown text):
   - `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]`, `[[Note#^block]]`: a
     mention of the Document named `Note` **when that file is in the same
     import**; matched case-insensitively on file name or front matter
     `aliases`. The heading/block part is dropped. If the target is not in the
     import, it becomes plain `Note` (the alias if one is given), the same rule
     spec 27 Decision 14 uses for any Document outside the file.
   - `![[image.jpg]]`: an image of the Document, if the image file is in the
     import (Decision 5); otherwise dropped and listed as a warning. Embeds of
     other notes `![[Note]]` become a mention. `![alt](relative/path.png)` too.
   - Front matter: `tags:` and `aliases:` are read; `cssclasses`, `created`, and
     other keys are ignored. Inline `#tag` and `#nested/tag` become Tags
     (nested keeps its last segment, Q4). A `#` followed by a space is a heading,
     not a Tag; headings, code blocks and URLs are not scanned.
   - Dropped as text with a count in the preview: `%%comments%%`, Dataview and
     other plugin code blocks stay as code. Callouts (`> [!note]`) become plain
     block quotes. `==highlight==` and `^block-ids` are removed.
   - Hidden `.obsidian/` and `.trash/` folders are never read.
4. **Many files at once.** Today: 10 files, 200 Documents per import. For a
   vault this is too low, so: the picker accepts **a folder** (browser
   directory upload) **or a `.zip`** of the vault, up to **500 Documents** and
   **100 MB** total (single `.md` still 5 MB). The 200-Document cap and the
   10-file cap stay for plain JSON/Markdown uploads. The upload is read in
   memory with zip-bomb limits (entry count, uncompressed size ratio, no path
   traversal, symlinks ignored). Q3 asks about the numbers.
5. **Images are in the vault, not at a URL.** Obsidian attachments sit in the
   vault, so unlike spec 27 Decision 15 there is no link to fetch: the bytes come
   from the zip/folder. They go through the same image pipeline (content check,
   EXIF stripped, 1920 px, WebP) and the saved blocks of spec 59. The job needs
   the bytes after the request ends, so the upload is **staged temporarily** (Q5)
   and deleted when the job ends. **This amends spec 27 Decision 17** ("the
   uploaded files are not kept"): for a vault the bytes of the pictures (not the
   notes, which are parsed into the job as before) are kept until the job ends.
   Access: a private bucket (never a public URL), objects under a
   `imports/<room_id>/<job_id>/` prefix, written and read only by the backend
   with the service role, never signed for the client. Cleanup: removed when the
   job finishes or fails, through the existing `storage_cleanup` outbox and
   sweeper, so a crash before cleanup is caught at startup (`interrupted`) and by
   the 7-day housekeeping of finished jobs. `architecture.md` (storage model and
   invariants) is updated in 65_2, before the staging code is merged. An image shared by several notes is stored once
   per Document. Missing files are skipped and listed.
6. **Folders become Tags** (default): a note in `Characters/Vampires/` gets the
   Tags the Room already has by that name or creates `Vampires` (only when the
   importer may manage Tags, spec 27 Decision 11). Q6 can turn this off.
7. **Everything else as spec 27**: Copy by default and Replace when a Document
   with the same name exists in the Room (Obsidian files have no id, so
   "existing" is matched by **name**, case-insensitive), visibility = the Room's
   default, importer = Owner, comments and attachments don't exist in a vault,
   one transaction for texts then image blocks, preview with per-Document
   warnings, no write when refused.
8. **Round trip is not a goal.** Obsidian import is one-way. Exporting the Room
   as an Obsidian vault (Markdown files + `[[links]]` + attachments folder) is
   noted as a possible follow-up, not built here.

## Design

### Backend

- `app/domain/import_obsidian.py` (pure): `parse_obsidian(files)` takes
  `(path, bytes)` entries and returns an `ImportFile` per note, resolving
  wikilinks across the whole set (the name index is built first, then each text
  is translated), plus the attachment index. `ImportDocument` gains
  `attachments` (vault path + bytes reference) next to `images` (URLs); a note's
  Markdown embeds are converted so the body keeps `![](...)` lines only where
  spec 48 shows images.
- `app/domain/import_files.py::parse_file` routes to it (Decision 2);
  `import_vault.py` reads zip/folder uploads with the limits of Decision 4.
- `POST /rooms/{id}/imports/preview` and `POST /rooms/{id}/imports` accept the
  zip, or many `files[]` with relative paths in their filenames (a folder
  upload). Same 202 job, same 409, same errors plus `errors.import.vaultTooBig`
  and `errors.import.unsafeArchive`.
- Image blocks (spec 59) learn a second source: the staged bytes instead of a
  URL; the staging area (Q5) is cleaned with the job and by the sweeper.
- Tests at 100%: the example file (front matter absent, five `#` headings stay
  in one Document, `![[...]]`, nested `[[links]]`); alias, heading and block
  links; link to a missing note becomes text; inline Tags vs headings; code
  blocks and URLs untouched; folder Tags; zip traversal, bomb and symlink
  refused; image from the vault stored, missing one listed; hand-written
  Markdown unchanged; Replace by name.

### Frontend

- `ImportDocumentsModal`: the picker accepts `.json`, `.md`, `.zip` and a
  "Choose a folder" button; an "Obsidian vault" switch (Decision 2). The
  preview lists unresolved links and missing images as warnings. Hint text
  explains what is translated. New strings in `en.json` and `it.json`.
- The Import tooltip/menu text mentions Obsidian.

## Implementation

- **65_1** reader and tests (backend, no API change; single `.md` Obsidian files
  already work through the existing upload), **65_2** vault upload (zip/folder,
  staging, image bytes), **65_3** frontend. Into `staging`, in this order; 65_1
  is useful on its own.
- Update `architecture.md` (import: Obsidian reader, vault upload limits) and
  `progress-tracker.md`.

## Definition of Done

- The example file imports as **one** Document "Jason Bright 1" with its five
  sections as headings in the description.
- A vault zip with 300 notes and their pictures imports in one go: links between
  the notes become mentions, links to missing notes become text, images attached.
- A folder upload behaves like the zip.
- Existing JSON and hand-written Markdown imports behave exactly as before.
- Backend `pytest` (100% coverage), `ruff`, `mypy`; frontend `npm run build`,
  `npm run lint`, `npm test`.

## Open Questions (defaults in bold)

1. Sections: keep headings inside the description (**yes**) or turn each
   `#` section into a Note?
2. Detection: **automatic with a manual "Obsidian vault" switch**, or manual only?
3. Limits for a vault: **500 Documents, 100 MB**. Higher? (Supabase Storage on
   the free plan is 1 GB, see spec 59.)
4. Nested tags `#a/b`: **keep the last segment (`b`)**, or the whole path?
5. Image bytes between request and job: **temporary Storage objects deleted at
   job end** (no migration), or a table column (migration)?
6. Folders as Tags: **on**, or off?
7. A wikilink to a note **not in the import but already in the Room**: **link it
   by name** (convenient for re-importing a vault in parts), or plain text?

# 70 - Relational link flag in import-export

## Goals

- Product owner's report (2026-11-10): "tra import, export o sostituzione, ci
  perdiamo la proprietà Link Relazionale su certe Note dei Documenti."
- Spec 41 (Decision 7) left the flag out of the JSON export/import "as
  proposed"; combined with Replace (spec 27 Decision 6), which deletes a
  Document's Notes and creates the file's, a Note flagged as a Relational
  link comes back unflagged and its relations vanish from the mention maps.
- Keep the flag on every path that moves Notes. **Backend, small frontend
  (none expected), no migration, no new endpoint.**

## Where it is lost today (read from the code)

| Path | Today |
|------|-------|
| JSON export (Room / one Document) | `ExportNote` and `export.py` write no `relational_link` |
| Import as Copy | `ImportNote` / `PlannedNote` have no flag: every new Note is unflagged |
| Import as Replace | `imports_repo` deletes the Document's Notes and inserts the file's, unflagged, so flags set in the Room are erased |
| Markdown export/import | no flag (plain text format) |
| Duplicate Room (spec 33) | **keeps it** (`room_copy_repo`), no change |
| History restore of a deleted Note (spec 41 Decision 7) | comes back unflagged, no change |

## Decisions (proposed defaults, to confirm)

1. **JSON carries the flag.** Each Note in the export gets
   `relational_link: bool`; `SCHEMA_VERSION` 5 -> 6 (older files stay
   readable; a file with a higher version is refused as today).
2. **Import reads it.** A copied Note and a Replace's new Notes take the
   file's flag. A file with no field (exports made before this, hand-written
   JSON, Markdown) means "not stated".
3. **Replace with "not stated" keeps what the Room has.** The new Note takes
   the flag of the Room's old Note on that Document with the same title
   (case and edge spaces ignored, one old Note used once), else it is
   unflagged. This repairs the case of Room 1's JSON exported before this
   change and imported into its copy: flags already in the copy survive.
   When the file does state the flag, the file wins.
4. **Markdown stays plain.** The Markdown export does not carry the flag
   (no new syntax in a human-readable format); the Decision 3 rule still
   protects the flag on a Replace from Markdown.
5. **Mention maps follow.** After a Replace the backlinks of the new Notes
   are indexed as today; with the flag kept, the maps show the same
   relations. No preview wording change; the existing preview already lists
   Notes counts only.
6. **Out of scope:** restoring a deleted Note from the History (spec 41
   Decision 7), flags on descriptions or Comments.

## Design

- `export.py`: `ExportNote.relational_link`, `_note` JSON, `SCHEMA_VERSION =
  6`; Markdown output unchanged.
- `import_files.py`: `ImportNote.relational_link: bool | None` read from the
  JSON, kept through the job payload (serialise / parse at ~lines 596, 627).
- `imports.py`: `PlannedNote.relational_link`; for a Replace, the plan gets
  the Room's existing Notes (id, title, flag) through `ExistingDocument` and
  applies Decision 3; a Copy uses the file's flag or False.
- `imports_repo.py::_note_rows` writes the flag; the Replace path reads the
  old Notes' flags before deleting them (the caller loads them in
  `ExistingDocument`).
- Tests: export carries the flag; import Copy keeps/defaults it; Replace
  keeps by title when not stated, uses the file's when stated, two Notes
  with the same title; schema 6 round trip; older-schema file still reads.
- Docs: `architecture.md` (export/import bullets), tracker; ticket 41
  Decision 7 gets a pointer here.

## Open Questions

1. Decision 3 (flag kept from the Room's same-title Note when the file is
   silent): yes? (Default: yes.)
2. Should Markdown carry the flag somehow (e.g. a marker on the Note's
   heading), or stay plain? (Default: stay plain.)
3. Also fix the History restore (deleted Note comes back flagged)? (Default:
   no, a separate ticket if wanted.)

## Answers (product owner, 2026-11-10)

1. Yes: a silent file keeps the flag of the Room's same-title Note on a Replace.
2. OK: Markdown stays plain.
3. No: the History restore is left as it is.

## Built (2026-11-10)

- Export: `relational_link` per Note (`NoteJson`, `SCHEMA_VERSION` 6).
- Import: `ImportNote.relational_link` (None when absent, also in the job
  payload), `PlannedNote.relational_link`, written by `imports_repo`.
- Replace: `ExistingDocument.relational_titles` loaded in
  `load_import_context` for the Documents the importer manages.

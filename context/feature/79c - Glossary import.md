# 79c - Glossary import

## Goals

- Product owner's request (2026-11-27, same thread as ticket 79): "voglio
  anche l'import". Ticket 79 put the Glossary in the Room's JSON export
  (`schema_version` 7, list `glossary`) but the import reads the file and
  ignores that list (79, "Built" section, "Left out for now"). An exported Room imported again loses
  its terms.
- Goal: the JSON import (spec 27, with Maps of spec 40, Sections of spec 56
  and Clocks of spec 61) also brings the Glossary entries, with a preview
  where the importer picks them, like the custom Sections.

## Today

- `domain/import_files.py` reads a JSON file into `ImportFile` (Documents,
  Tags, maps, sections, clocks). `glossary` is not read.
- `domain/imports.py` plans the import (`plan_import`), the preview lists
  Documents, maps and Sections with ticks (`ImportChoices`), and the job
  writes them in blocks.
- The Markdown export has a "## Glossary" section, but the Markdown import
  reads Documents only.

## Decisions (confirmed by the product owner, 2026-11-27)

1. **Who.** Only someone who manages the Glossary (Administrator or Master,
   79 Decision 3) imports entries. For anyone else the file's `glossary`
   list is ignored, and the preview says so in one line ("Il glossario del
   file non viene importato: solo Master e Amministratori").
2. **Preview.** A "Glossario" group in the import preview lists every entry
   of the file (term, aliases), all ticked. The importer can untick any.
   Same look as the custom Sections group (spec 56).
3. **A word already defined in the Room.** Words are
   unique per Room (79 Decision 1). When the file's **term**
   matches an existing entry (same word ignoring case and accents), the
   preview shows "esiste già" with a choice between **Salta** (the default)
   and **Sostituisci** (the existing entry takes the file's term, aliases,
   definition, Tags, Documents and highlight; it keeps its own visibility,
   as a replaced Document does in spec 27 Decision 6). An **alias** that is
   already another entry's word is dropped from the imported entry, with a
   warning in the report.
4. **Links.** The file's `tag_ids` map to Tags through the file's Tags, by
   name, exactly as for Documents (matched, or created: whoever manages the
   Glossary may also create Tags, so none is dropped). `document_ids` point
   at the Documents of the same import (by their id in the file) or at a
   Room Document the importer sees with that id; any other is dropped.
   Mentions in the definition are resolved like those of a Document's
   description.
5. **Visibility.** The file's level is kept. A Selective entry becomes
   Private (the export doesn't carry who was chosen), like a Selective Note
   in spec 27 and like the Room copy (79 Decision 8). An unknown level takes
   the Room's default.
6. **Limits.** At most 2,000 entries per Room, the cap the build of 79 put in
   `MAX_ENTRIES_PER_ROOM` (`domain/glossary.py`). Entries past the limit
   are skipped and counted in the report. Field limits (term 120, 10
   aliases, definition 10,000, 20 Documents) are enforced; an entry that
   breaks one is skipped with a warning.
7. **Markdown and Obsidian.** Not in this ticket: the
   import reads the JSON export only. The Markdown export's Glossary section is for reading. An
   Obsidian import of terms is a separate idea (79, "Left out for now").
8. **Files from older exports** (schema 1 to 6) have no `glossary`: nothing
   changes for them. The import still accepts schema up to 7.

## Answers (2026-11-27)

1. A term already in the Room: Salta or Sostituisci per entry, Salta by
   default (Decision 3).
2. JSON only for now (Decision 7).

## Tests

- Backend: export then import into another Room brings the visible entries
  with their Tags, linked Documents and mentions remapped; a Player's import
  brings none; Selective becomes Private; skip and replace of an existing
  term; colliding alias dropped with a warning; limits.
- Frontend: the Glossary group in the preview, ticks, the Salta /
  Sostituisci choice, the line for non-managers; 12 languages.

## Estimate

About 1.5 hours of Claude's build time, tests included. No migration.

## Built (2026-11-27, PR #384)

- Backend: `ImportFile.glossary` (`domain/import_files.py`), planned in
  `plan_import` (`_plan_glossary`, keys `"{file}:glossary:{index}"`), shown
  in the preview (`glossary`, `glossary_left_out`) and written by the job
  under the Glossary lock (`_write_glossary`). The choices carry `glossary`
  and `glossary_replace`; the result carries `glossary` and
  `skipped_glossary`. Skip reasons: `exists` (a visible entry has the term),
  `taken` (a word belongs to another entry, hidden ones included, so
  nothing leaks), `invalid`, `limit`. Warnings: `aliases_dropped`,
  `selective_to_private`.
- Frontend: a Glossary group in the import review (ticks, Salta /
  Sostituisci for `exists`, reasons and warnings, a line when the files
  hold entries the importer may not bring), the written entries as links
  to the Glossary page, the skipped ones with their reason; 12 languages.
- No migration.

## Glossary-only files (product owner, 2026-11-28)

The product owner's own glossary file (a JSON with `schema_version` and
`glossary` only) was refused. Agreed fix:

- A JSON file may bring Glossary entries alone: the `documents` list may be
  left out when `glossary` is there, and a file with entries but no
  Document is read. Starting needs at least one Document or entry chosen
  (else `errors.import.nothingSelected`).
- A Document mention in a definition that points at no Document of the
  file links to the Room's Document with that id when the importer sees it,
  as the linked Documents already do; any other stays plain `#Name`.
- Hand-written spans are read leniently: a mention's shown word may be in
  `text` (the export writes `name`), and its kind may be `document` (the
  export writes `doc`).
- The review hides the Documents count when the files hold none.


# 79b - Glossary import

## Goals

- Product owner's request (2026-11-27, same thread as ticket 79): "voglio
  anche l'import". Ticket 79 put the Glossary in the Room's JSON export
  (`schema_version` 7, list `glossary`) but the import reads the file and
  ignores that list (79, "Not built"). An exported Room imported again loses
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

## Decisions (proposed)

1. **Who.** Only someone who manages the Glossary (Administrator or Master,
   79 Decision 2) imports entries. For anyone else the file's `glossary`
   list is ignored, and the preview says so in one line ("Il glossario del
   file non viene importato: solo Master e Amministratori").
2. **Preview.** A "Glossario" group in the import preview lists every entry
   of the file (term, aliases), all ticked. The importer can untick any.
   Same look as the custom Sections group (spec 56).
3. **A word already defined in the Room (open question 1).** Words are
   unique per Room (79 Decision 4). Proposal: when the file's **term**
   matches an existing entry (same word ignoring case and accents), the
   preview shows "esiste già" with a choice between **Salta** (the default)
   and **Sostituisci** (the existing entry takes the file's term, aliases,
   definition, Tags, Documents and highlight; it keeps its own visibility,
   as a replaced Document does in spec 27 Decision 6). An **alias** that is
   already another entry's word is dropped from the imported entry, with a
   warning in the report.
4. **Links.** The file's `tag_ids` map to Tags through the file's Tags, by
   name, exactly as for Documents (matched, created when allowed, otherwise
   dropped with the usual `tags_not_created` warning). `document_ids` point
   at the Documents of the same import (by their id in the file) or at a
   Room Document the importer sees with that id; any other is dropped.
   Mentions in the definition are resolved like those of a Document's
   description.
5. **Visibility.** The file's level is kept. A Selective entry becomes
   Private (the export doesn't carry who was chosen), like a Selective Note
   in spec 27 and like the Room copy (79 Decision 7). An unknown level takes
   the Room's default.
6. **Limits.** At most 2,000 entries per Room (79). Entries past the limit
   are skipped and counted in the report. Field limits (term 120, 10
   aliases, definition 10,000, 20 Documents) are enforced; an entry that
   breaks one is skipped with a warning.
7. **Markdown and Obsidian (open question 2).** Proposal: not in this
   ticket. The Markdown export's Glossary section is for reading. An
   Obsidian import of terms is a separate idea (79, "Not built").
8. **Files from older exports** (schema 1 to 6) have no `glossary`: nothing
   changes for them. The import still accepts schema up to 7.

## Open questions

1. When a term is already in the Room: Salta / Sostituisci per entry, with
   Salta by default (proposal, Decision 3)? Or always skip, or always
   replace?
2. Leave the Markdown and Obsidian import out (proposal, Decision 7)?

## Tests

- Backend: export then import into another Room brings the visible entries
  with their Tags, linked Documents and mentions remapped; a Player's import
  brings none; Selective becomes Private; skip and replace of an existing
  term; colliding alias dropped with a warning; limits.
- Frontend: the Glossary group in the preview, ticks, the Salta /
  Sostituisci choice, the line for non-managers; 12 languages.

## Estimate

About 1.5 hours of Claude's build time, tests included. No migration.

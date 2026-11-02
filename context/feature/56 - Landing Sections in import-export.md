# 56 - Landing Sections in import-export

## Goals

- Product owner's request (2026-11-02): the Room landing page (spec 55)
  should travel with the Room. **Duplicate Room already copies it**
  (spec 55: Sections, blocks, groups and images, re-pointed at the copied
  Tags). This ticket adds it to the **JSON Room export** (spec 23) and the
  **import** (spec 27), the way spec 40 did for maps, in a PR of its own
  (product owner's choice, 2026-11-02).
- No migration: every table already exists.

## Decisions (proposed by Claude, confirmed by the product owner 2026-11-02)

### Export

1. **JSON only**: the Room export's JSON gets a `sections` list and
   `schema_version` becomes **4** (the import reads 1 to 4; older files
   have no Sections). Markdown, the Room PDF and a single-Document export
   don't change.
2. **Every Section is in it**, page cards included, in the landing's
   order: every member sees every Section (spec 55 Decision 5, no
   Master-only Sections), and a block lists nothing by itself, only rules
   (Tags, map kind, features), so nothing hidden can leak through it. A
   Tag-filtered export keeps every Section; the import drops what points
   at Tags it can't resolve (Decision 7).
3. **Shape** of a Section: `id`, `kind`, `title` (null on an untouched
   page card), `description`, `image_url` (a signed link that expires,
   like map backgrounds), and `blocks`, each with `kind`, `heading`,
   `tag_ids`, `groups` (lists of Tag ids, in order), `map_kind`,
   `features`. Tag ids point into the file's `tags` list, so the import
   matches them by name like a Document's Tags.

### Import

4. **Only the Master's import brings Sections**, since only the Master
   edits the landing (spec 55). For anyone else the preview doesn't list
   them and nothing is written.
5. **Custom Sections are always new**: each one becomes a new Section
   at the end of the landing, fresh ids, in file order. The preview lists
   them with a tick each, checked by default (like maps, spec 40 Decision
   9).
6. **Page cards are not imported as cards** (every Room has its own).
   A page card of the file with a Master's title, description or image
   is offered in the preview as "apply to the Room's card", unchecked by
   default; ticked, it overwrites that card's title and description, and
   its image when the file's card has one (a card with no image in the
   file keeps the Room's). A page card the Room has deleted is added back.
7. **Tags** are resolved like the Documents' (spec 27 Decision 11): by
   name to the Room's Tags or to the ones the import creates. A Tag that
   can't be resolved is dropped from the block and its groups; a group
   left empty goes; a Documents block left with no Tag is **skipped**, and
   the preview says how many blocks are skipped per Section.
8. **Same rules as an edit**: titles, descriptions, blocks and groups go
   through `plan_new_section` / `plan_blocks`. A Section that fails them
   is skipped whole with reason `invalid`; Sections past the Room's cap
   of 30 are skipped with reason `limit`. It never fails the import.
9. **Written with the Documents and maps**, in the import's one
   transaction. Then, best effort like map backgrounds (spec 40 Decision
   13): the **image** is read from this app's own Storage when it is
   there, else fetched from its link, validated and stored like an
   uploaded Section image; one that fails is listed (`image`) and the
   Section stays without it.
10. The result lists the Sections created (links to them), the page
    cards updated, and what was skipped with the reason. The landing is
    read again when the job ends (and a `landing` event tells the other
    tabs).

## Design

- **Backend**
  - `app/domain/landing_transfer.py` (pure): `section_to_json` for the
    export; `read_sections` (file → file Sections) and `plan_sections`
    (→ planned Sections, Decisions 5 to 8) for the import.
  - `app/api/export.py`: the Room JSON export reads the Sections;
    `app/domain/export.py` bumps `SCHEMA_VERSION` to 4.
  - `app/domain/import_files.py` reads `sections`; `app/domain/imports.py`
    plans them with the same Tag book as the Documents; `app/api/imports.py`
    previews them and takes `sections` and `page_cards` in the choices;
    `app/api/import_job.py` writes them, then stores the images.
- **Frontend**
  - The import preview lists the Sections (ticks, skipped blocks) and the
    page cards to apply; the choices send them; the result lists what was
    created and skipped. New strings in all 12 locales.
- Docs: `architecture.md` (export, import), `progress-tracker.md`.

## As built (PR #284)

- Keys: a Section of the file is `"<file>:section:<index>"`; the choices
  take `sections` (custom ones, all when absent) and `page_cards` (none
  when absent). The preview lists page cards for the client to leave
  unticked; a page card without a title, description or image is not
  listed. At most 100 Sections per import (422).
- The job plans against the Room home as it is when it starts, and counts
  the cap of 30 again under the Room's lock when it writes.
- Tags a Section needs are created like a Document's (the Master may
  always create Tags), so the preview's "Tags to create" includes them.

## Units

| Unit | What | Migration | Claude's build time |
|---|---|---|---|
| 56_1 | Backend export + import, tests at 100% | no | about 1 h |
| 56_2 | Frontend preview and result, i18n, tests at 100% | no | about 45 min |

## Tests

- A Room's JSON export holds its Sections in order, page cards included,
  with blocks, groups and features, and `schema_version` 4.
- A Master importing that file into another Room gets the custom
  Sections at the end of the landing, their Tags matched or created by
  name; a block whose Tags all fail is skipped and reported.
- A page card ticked in the preview takes the file's title, description
  and image; unticked it stays as it is.
- A Player's import writes no Section; an old file (version 1 to 3)
  imports as before.
- Over the cap of 30, the extra Sections are skipped with `limit`; an
  image that can't be fetched leaves the Section without one.
- Backend `pytest` (100% coverage), `ruff`, `mypy`; frontend build,
  lint, tests (100% coverage).

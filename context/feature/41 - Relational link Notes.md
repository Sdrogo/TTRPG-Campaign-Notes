# 41 - Relational link Notes

## Goals

- Product owner's request (2026-10-21): "Possiamo flaggare alcune note come
  Link Relazionali. Questi saranno le sole note prese in considerazione per
  la generazione automatica delle mappe relazionali che abbiamo già
  implementato."
- A Note can be flagged as a **Relational link** ("Link relazionale"). Only
  the mentions written in flagged Notes draw relations on a Document's
  mention map (spec 36), so a map shows the ties someone chose, not every
  name the text happens to contain (spec 39 links names by itself on save,
  which filled the maps).
- `requirements.md` has no requirement for maps (spec 28, 36); this ticket
  adds none.

## Decisions

Defaults picked 2026-10-21, to confirm in the PR.

1. **Only flagged Notes feed the mention map** (recommended to the product
   owner on a decision card, 2026-10-21): a mention counts for a mention map
   only when it is written in a Note flagged as a Relational link.
   Descriptions, unflagged Notes and Comments no longer draw relations on a
   mention map. Everything else that reads mentions is unchanged: "Mentioned
   in" (spec 20), the hover preview (spec 32), search, export and the
   generate-mentions dialog (spec 39) still see every mention.
2. **A flag per Note, off by default**: a new Note starts unflagged; existing
   Notes stay unflagged, so an existing mention map shows nothing (spec 36
   Decision 12: no relation, no board) until someone flags a Note.
3. **Who sets it**: whoever may edit the Note (its Document's Owners and the
   Master, spec 12), in the Note's add and edit form, as a switch under the
   visibility. Not while previewing as a member (spec 22b refuses writes).
   Flagging is not audited and records no revision in the History (spec
   24b): it changes no text and no visibility.
4. **Who sees it**: every reader of the Note sees a small "Relational link"
   badge next to its title, so a Player knows why an arrow is there.
   Visibility is untouched: a flagged Note keeps its own level, and spec 36
   Decision 7 still applies, so a mention in a flagged Note the viewer can't
   see draws nothing for them.
5. **Both directions**: a flagged Note on Document A mentioning B draws
   A → B on A's map and on B's map, like any mention (spec 36 Decision 5).
   The flag is about where the mention is written, not about which map shows
   it.
6. **The modal says why it is empty**: when the mention map modal finds
   nothing (spec 36 Decision 11), its message says that only the mentions
   written in Notes flagged as Relational links count.
7. **Copies**: duplicating a Room (spec 33) keeps each Note's flag. Restoring
   a deleted Note from the History brings it back unflagged. The JSON
   export/import (spec 27, 40) does not carry the flag (*proposed*; a later
   ticket if wanted).
8. **Not in scope**: flagging descriptions or Comments, a flag per mention,
   a filter on the free maps of spec 28 (they are drawn by hand).

## Design

### Backend (41_1)

- Migration: `document_notes.relational_link BOOLEAN NOT NULL DEFAULT
  false`. Existing rows take `false` (Decision 2).
- `Note.relational_link: bool = False` (domain), mapped by `notes_repo`;
  `NoteResponse.relational_link`; `CreateNoteRequest.relational_link` (default
  `false`) and `UpdateNoteRequest.relational_link` (omitted = unchanged),
  through `plan_new_note` / `plan_note_edit`. Changing only the flag does
  not record a revision.
- `mentions_repo.list_document_mentions_touching` (the mention map's only
  source) keeps only `source_kind = 'note'` rows whose Note is flagged, by
  joining `document_notes`. Preview, map and "Copy as a free map" all read
  through it.
- Room duplication: `SourceNote.relational_link`, copied to the new
  `NoteRow`.

### Frontend (41_2)

- `Note.relationalLink`, `NoteFormValues.relationalLink`, sent by
  `toNoteBody`.
- `NoteForm`: a `Switch` "Link relazionale" with the hint "Solo le menzioni
  scritte nelle Note con questo flag disegnano frecce nella mappa delle
  menzioni."
- `NoteItem`: a small badge next to the title when flagged, for every reader.
- Mention map modal: the "No mentions yet" text mentions flagged Notes.
- Strings in all 12 languages; "Relational link" added to the i18n glossary.

## Tests

- Backend: a mention in an unflagged Note, a description or a Comment draws
  nothing; the same mention in a flagged Note draws it; flag create/edit
  round-trip; edit without the field keeps the flag; Room duplication keeps
  it.
- Frontend: the switch sends the flag; the badge shows when flagged.

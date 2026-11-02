# 60 - Sections refinements and standalone tools

## Goals

- Product owner's request (2026-11-02): "Al momento, in una sezione con la
  possibilità di inserire blocchi custom non possiamo creare singole istanze
  di feature della sessione 0 scollegati da una sessione 0. Vorrei che sia
  possibile di definire sondaggi, retro ed altro a prescindere da una
  sessione 0. Un altro problema di UX che trovo è che se sono dentro una
  sezione non ho un modo semplice di modificarne il nome e la descrizione in
  maniera semplice. Vorrei che un intero blocco possa essere compresso in
  maniera semplice. Inoltre dovremmo apportare delle modifiche alla pagina
  default dei document. Rimuovendo la lista delle mappe e conformare la UI
  dei raggruppamenti della Document page a quella dei blocchi di una
  sezione. È anche abbastanza contro intuitivo che sia possibile aggiungere
  una nuova sezione solo in modalità modifica della Room."
  (Today a Section's custom blocks can't hold single instances of Session 0
  features unlinked from a Session 0: I'd like to define polls, retros and
  more regardless of a Session 0. Inside a Section there is no simple way
  to edit its name and description. A whole block should fold easily. The
  default Documents page should lose the maps list and its groups should
  look like a Section's blocks. Adding a Section only in the Room's edit
  mode is counter-intuitive.)
- Five changes over spec 55 (Room landing page) and the Documents page:
  1. **Tool blocks**: a block that *is* one Session 0 tool (a poll step, a
     Retro, Stars and Wishes, Questions, a DDI), living in the Section, with
     no Session 0 session behind it.
  2. **Section title and description edited in place** on the Section.
  3. **Every block folds** from its heading.
  4. **Documents page**: no maps row; its groups look like Section blocks.
  5. **"Nuova sezione" outside edit mode** for the Master.
- `requirements.md` is protected and is not changed by this ticket.

## Decisions

Proposed by Claude on 2026-11-02 from the request; the open questions are
at the end (Q1-Q7) and every default below holds until the product owner
answers otherwise.

### 1. Tool blocks (standalone Session 0 tools)

1. **A new block kind, `tool`**, beside `documents`, `maps` and
   `session_zero`. A tool block holds **one** instance of one Session 0
   tool, created with it and deleted with it:
   - **Sondaggi**: a Poll step (spec 53/54): up to 10 polls, every poll
     setting as in Session 0 (votes per person, Master votes, who sees the
     voters, live or secret tally, close, reveal), choices as cards.
   - **Retro**: a Retro board with the Master's columns, post-its,
     drafts and publish, groups, reactions (spec 46/47).
   - **Stelle e Desideri**: the two fixed columns (spec 47 Decision 7).
   - **Domande**: questions and answers, the Documents made from them, the
     reveal (spec 47_2), with the same Tag setting.
   - **DDI**: one Document and the Players' acceptances (spec 47_3).
   **Linee e Veli** is one board per Room (spec 46 Decision 10), so it is
   not a tool instance: it stays reachable from a `session_zero` block (Q2).
2. **It shows inline, inside the Section** (Q1): the block's body is the
   tool itself, drawn by the same components the Session 0 page uses
   (`PollModule`, `BoardColumns`, `QuestionsModule`, `DdiModule`), full
   width under the block heading. Members vote, add post-its, answer and
   accept right there, with the same rights as in Session 0 (Players act,
   the Master sets up and manages). Folding the block (Decision 9) keeps a
   long Retro out of the way.
3. **Not part of any Session 0 session**: a tool block's instance is never
   listed on the Session 0 page, in its session picker, in "Carry over from
   the previous session" (spec 47b), nor in a `session_zero` block or the
   overview. The Session 0 timer and the step chain ("Avanti", current
   step) don't apply to it.
4. **Draft until shown** (Q3): a new tool block starts **hidden from
   Players**, so the Master can prepare a poll or a Retro's columns
   without Players seeing it half done. The block bar gets an eye toggle
   ("Visibile ai giocatori" / "Nascosto ai giocatori"); a hidden block shows
   a "Bozza" badge to the Master, and for Players it is absent from the
   Section and from the Index, as if it didn't exist. The Master can hide
   it again later (votes, post-its and answers are kept). The toggle exists
   only on tool blocks: the other kinds already follow their items' own
   visibility (spec 55 Decision 3).
5. **Adding one**: the "+ Blocco" popover (spec 55 Decision 14) keeps its
   three tiles and gains a second row, **Strumenti**, with five small tiles
   (Sondaggio, Retro, Stelle e Desideri, Domande, DDI; icon and name, the
   icons of the Session 0 steps). Picking one creates the block and its
   instance at once and opens its setup where Session 0 opens it: the
   polls dialog for Sondaggi, "Aggiungi colonna" for Retro, the questions
   dialog for Domande, the Document picker for DDI. Stelle e Desideri
   needs no setup. The block's heading defaults to the tool's name.
6. **Deleting one** deletes its instance with every vote, post-it, answer
   and acceptance, so it asks for confirmation naming what is lost, and it
   has **no 5 s undo** (unlike the other blocks, spec 55 Decision 13).
   Documents made by Domande stay (they are the Players' Documents), as
   when a Questions step is deleted today. Deleting the Section deletes its
   tool blocks the same way.
7. **Live updates**: a tool block refreshes for every member as the same
   tool does on the Session 0 page (the Room stream of spec 52), so votes
   and post-its show up without reload.
8. **Duplicate Room and JSON export** (Q4): a tool block is copied with its
   **setup only** (the polls with their choices and settings, the Retro's
   columns, the questions, the DDI's Document when it is copied too), with
   no votes, post-its, answers or acceptances, and starts hidden from
   Players. The JSON export carries the same setup (schema 5) and the
   Master's import adds it with the Section.

### 2. Folding blocks

9. **Every block folds from its heading**, in reading mode and for every
   member: the heading gets the caret and the count badge of a Documents
   group (`document-group-toggle`), at the block's size (h4, display
   font). It starts open and the state is not remembered, as Documents
   groups (Q5). The count is the number of cards (polls for Sondaggi;
   no count for Retro, Stelle e Desideri, DDI). Its sub-sections (groups,
   features) keep folding on their own. The Index entry still scrolls to
   the block and opens it if folded. In edit mode the block bar replaces
   the heading as today and the caret sits at its start.

### 3. Section title and description in place

10. **On a custom Section in edit mode**, the heading itself becomes
    editable, like a block heading (spec 55 Decision 13): click the title,
    type, Enter (Esc cancels; empty is refused); under it the
    description is a mention textarea (spec 48) shown as "Aggiungi una
    descrizione" when empty, saved on blur. Beside the title a small image
    button opens `SectionInfoModal` for the image only. The landing's
    ⋮ "Modifica info" stays as it is.
11. **Outside edit mode**, the Master's "Modifica" button (spec 55 Decision
    11) is the way in: no extra pencil beside the title, to keep the page
    as the Players see it.
12. Page cards (Documenti, Mappe, Sessione 0) are edited where they are
    today (the landing's ⋮); their pages are not Sections.

### 4. Documents page

13. **The maps row goes away** from the Documents page (`RoomMapsStrip`,
    spec room-maps-strip, PR #236), and with it the "Mappe" row of the
    Room setup's Grouping (the place it took among the groups) and the
    Room's `maps_position` (dropped by this ticket's migration). Maps stay
    reachable from the landing's "Mappe" card, from a maps block, from the
    Index and from the quick menu. The read-only preview's map icon in the
    heading also goes (the preview reaches maps from the landing like
    everyone else).
14. **Its groups look like Section blocks** (Q6): each Main item group is
    drawn by the same component as a Section block's heading (Decision 9):
    the block's size and display font, not dimmed, caret and count, the
    same spacing between blocks; "Senza Tag principale" (`ungroupedTag`)
    last. Cards, filters, sort and the "Raggruppa per" switch don't change.
    One component (`BlockHeading`) serves both pages, so they can't drift
    apart again.

### 5. New Section outside edit mode

15. **The dashed "Nuova sezione" card closes the landing's grid for the
    Master always**, not only in edit mode. It works as today (title only,
    Enter, then the new Section opens in edit mode with the add-block
    picker open). Players and the read-only preview never see it.
16. The **Index** gets a "+ Nuova sezione" line at the end of its Sezioni
    list, for the Master only, doing the same from any Room page (Q7).

### Not in scope

- Lines & Veils as a tool block (Q2), the Session 0 timer in a Section.
- Moving an existing Session 0 step into a Section, or a tool block into a
  Session 0 session.
- Tool blocks on the landing itself (they live in Sections).
- Editing the Documents page's groups in place (the Room setup's Grouping
  stays the place for them).

## Design

### Backend (migration `e8c4a2f6b1d9`, revises `d5b8e1f3a9c7`)

- `session_zero_modules`: `round_id` becomes nullable; new `section_id`
  (FK `room_sections`, cascade); check `(round_id IS NULL) <> (section_id
  IS NULL)`. A Section's module is a tool. Every Session 0 table that
  names a round for a module's content (Retro/Stars columns'
  `ck_session_zero_columns_board`, and any other found while building)
  accepts a tool module with no round.
- `room_section_blocks`: `kind` adds `tool`; new `module_id` (FK
  `session_zero_modules`, cascade, unique) and `players_visible` (bool,
  default true; a new tool block is written with false); check `module_id`
  exactly on `tool` blocks.
  `PUT /{sid}/blocks` keeps recreating the block rows (spec 55), and a tool
  block in the list names its `module_id`, so the instance survives
  reorders; a tool module no longer named by the list is deleted in the
  same transaction.
- `rooms.maps_position` dropped.
- The `session_zero` row (FK of every module) is created on the first tool
  block when the Room hasn't started Session 0, with no round, so the
  Session 0 page still shows "Inizia".
- Routes: `POST /rooms/{id}/sections/{sid}/tools` (`{kind}`: creates
  module + block, Master only); `GET /rooms/{id}/sections/{sid}/tools`
  (each tool's state as `GET session-zero` builds it for a step, hidden
  ones only for the Master, `X-View-As` honoured); `PUT .../blocks/{bid}/
  visible`. Every existing module-scoped route (polls, votes, questions,
  answers, DDI, cards, columns) works on a tool module unchanged; the
  "step reached" check reads `players_visible` for a tool module.
- `GET session-zero`, the overview, carry over and rounds ignore modules
  with a `section_id`.
- Duplication and the JSON export (schema 5) copy a tool's setup
  (Decision 8).

### Frontend

- `components/landing/BlockHeading.tsx` (caret, count, fold) used by
  `SectionBlock` and `RoomDocumentsPage`'s groups.
- `ToolBlock` renders the module with the Session 0 components; a tool
  context replaces the round where those components read it.
- `BlockBar`: eye toggle and "Bozza" badge on tool blocks; add-block
  popover's Strumenti row; delete without undo for tools.
- `RoomSectionPage`: in-place title/description in edit mode.
- `LandingEditor`'s "Nuova sezione" card moved to the reading grid for
  the Master; `RoomIndex` "+ Nuova sezione" line.
- `RoomDocumentsPage`, `RoomSetupPage`/`GroupingEditor`: maps row and its
  place removed; `RoomMapsStrip` deleted if nothing else uses it.
- Strings in all 12 languages.

## Units

| Unit | What | Migration | Claude's build time |
|---|---|---|---|
| 60_1 | Frontend, no backend: blocks fold, title/description in place, "Nuova sezione" always and in the Index, Documents page groups as blocks and no maps row (setup's Mappe row hidden) | no | about 1.5 h |
| 60_2 | Backend: migration, tool modules in Sections, routes, Session 0 filters, visibility, deletion, duplication and export setup, `maps_position` dropped, tests | **yes** | about 2.5 h |
| 60_3 | Frontend tool blocks: Strumenti tiles, inline tools, eye toggle, delete, live updates, import preview, tests, screenshots | no | about 2.5 h |

About 6.5 hours. 60_1 can ship first on its own (no migration). The
migration goes to the staging DB before 60_2 merges and to production
before the release that ships it.

## Tests

- Backend: a tool block creates and deletes its module (and only its
  own); a reorder keeps votes and post-its; a hidden tool is 404/absent
  for Players and `X-View-As`, present for the Master; Players vote,
  post and answer on a visible one, not on a hidden one; the Session 0
  page, overview and carry over never list a tool module; the first tool
  block of a Room without Session 0 leaves Session 0 not started;
  duplication and export copy setup only, hidden; limits (10 blocks).
- Frontend: a block folds and unfolds from its heading; the Index opens a
  folded block; the Section title and description save in place; the
  Master sees "Nuova sezione" outside edit mode, Players don't; the
  Documents page has no maps row and its groups use `BlockHeading`; the
  Strumenti tiles create each tool and open its setup; the eye toggle
  hides a tool from the Player view; deleting a tool asks to confirm and
  has no undo.
- Screenshots at desktop and phone width: a Section with a poll tool and a
  Retro tool (one folded), edit mode heading, the add-block popover with
  Strumenti, the Documents page.

## Open questions (product owner)

- **Q1** Tool inline in the Section (default) or a card opening a page of
  its own, like a Session 0 step?
- **Q2** Lines & Veils stays one per Room, reachable from a Session 0
  block (default), or do you want separate Lines & Veils boards too?
- **Q3** A new tool starts hidden from Players until the Master shows it
  (default), or visible at once?
- **Q4** Duplicate Room and JSON export copy a tool's setup without votes,
  post-its and answers (default), or leave tools out?
- **Q5** Blocks start open and the fold is not remembered (default), or
  should the Master be able to set a block to start folded?
- **Q6** "Conformare i raggruppamenti": read as *the look* (group headings
  like block headings, Decision 14). Did you also mean editing the groups
  in place on the Documents page with the block's chips popover, instead
  of the Room setup?
- **Q7** Besides the always-visible dashed card, a "+ Nuova sezione" line in
  the Index too (default), or only the card?

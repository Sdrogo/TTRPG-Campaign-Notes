# 47 - Modular Session 0

## Goals

- Product owner's request (2026-10-27): "Al momento la Sessione 0 fornisce
  una sola feature di base (la board + linee e veli). Vorrei che invece la
  sessione 0 possa essere in qualche modo modulare ed il master, quando la
  crea, crea il suo template di feature da avere. Queste possono comprendere
  la DDI, le Stars and Whishes, la possibilità di inserire una serie di
  domande a cui i giocatori rispondono, e di usare queste risposte per
  definire nuovi Documenti, dove le risposte dei giocatori possono dare nomi,
  descrizioni o note, i giocatori hanno libertà di creare e manipolare
  questi documenti per conto loro, diventando owner di tale documento in
  quanto #PC. Le diverse feature desiderate possono essere riposizionate, ed
  il master può mandare avanti alla prossima feature nella catena."
- Each session of a Room's Session 0 page (spec 46 rounds, freely named
  since 46d) becomes a **chain of modules** ("tappe") the Master composes
  when creating the session, reorders at will, and walks the table through
  with "Avanti".
- Modules in this ticket:
  1. **Retro** (today's Retro board, with Lines & Veils beside it for
     promotion, exactly as specs 46, 46c and 46d built it);
  2. **Lines & Veils** alone (the Room-wide board, full width);
  3. **DDI**, the Dichiarazione d'Intenti (absorbs ticket 46b's template);
  4. **Stars and Wishes**;
  5. **Questions**: a list of questions the Players answer, whose answers
     become Documents the Players own (their PC, by default).
- `requirements.md` has no requirement for Session 0; this ticket adds none
  until the product owner asks.

## Decisions

Proposed by Claude on 2026-10-27; the product owner answered Q1-Q7 the same
day (see "Answers" below) and the Decisions now follow those answers. Still
missing: the six DDI sections (Q1).

1. **Session = chain of modules.** Every session (round) has an ordered list
   of modules. The same module type can appear more than once (e.g. two
   Questions modules: one for PCs, one for the world). Limit: 10 modules per
   session.
2. **Composing the chain.** "Avvia Sessione 0" (first session) and "Nuova
   sessione" (46d) open a dialog where the Master picks modules from a list
   and orders them by drag (button arrows on a phone). Defaults: the first
   session proposes Retro + Lines & Veils (today's page); a new session
   proposes the previous session's chain, with each Questions module's
   questions copied (not its answers). Starting stays open to any member,
   as in spec 46 (`architecture.md`: `POST .../start` "which any member
   calls"): a Player who presses "Start Session 0" gets the default chain
   (Retro + Lines & Veils) with no dialog, and the Master can change it
   afterwards (Decision 3). Only the Master sees the compose dialog when
   starting, and only the Master creates later sessions (as today).
3. **Changing the chain later.** The Master can add, remove and reorder
   modules of the open session at any time, from a "Modifica tappe" dialog.
   Removing a module that holds content (post-its, answers, acceptances)
   asks for confirmation and deletes that content. Lines & Veils content is
   Room-wide and is never deleted by removing a module (Decision 6).
4. **Stepper and "Avanti".** A compact stepper in the 46d header shows the
   chain ("1 Retro · 2 Domande · 3 Stars and Wishes"), the current module
   highlighted. The Master has "Avanti" (next module) and can also click
   any step to make it current. Changing the current module is pushed live
   (SSE event `module`), and every member's page moves to it.
5. **What Players see.** Players see the steps already reached (current
   and earlier) and can open an earlier one to read it or keep writing in
   it; steps after the current one are hidden (shown as a locked count,
   "+2"), so a DDI or a list of questions isn't seen before its time. The
   Master sees and can open every step, to prepare future ones. A closed
   session (46) is read-only in every module.
6. **Retro and Lines & Veils** keep every rule of specs 46, 46c and 46d.
   Lines & Veils stays **one board for the whole Room**: the Lines & Veils
   module and the panel beside the Retro both show it. The Retro board's
   columns now belong to its module rather than to the session (two Retro
   modules in one session have their own columns).
7. **Stars and Wishes.** A post-it board like the Retro (draft, publish,
   anonymous or signed, reactions, groups, drag and drop, timer), with two
   fixed columns, **Stars** ("Stelle", what you liked) and **Wishes**
   ("Desideri", what you'd like to see), that the Master can't rename,
   add to or delete. Nothing is promoted from it.
8. **DDI.** The module shows one Document of the Room, read-only, to every
   member who has reached it, with an **"Ho letto e accetto"** button at the
   end for each Player; the Master sees who has accepted and who hasn't
   (a ✓ next to each member). Setting up the module, the Master picks an
   existing Document or creates one from the **DDI template**: a new
   Document whose description holds the six DDI sections as headings with
   a short hint each, editable like any Document. The Document follows its
   own visibility (D-08): a Player who can't see it sees "Il Master non ti
   ha ancora reso visibile la DDI". Acceptance is per Player and per
   module; editing the Document after someone accepted shows them "La DDI
   è cambiata dopo che l'hai accettata" with the button again. The
   invitation flow of 46b (an invitee reads the DDI before joining) is
   **not** in this ticket (Q1).
9. **Questions: setup.** The Master writes a list of questions (up to 30,
   each up to 300 characters, optional hint text) and maps each one to
   where its answer goes in the Player's Document:
   - **Name** (exactly one question, required: a Document needs a name);
   - **Subtitle** (at most one);
   - **Description** (any number: the description is built as one
     section per question, the question as a heading, the answer below);
   - **Note** (any number: each answer becomes a Note titled with the
     question; Q3);
   - **New Document** (up to 5 per module; Q6): the answer becomes a
     separate Document with a Tag the Master picks for that question
     (e.g. "Nomina un PNG legato al tuo PG" → `NPC`); the answer's first
     line is its name, the rest its description;
   - **Not in the Document** (talk material only).
   The module also sets the **Tag** given to the main Documents (default
   `PC`, the Room's preset Tag).
10. **Questions: answering.** Each Player answers in a form on the module.
    Answers are saved as they type (draft) and are seen by their author and
    the Master only. Players don't see each other's answers. The Master
    sees a table, one row per Player, with every answer and who has
    finished. When the round of answers is over, the Master can **"Rivela
    le risposte"**: every member who has reached the module then sees
    everyone's answers, read-only (Q2). The Master can hide them again.
    Revealing changes nothing in the Documents already created. Plain text, up to 2000 characters per answer (the description
    and Notes take Markdown later, once they are a Document).
11. **Questions: creating the Documents.** A Player who has answered the
    Name question gets **"Crea il mio Documento"**; the Master also has
    **"Crea i Documenti di tutti"** (only for Players who answered the
    Name and have none yet). Creating builds a normal Document:
    name/subtitle/description/Notes from the mapping (Decision 9), the
    module's Tag, visibility **Pubblico** (Q3), the Player as **Owner**
    (D-12) and as its **Character player** (D-23). Notes are created
    Public too, except those the Player marked **"Privata"** next to the
    answer in the form (Private = the Document's Owners and the Master,
    D-19); as Owner the Player can change any of them later (Q3). The same
    action creates the answer's extra Documents ("New Document" questions):
    Public, the module's chosen Tag for that question, the Player as Owner,
    no Character player.
    **Creation rights (Q7):** the module has a switch, set by the Master
    when adding it, "I Player creano i propri Documenti anche se la Room
    non lo permette", **on by default**. On: a Player creates their own
    Documents even in a Room where Document creation by Players is off
    (D-13), as an exception the Master chose. Off: the Room's D-13 setting
    decides; with Player creation off, only the Master's "Crea i Documenti
    di tutti" works (the Player still becomes Owner and Character player).
    One Document per Player per Questions module (409 on a second); the
    module then shows "Apri il tuo Documento". From then on it is an
    ordinary Document: the Player edits it freely (and the Master, D-12);
    editing an answer afterwards no longer changes the Document, and
    deleting the Document lets the Player create it again.
12. **Live.** Every module writes through the same SSE stream (spec 46_2):
    new event kinds `module` (chain or current step changed), `answer`
    (to the answer's author and the Master only, like a draft), `accept`,
    `document` (Documents created). Events still carry no content.
13. **Existing Session 0s.** The migration gives every existing session a
    chain of one Retro module, made current, that takes over its columns,
    groups and post-its, so nothing changes on screen for a Room that
    already used Session 0.
14. **Not in scope**: templates saved across Rooms (Q4), the 46b
    invitation flow (Q1, separate ticket after 47), Questions answered by
    the Master, X-card and other
    in-play tools, a timer per module (the one shared timer stays). Not in
    Room duplication, JSON/PDF export or search, like spec 46; Questions
    answers, acceptances and Stars and Wishes post-its are in the user's
    own data export and erased with the account (spec 31).

## Answers (product owner, 2026-10-27)

- **Q1 - DDI and invitation**: the 46b invitation flow stays a separate
  ticket after 47. **Still open: the six DDI sections** (titles, and a
  one-line hint each if wanted) for the DDI template (Decision 8). 47_3
  can't start without them.
- **Q2 - Who sees answers**: only the author and the Master at first; once
  finished, the Master can reveal all answers (Decision 10).
- **Q3 - Created Documents**: Public; Notes can be made Private by the
  Owner (Decision 11).
- **Q4 - Templates**: "Una nuova sessione è un'entità a sé": it sets its
  own chain, and the previous session's chain is offered as the starting
  template (Decision 2). Named templates across Rooms: not in this ticket.
- **Q5 - Later steps**: Players see only steps already reached
  (Decision 5).
- **Q6 - Extra Documents**: yes ("Si può fare"): the "New Document"
  question target (Decision 9).
- **Q7 - D-13**: the Master decides per module whether to keep the Room's
  creation rule or make the exception, exception by default (Decision 11).
  Recorded in `architecture.md` when built, and flagged as a candidate
  change to `requirements.md` (protected file, edited only on request).

## Design

### Backend: chain and modules (47_1)

- Migration:
  - `session_zero_modules` (`id`, `room_id`, `round_id`, `kind`
    `'retro'|'lines_veils'|'ddi'|'stars_wishes'|'questions'`, `position`,
    `title` null = the kind's default name, `settings` jsonb (DDI:
    `document_id`; Questions: `tag_id`, `answers_revealed`,
    `players_bypass_creation_rule` default true), `created_at`);
  - `session_zero_rounds.current_module_id` (null before the session
    starts);
  - `session_zero_columns.module_id` (Retro and Stars and Wishes columns;
    Lines & Veils columns keep `kind` and no module); the data migration
    creates one Retro module per existing round, moves the round's columns
    onto it and makes it current (Decision 13). Stars and Wishes columns
    get `kind` `'stars'|'wishes'`;
  - `session_zero_questions` (`id`, `module_id`, `position`, `body`,
    `hint`, `target`
    `'name'|'subtitle'|'description'|'note'|'document'|'none'`, `tag_id`
    for `'document'`);
  - `session_zero_answers` (`question_id`, `user_id`, `body`,
    `note_private` for Note answers, `updated_at`; PK on both),
    `session_zero_answer_documents` (`module_id`, `user_id`,
    `document_id` `ON DELETE CASCADE`, `question_id` null = the main
    Document, else the "New Document" question; unique on module, user
    and question);
  - `session_zero_acceptances` (`module_id`, `user_id`, `accepted_at`,
    `document_version` the DDI's revision when accepted).
  All backend-only (RLS + deny policy), as spec 46.
- Domain `app/domain/session_zero.py` grows `ensure_can_compose`,
  `ensure_can_advance`, module limits, question mapping rules (exactly one
  Name, at most one Subtitle), `visible_modules(role, chain, current)`
  (Decision 5) and the Document built from answers (a pure function:
  answers + mapping → name, subtitle, description Markdown, Notes).
- Routes under `/rooms/{id}/session-zero`: `POST .../start` takes an optional chain
  (Master only; without one, the default chain); `POST .../rounds` takes `{title, modules}`;
  `POST/PATCH/DELETE .../modules`, `PUT .../modules/order`,
  `POST .../modules/current` `{module_id}`; Questions:
  `PUT .../modules/{m}/questions` (the whole list, Master),
  `PUT .../modules/{m}/answers` (the caller's own), `POST
  .../modules/{m}/reveal` `{revealed}` (Master), `POST
  .../modules/{m}/documents` (own) and `POST .../modules/{m}/documents/all`
  (Master); DDI: `POST/DELETE .../modules/{m}/acceptance`. `GET` returns
  the chain as the caller sees it and the current module's content; other
  modules' content with `?module_id=`.
- Document creation reuses the documents and Notes repositories (version
  history, audit of the Character link as today), in one transaction with
  the answer-document link.

### Frontend: stepper and modules (47_2)

- Header (46d): the stepper between the session selector and the timer;
  "Avanti" and "Modifica tappe" for the Master. On a phone the stepper
  shows "2/4 Domande" with a menu.
- The page body renders the module: `RetroModule` (today's boards,
  unchanged), `LinesVeilsModule`, `StarsWishesModule` (reuses
  `BoardColumns` with fixed columns), `DdiModule`, `QuestionsModule`
  (setup editor for the Master, answer form for Players, the Master's
  table).
- Compose dialog shared by "Avvia Sessione 0", "Nuova sessione" and
  "Modifica tappe", with @dnd-kit (already a dependency since 46d_2).
- Strings in all 12 languages; glossary rows: module/step ("tappa"), Stars
  and Wishes, DDI.

### Build order

47_1 chain + Retro/Lines & Veils as modules + Stars and Wishes (backend and
frontend), 47_2 Questions → Documents, 47_3 DDI. One migration in 47_1,
one in 47_2 (questions and answers), one in 47_3 (acceptances), each to
apply to the staging database before merging and to production before the
release.

## Tests

- Backend: any member starts Session 0 (a Player gets the default chain,
  a chain sent by a Player is refused); only the Master composes and
  advances; the
  migration turns an existing round into one current Retro module with its
  columns; Players get only reached modules (404 on a later one), the
  Master all; a closed session refuses writes in every module; Stars and
  Wishes columns can't be renamed or deleted; question mapping rules (one
  Name, at most one Subtitle); answers are seen by their author and the
  Master only, also in the stream; creating the Document sets name,
  subtitle, description sections, Notes with their visibility, Tag, Owner
  and Character player, works with D-13 off, and is 409 the second time;
  "all" skips Players without a Name answer or with a Document;
  revealed answers reach every member who reached the module, hidden ones
  only author and Master; "Privata" Note answers become Private Notes;
  a "New Document" question creates a separate Public Document with its
  Tag, owned by the Player, no Character player; with the module's bypass
  switch off and D-13 off, a Player's own creation is 403 and the
  Master's "all" still works; DDI
  acceptance per Player, reset when the Document changes; data export and
  account deletion cover answers and acceptances.
- Frontend: stepper hides later steps from a Player; "Avanti" moves every
  page (event `module`); compose dialog order; answer form autosaves;
  "Crea il mio Documento" opens the new Document.

## Build estimate

Claude's build time: 47_1 in one session, 47_2 in one session, 47_3 in
part of one. Three migrations.

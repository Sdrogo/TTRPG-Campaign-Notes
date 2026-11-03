# 61 - Clocks

## Goals

- Product owner's request (2026-11-03): "Vorrei creare un nuovo strumento
  basato sul concetto di Clock. Iniziamo con creare un thread per
  raggruppare documentazione sul concetto stesso di Clock nei GDR e un
  conseguente studio dei requisiti e definizione del ticket, insieme ad un
  prototipo per la UI." Then, sharing the clock chapters of two manuals
  (Cowboy Bebop GDR and Blades in the Dark): "Vogliamo creare un sistema
  che sia universale e personalizzabile al massimo." (A universal system,
  as customisable as possible.)
- **Clocks** become Room content (background: `61 - Clocks - background.md`):
  the table opens a clock tied to an event, marks its segments during play,
  sees it close live, and keeps it across sessions.
- **Universal**: the app doesn't encode one game. Each Room sets its own
  **clock rules** (who opens and marks clocks, whether marks can be undone,
  the **labels** its clocks can carry, the **kinds of mark**), and clocks
  can be **grouped** with an end rule (a race, a turn, a sequence of
  layers). Presets cover the common games without naming them.
- Clocks live on their own **Clocks page** in the Room (Q1); a Section block
  and the Document aside are left to a later ticket.
- `requirements.md` is protected and has no requirement for clocks; this
  ticket adds none. When the product owner approves it, a new `FR-` (and a
  `VR-`) can be added at their request only.
- Prototype: project files `clock-prototype/index.html`, with desktop and
  phone screenshots in the same folder.

## Vocabulary

| Term (it / en) | Meaning |
| --- | --- |
| Clock / Clock | A circle cut into segments, tied to an event |
| Calibro / Size | Its number of segments |
| Segnare / Mark | Fill one or more segments |
| Chiudere / Close | Fill the last segment: the event happens |
| Tipo di segno / Mark kind | What a mark is made of in this game (a success, a shock), with a colour |
| Etichetta / Label | A free label with a colour, created by the Master and remembered by the Room (e.g. what a game calls approach or relevance) |
| Gruppo / Group | Clocks played together, with an end rule (race, turn, sequence) |
| Non avvenuto / Lapsed | A clock left open when its group ended: its event doesn't happen |

## Decisions

Proposed by Claude on 2026-11-03 from the request, the two manuals and the
background study. The product owner answered Q1-Q4 and Q10 on 2026-11-03
(see "Answers"); Q5-Q9 are still open and the Decisions follow the proposed
default until answered.

### 1. The Room's clock rules

1. **"Regole dei clock"**, one set per Room, edited by the Master from the
   Clocks page (⚙ "Regole"), applied to every clock of the Room:
   - **Who opens a clock**: "Solo il Master" (**default**, Q2) | "Tutti" |
     "I giocatori propongono, il Master approva" (Cowboy Bebop's "anyone may
     ask, the Master defines"; Decision 13). A Player's own opened clock is
     theirs (creator rights below). Players never open clocks when the Room
     disables Document creation by Players (D-13).
   - **Who marks**: "Solo il Master" (**default**, Q3) | "Il Master e chi
     l'ha aperto" | "Tutti quelli che lo vedono" ("il contesto prevale").
     Each clock can override it in its own settings (Decision 6).
   - **Undoing marks**: "Si può svuotare" (**default**) | "Non si torna
     indietro" (marks are never erased, not even by the Master; the 5 s undo
     of a mistaken click stays, Decision 9). With the first, a clock can be
     set "Solo avanti" on its own.
   - **Labels** ("Etichette", product owner 2026-11-03: no hard-coded
     values): a Room-wide list of free labels, each a name (≤30) and a
     colour from the app's palette (Decision 4b). The Master creates them
     where they are needed, typing a new name in a clock's label picker
     ("Crea «Jazz»"), or in the rules dialog, and the Room remembers them
     for every later clock; the rules dialog renames, recolours, reorders
     and deletes them (deleting removes the label from its clocks, after a
     confirmation that says on how many). A clock carries up to 6, shown as
     coloured badges under its face and seen by everyone who sees the
     clock. Players choose among the existing labels when they propose or
     open a clock; they don't create new ones. The app ships no labels: a
     table playing a game with approaches makes "Rock", "Jazz" and so on,
     another makes "Fazione", "Viaggio" or nothing. (Replaces the typed
     "properties" of the first draft.)
   - **Mark kinds** (up to 6, optional): each has a name (≤30), a palette
     colour and who may use it ("Master", "Giocatori", "Tutti"), all defined
     by the Master, none shipped. A table could make *Successo* (Players)
     and *Shock* (Master). With none defined, a mark is just a mark in the
     clock's colour.
2. **Rule presets** fill the rules dialog in one click, then everything is
   editable; game names never appear:
   | Preset (it) | Who opens | Who marks | Undo |
   | --- | --- | --- | --- |
   | Semplice (default for every Room) | Master only | Master only | yes |
   | Tutto il tavolo | everyone | everyone who sees it | yes |
   | Senza ritorno | Players propose | everyone who sees it | no |
   Presets set only these three policies: they never create labels or mark
   kinds. Changing rules later keeps existing clocks; a deleted mark kind
   leaves past marks in a neutral grey.
3. **Clock templates** ("Modelli"): the create dialog offers built-in
   templates (Progresso 6 green, Pericolo 4 red, Conto alla rovescia 6
   orange with six stage labels, Progetto 8 blue, Fazione 6 purple Master
   only, Tiro alla fune 6 gold, Vuoto 4 grey) and the Room's own: the Master
   saves any clock's settings with "Salva come modello" (up to 20). A
   template fills the form only.

### 2. The clock

4. **Fields**: **name** (≤80; the dialog's hint: "Intitolalo all'ostacolo o
   all'evento, non al metodo"), optional **description** (Markdown, spec
   48, ≤2000), **size** 2-16 segments (Q4; shortcuts 4, 6, 8, 12), **colour**
   (Decision 4b), optional
   **stage labels**, one per segment (≤60, a countdown's stages), optional
   **closing condition** shown to everyone (≤140: "L'ultimo segno da una
   prova Jazz"; shown, never enforced: the app doesn't roll dice), optional
   **consequence** ("Cosa succede quando si chiude", ≤500, Markdown) seen
   only by the Master, its **labels** (≤6), an optional linked
   **Document** (Decision 19), the visibility (Decision 15).
4b. **Colours are the app's own palette** (product owner, 2026-11-03): the
   same 17 colours as relationship-map cards, arrows and groups (spec 28,
   `MAP_COLORS` / `COLOR_VALUES` in `lib/maps.ts`: default, red, green,
   purple, blue, gold, orange, midnight, silver, champagne, rose, pink,
   cobalt, violet, emerald, brown, lime), with the same picker (the first
   six in a row, "more colours" for the rest) and names. Clocks, labels and
   mark kinds all use it; no new colour tokens.
4c. **Any size from 2 to 16** (Q4), odd ones included: 3, 5, 7 are as valid
   as 4 or 6. The stepper moves by one; 4, 6, 8, 12 beside it are only
   shortcuts for the common sizes.
5. **States**: *open*, *closed* (every segment filled; face filled with a
   check, "Chiuso" badge), *lapsed* (left open when its group ended:
   "Non avvenuto", face greyed, no more marks), *archived* (out of blocks
   and asides, in the "Archiviati" list; restorable). Undoing the last
   mark of a closed clock reopens it, when the rules allow undo. Deleting
   asks first, no undo.
6. **Per-clock overrides** (Master or creator): "Solo avanti" (when the
   Room allows undo) and who marks it (any of the three levels of Decision
   1, e.g. a Player's project only they mark).

### 3. Marking

7. **On the face**: clicking a segment fills up to it; clicking the last
   filled segment empties it (when allowed). "−" and "+" under the face do
   one segment (touch, keyboard). "Segna…" in the clock's menu marks N at
   once (1-the free segments) with an optional note (≤200) and, if the Room
   has mark kinds, the kind. The face is never a drag target.
8. **Mark kinds**: with kinds defined, "+" uses the viewer's default kind
   (the first they may use; long press or the small ▾ beside "+" picks
   another), and each filled wedge takes its mark's colour, so the table
   reads "3 successi e 2 shock" at a glance. A legend sits under the strip
   of a block or page that has kinds.
9. **One write per mark, as a delta** (`POST .../marks {delta, kind?,
   note?}`), clamped on the server, so two people marking at once both
   count. After a mark the marker gets a 5 s toast "+1 su «Allarme» ·
   Annulla"; Annulla removes that mark, even under "Non si torna indietro"
   (it's a correction, logged as such). Settings use the revision guard of
   spec 42.
10. **History** ("Cronologia" in the clock's menu, 50 at a time): every mark,
    undo, state change and settings change: "Marco · Successo +2 · 4/8 ·
    forzata la serratura · 21:14". Visible to whoever sees the clock;
    Master-only fields are left out of it for Players.

### 4. Groups

11. **A group** (≤12 clocks; a clock is in at most one group) has a name, an
    order and a **mode**:
    - **Libero**: just shown together (Blades' layers of one place,
      factions).
    - **Gara**: the first clock to close wins. Because one roll often
      marks both sides, the result waits for the Master: "«Fuga» si è
      chiuso per primo" with "Conferma" (the group ends, "Vinto: Fuga");
      if another clock of the race closes before that, it's **Pari** (both
      events happen, Blades' "they escape, but the officers are outside").
      The clocks still open stay as they are.
    - **Svolta**: some clocks are marked **decisive**, each with an
      outcome label ("Svolta positiva", "Svolta negativa", free text ≤30).
      When a decisive clock closes, the Master gets "La svolta termina:
      «Bomba disinnescata!» (positiva). Gli altri clock aperti non
      avvengono." with "Termina la svolta" (open clocks become *lapsed*, the
      group ends) or "Non ancora". Simultaneous closes are shown together.
    - **Sequenza**: clocks closed in order (layers, project phases, linked
      clocks). Only the first open one can be marked; the later ones show a
      padlock. When one closes and the next is hidden from the Players, the
      Master gets "Rivelare «Entrare nel covo»?" (the Reveal of VR-06, to
      the levels they pick, audited) or "Non ora". Nothing changes
      visibility on its own.
12. **Ended groups** show their result ("Vinto: Fuga", "Pari", "Svolta
    negativa") and can be archived whole. "Nuova svolta" on an ended turn
    group creates a new group with the same mode and empty decisive slots.

### 5. Who does what

13. **Proposals** (rule "I giocatori propongono"): a Player's "Proponi un
    clock" opens the same dialog without the Master-only fields; the clock
    is *proposed*, seen by its proposer and the Master only, with a
    "Proposto" badge. The Master opens it from the proposal, can change
    size, labels and visibility (Cowboy Bebop: the Master defines the
    clock's size and what it is about), and "Apri il clock" or "Rifiuta"
    (deleted, the proposer sees a toast). A proposed clock can't be marked.
14. **Rights**: creating per Decision 1; editing settings, archiving and
    deleting: the creator and the Master; grouping and Room rules: the
    Master; marking per Decisions 1 and 6 and mark kinds' "who may use".
    The consequence is never sent to a Player
    nor under View as.

### 6. Visibility

15. **The Comment levels with the creator as Owner** (Room default, Master
    only, Private, Selective), as maps (spec 28 Decision 3), through
    `is_content_visible`, server-side at every exit (lists, blocks, aside,
    groups, history, stream, export, View as). Level or grant changes write
    `clock_visibility_changed` to the AuditLog. A hidden clock is absent
    and 404; a group shows only the clocks the viewer sees, and a race or
    turn's result names only visible clocks.
16. **Hidden progress** (Q6): not in this ticket. A Master who wants
    "something is coming" makes a visible clock with no consequence and
    keeps the real one Master only.

### 7. Where clocks show

17. **Clocks page** `/rooms/:roomId/clocks`: the groups (each a bordered
    band with its mode and result) then the clocks outside groups, in the
    Master's order (⠿ in edit mode, spec 55); folded "Proposti" (Master and
    proposers), "Chiusi e non avvenuti", "Archiviati". Buttons "Nuovo clock"
    / "Proponi un clock", "Nuovo gruppo", ⚙ "Regole" (Master). A **page card
    `page_clocks`** on the Room home is added when the Room's first clock or
    rules are saved, removable like Maps ("Riaggiungi Clock"). The page is
    **the** place of clocks in this ticket (Q1: "Creiamo una pagina").
18. **Clocks block in a Section**: later ticket (block kind `clocks`, chips
    of clocks and groups), not built here.
19. **Document link**: a clock can still name a linked Document (shown as a
    link "→ Faro di Punta Grigia" in its detail, for whoever sees both),
    but the Document page shows nothing yet: the aside is a later ticket.
20. **Room Index**: a "Clock" entry when the page card exists.
21. **Not in this ticket** (Q9): the Section block and Document aside
    (above), clocks on maps, in the Session 0 chain or as a spec 60 tool
    block, in the PDF, in search, dice rolling or automatic marks from
    rolls, Ironsworn-style progress tracks.

### 8. Live, display, accessibility

22. **Live**: topic `clock` on the Room stream (spec 52), `{topic: clock,
    revision, kind: changed|marked|deleted, id}`, audience as maps;
    `clock_group` for groups and `clock_rules` for the rules (whole Room).
    Re-reads coalesced (`lib/coalesce.ts`); a remote mark animates its
    wedge (300 ms, none under reduced motion).
23. **Closing notice** (Q7): whoever is viewing a page that shows the clock
    gets one quiet toast "«Allarme» si è chiuso"; nothing elsewhere.
24. **The face** (`ClockFace`, SVG): wedges with a 2 px gap, filled ones in
    the mark kind's or clock's colour, empty ones `--bg-raised` outlined
    `--border-default`; closed: check in the middle and a thin ring; lapsed:
    50% opacity and a dash; locked (sequence): a padlock. Name under it
    (display font, ≤2 lines), "4/8" (mono, muted), label badges, closing condition in muted `xs`. Sizes 64 / 96 /
    140 px. Stage labels: tooltip of each wedge and a numbered list in the
    detail, the next stage highlighted.
25. **Accessibility**: the face is `role="img"` ("Allarme: 4 su 8, aperto,
    2 successi e 2 shock"); wedges are buttons only for who may mark ("Segna
    fino a 5", "Svuota fino a 4"); "−"/"+" are labelled `ActionIcon`s; marks
    are announced in an `aria-live="polite"` region; colour is never the only
    signal (filled solid, empty outlined, kinds listed in the label).

### 9. Copy, export, GDPR, languages, Demo

26. **Duplicate Room** (spec 33): rules and templates copied; clocks and
    groups copied **emptied** (no marks, history dropped, groups not ended),
    proposed and archived ones left out. (Q5)
27. **JSON export/import** (`schema_version` 5): `clock_rules`,
    `clock_templates`, `clocks` (settings, marks as counts per kind, state,
    group, Document by id/name), `clock_groups`; Master-only fields only in
    a Master's export; no history. The Master's import adds the clocks and
    groups, merges labels and mark kinds by name, and maps Documents by
    name as maps do (spec 38). A single Document export leaves clocks out.
28. **GDPR** (spec 31): history rows name a user; the personal data export
    lists the caller's clocks, proposals and marks; account deletion keeps
    clocks with the Room (D-15) and shows "Ex membro" in their history.
29. **Languages**: all strings in 12 languages; glossary rows for Clock,
    Mark, Close, Lapsed when built. Italian keeps **"Clock"** (Q10, product owner),
    en "Clock", de "Uhr", es "Reloj", fr "Horloge", nl "Klok", pl "Zegar",
    pt-PT "Relógio", ru "Часы", ja "クロック", zh-Hans "进度钟", ko "클락";
    "segnare / chiudere" kept from the Italian manuals. Label and mark
    kind names are user content, never translated; preset names are
    translated when applied (they become the Room's text in the Master's
    language).
30. **Demo** (spec 45_2): a "Clock" Section with a race ("Fuga" vs
    "Accerchiati"), a turn group with Successo/Shock marks, and a countdown
    with stage labels.

### 10. Limits

31. 200 clocks, 30 groups, 20 templates per Room; 6 labels per clock, 100 labels per Room, 6 mark
    kinds; 20 chips per block; 6 clocks per Document; 12 clocks per group.

## Design

### Backend (migration, revises the head at build time)

- `room_clock_rules` (one row per Room: `open_policy`, `mark_policy`,
  `allow_unmark`), `room_clock_labels` (`room_id`, `name` unique per Room
  case-insensitively, `color`, `position`), `room_clock_label_links`
  (`clock_id`, `label_id`, both cascade), `room_clock_mark_kinds` (`room_id`, `name`, `color`,
  `who`, `position`), `room_clock_templates` (`room_id`, `name`, `settings`
  jsonb).
- `room_clocks`: `id`, `room_id`, `name`, `description`, `segments`
  (2-16, odd included), `color`, `stage_labels` text[], `closing_condition`,
  `consequence`, `forward_only`, `mark_policy` (null = Room's), `state`
  (`proposed` | `open` | `closed` | `lapsed`), `archived_at`, `group_id`
  (set null), `group_position`, `decisive_label`, `document_id` (set
  null), `position`, `visibility`, `created_by`, `revision`, timestamps.
  `room_clock_grants` (Selective). `room_clock_marks`
  (`id`, `clock_id`, `user_id` set null, `kind_id` set null, `delta`,
  `note`, `undone_at`, `created_at`): the clock's filled count is the
  sum of live marks (kept denormalised as `filled`). `room_clock_events`
  for settings/state history.
- `room_clock_groups`: `id`, `room_id`, `name`, `mode` (`free` | `race` |
  `turn` | `sequence`), `position`, `ended_at`, `result` (jsonb: winner
  ids, tie, outcome label).
- `room_section_blocks.kind` adds `clocks` (+ `room_section_block_clocks`
  with a clock or a group per row, and `all_clocks`); `room_sections.kind`
  adds `page_clocks`. RLS + deny policy on every new table.
- Pure rules in `app/domain/clocks.py`: presets, `apply_mark` (clamp,
  forward-only, kinds' "who", state transitions), `can_*`, group engine
  (`race_result`, `turn_should_end`, `sequence_markable`), proposal
  acceptance, `visible_clock` (strips Master-only fields), copy and transfer
  planners. Routes in `app/api/clocks.py` under `/rooms/{id}/clocks`,
  `/clock-groups`, `/clock-rules`, `/clock-templates`.

### Frontend

- `components/clocks/`: `ClockFace`, `ClockCard`, `ClockStrip`,
  `ClockGroupBand`, `ClockDialog` (template tiles, fields, label picker with "Crea «…»",
  visibility), `ClockDetail` (popover / bottom sheet under 48em: big face,
  stages, consequence for the Master, history, "Segna…"), `ClockRulesDialog`
  (presets, policies, labels and mark kinds editors with sortable
  rows), `MarkKindLegend`.
- `pages/RoomClocksPage.tsx`; Index entry; hooks `useClocks`,
  `useClockRules`, `useClockEvents` (on `useRoomEvents`).
- Strings under `clocks.*` in 12 languages; `ui-context.md` gets "Clocks
  (spec 61)" when built.

## Units

| Unit | What | Migration | Claude's build time |
| --- | --- | --- | --- |
| 61_1 | Backend core: rules, labels, mark kinds, templates, clocks, marks and undo, history, visibility and Reveal, proposals, stream topics, tests | **yes** | about 3 h |
| 61_2 | Backend: groups (race, turn, sequence), page card, copy, export/import schema 5, GDPR, Demo seed, tests | same migration | about 2 h |
| 61_3 | Frontend: `ClockFace`, clock dialog, rules dialog, Clocks page, live marks, closing toast, 12 languages, tests | no | about 3.5 h |
| 61_4 | Frontend: groups and their prompts, proposals, Index, screenshots | no | about 1.5 h |

About 10 hours. One migration for 61_1 and 61_2 (both backend, merged
together); it goes to the staging DB before they merge and to production
before the release that ships them.

## Tests

- Backend: marks clamp and set states; concurrent marks both count;
  "Non si torna indietro" refuses unmarking but allows the 5 s undo; mark
  kinds' "who"; per-clock policy overrides the Room's; Master-only fields
  never reaches a Player or View as; a Player can't create labels; hidden clocks absent
  everywhere (lists, groups, results, history, stream audience); a race
  ends on the first close and records a tie; a turn ends only on the
  Master's confirmation and lapses the open clocks; a sequence refuses
  marks on a locked clock; proposals visible to proposer and Master only,
  accepted or refused; rules changes keep values; duplication empties and
  skips proposed/archived; export/import round trip; GDPR; limits.
- Frontend: wedge click fills/empties; −/+ and keyboard; kind picker and
  wedge colours; undo toast; remote marks re-render; closing toast; the
  turn and sequence prompts; rules presets fill the dialog; templates fill
  the clock dialog; proposals flow; the Player view hides Master-only
  fields.
- Screenshots at desktop and phone width: the Clocks page (a race, a turn
  group with kinds, a countdown), the clock dialog, the rules dialog, the
  detail with history.

## Answers (product owner, 2026-11-03)

- Q1 (where): "Creiamo una pagina": a Clocks page. Section block and
  Document aside left to a later ticket. -> Decisions 17-21.
- Q2 and Q3 (defaults): "I Clock di default vengono creati dal master e
  segnati secondo le impostazioni del clock, ma di default master": who
  opens = Master only, who marks = Master only, each clock can change who
  marks it. -> Decisions 1, 6.
- Q4 (size): 2-16, odd included. -> Decision 4c.
- Q10 (Italian name): "Clock". -> Decision 29.
- Earlier the same day: the map palette for every colour, free Room labels
  instead of typed properties, any size not just the shortcuts.

## Open questions (for the product owner)

- **Q5. Duplicating a Room**: proposed clocks copied emptied, proposed and
  archived ones left out. Or copied as they are?
- **Q6. Hidden progress** (name visible, fill hidden): proposed not now.
- **Q7. Closing toast** for whoever is viewing: proposed yes, quiet, once.
- **Q8. Groups**: the four modes (free, race, turn, sequence) in this
  ticket, the turn ended by the Master's confirmation rather than
  automatically? Proposed yes.
- **Q9. Later tickets**: clocks on maps, as a Session 0 step or tool block,
  in the PDF; agreed to leave them out?

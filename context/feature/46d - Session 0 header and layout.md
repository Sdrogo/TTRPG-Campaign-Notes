# 46d - Session 0 header and layout

## Goals

- Product owner's feedback on the Session 0 page (2026-10-27, after PR #254):
  1. "Vorrei gli header delle colonne e delle righe di Retro e linee e veli
     siano più grandi."
  2. "Voglio che il pulsante di Aggiungi colonna sia più compatto e non
     occupi così tanto spazio."
  3. "Voglio che sia possibile che più di sessioni rispetto a sessione 0 o
     sessione 0.5 possano essere create."
  4. "L'intera parte sopra le colonne è strana, ogni elemento ha la propria
     riga, il pulsante del publish all ne ha una e shifta tutto sotto. Vorrei
     che tutto possa essere accorpato in un unico header su una sola linea,
     con una grafica compatta ma chiara. Inoltre ripetiamo più volte titoli
     senza motivo."
  5. "Voglio che i due panel delle colonne e delle righe scrollino
     individualmente."
  6. "Voglio che le emoji delle reaction siano più grandi e visibili."
  7. "Voglio poter riordinare i post-it con un drag and drop, che ci sia una
     animazione che mi faccia capire che sto spostando o accorpando un
     ticket, voglio anche poter spostare i gruppi (solo master) e le colonne
     come drag and Drop."
- Decisions 1-6 are frontend only. Decision 7 needs an order for post-its
  and groups, so one migration and one new route. Everything else in specs
  46 and 46c stays as decided.

## Today

Above the columns the page stacks, one per line: the title "Sessione 0" with
the timer chip and the Master's ⋮; the section title "Retro"; the round's
name ("Sessione 0", again) or the round selector, with the Master's "Avvia
Sessione 0.5"; the closed-round notice; "Pubblica tutte le bozze (N)",
which appears and disappears and pushes the board down. The Lines & Veils
panel has its own "Linee e Veli" title. Column and row headings are small
(`fz="sm"`). "Aggiungi colonna" is a full button at least 130px wide. The
whole page scrolls as one.

Rounds are already unlimited: "Sessione 0", then "Sessione 0.5 #1", "#2"...
each with an optional title shown after the name. Only the wording ("Avvia
Sessione 0.5") suggests there is just one more.

## Decisions (proposed by Claude, 2026-10-27)

1. **Bigger headings**: Retro column titles and the Must / Veils / Lines row
   titles use the display font at `fz="md"` (16px), weight 700, instead of
   14px. Group titles inside a column stay small.
2. **Compact "Add column"**: a square 32px "+" icon button at the end of the
   Retro columns (tooltip and accessible name "Aggiungi colonna"), instead
   of the wide text button. The add form that opens is unchanged.
3. **Sessions with their own name**: the Master's button becomes "Nuova
   sessione". Its dialog asks for the name, prefilled with the next default
   ("Sessione 0.5 #N"), which the Master can replace with anything ("Sessione
   1", "Retro di metà campagna"...). The selector and the header show the
   name alone: the title, when there is one, replaces the default name
   instead of following it. The first session stays "Sessione 0". Same data
   as today (the round's optional `title`), so no backend change. Confirmed (Q1).
4. **One header line**: everything above the boards becomes one row, left to
   right:
   - the session selector, always shown (a compact dropdown; with one
     session it just names it), which replaces both the "Sessione 0" page
     title and the separate round name, with a small "chiusa" badge on a
     closed session instead of the full-width notice;
   - the timer chip;
   - "Pubblica bozze (N)" as a small button, shown only with drafts but
     sitting in this row, so nothing below moves;
   - on the right, for the Master, "Nuova sessione" and the ⋮ (delete).
   The "Retro" and "Linee e Veli" section titles go: the session selector
   names the Retro board and the Must / Veils / Lines rows name themselves.
   The page keeps one `h1` for screen readers (visually hidden, "Sessione
   0"). On a phone the row wraps onto two lines at most, and the two tabs
   (Retro, Linee e Veli) stay as they are.
5. **Panels scroll on their own**: from 62em (boards side by side) the
   page stops scrolling below the header: the Retro panel and the Lines &
   Veils panel each fill the height left on screen and scroll vertically on
   their own (the Retro panel also sideways, as today). The handle between
   them keeps its full height. On a phone nothing changes (tabs, page
   scroll).
6. **Bigger reactions on post-its**: the reaction chips on a post-it show
   the emoji at 18px (today about 12px, Mantine `compact-xs`) with the
   count beside it at 13px, and the "add reaction" smiley at 20px. Only on
   Session 0 post-its (a `size` prop on the shared `ReactionChips` and
   `AddReaction`, default unchanged), so Comments keep their look.
7. **Drag and drop to arrange the boards**, with the open session only:
   - **Post-its**: dragged within their column to change their place, or
     into another Retro column of the same session. Lines & Veils post-its
     can be reordered within their row too (moving them between Must,
     Veils and Lines exists already). The Master moves any post-it, a
     Player their own, drafts included (Q2).
   - **Moving vs grouping, shown while dragging**: the post-it being dragged
     lifts (shadow, slight tilt, the original place left as a faded
     placeholder). Between two post-its a coloured insertion line opens a
     gap, and the others slide apart (about 150 ms): dropping there moves
     it. Over the middle of another post-it, that post-it gets a ring in
     the column's colour and a small "Raggruppa" label: dropping there
     groups them (the Master any two; a Player two of their own, see Q2).
     Dropping onto a group adds the post-it to it (the Master only, or a
     Player when every post-it in the group is theirs). Esc or a drop outside cancels and it slides back.
   - **Groups** (Master only): dragged by their heading, as one block,
     within the column or into another Retro column, with the same
     insertion line.
   - **Columns** (Master only): dragged by their heading, sideways; the
     others slide aside. This replaces the "move left / right" items in
     the column ⋮ menu, which stay for keyboard use.
   - With `prefers-reduced-motion` nothing slides or tilts: the insertion
     line and the ring are still shown. On a phone a drag starts with a
     long press (about 250 ms) so scrolling still works.
   - Every move is one write; other members see it through the live
     updates (spec 46_4), the moved item glowing.

## Answers (product owner, 2026-10-27)

The ticket is confirmed.

- **Q1 (decision 3)**: yes, sessions are freely named, the name replacing
  "Sessione 0.5 #N".
- **Q2 (decision 7)**: the Master moves every post-it; a Player moves only
  their own. A Player may also **group their own post-its** (both the one
  dragged and the one dropped on are theirs; a group holding anyone
  else's stays the Master's), which amends spec 46c Decision 9 (groups
  were Master only). Titling, ungrouping and moving groups stay Master
  only.

## Design

- `SessionZeroTitle` becomes `SessionZeroHeader` (one `Group`, `wrap`
  only below 62em): `RoundsBar`'s selector and "new session" move into it,
  `PublishAll` too; `RoundsBar` goes. A visually hidden `h1`.
- `roundLabel(round)`: the title when set, else the default name.
  `StartRoundModal` prefills the next default and sends it as the title.
- Heights: the page body becomes a flex column at full viewport height
  under the app header; `BoardsSplit` takes the rest (`flex: 1; min-height:
  0`), each side `overflow: auto`. CSS in `index.css` next to
  `.sz-retro-scroll`.
- Decision 7, backend: migration adding `position` (integer) to
  `session_zero_cards` and `session_zero_groups`, filled from today's
  `created_at` order. In a column, ungrouped post-its and groups share one
  order; post-its inside a group have their own. New route `PUT
  /rooms/{id}/session-zero/columns/{column_id}/layout` with the column's
  full order (`[{"type": "card" | "group", "id", "cards"?: [ids]}]`); an
  item from another column of the same session moves it here. Checked in
  `app/domain/session_zero.py` (open session, same board, rights of Q2,
  every item listed once), bumps `revision`, pushes `card` or `group`. `can_group` lets a Player group post-its that are all
  their own (Q2). The
  existing `PUT /columns/order` serves column drags.
- Decision 7, frontend: `@dnd-kit/core` and `@dnd-kit/sortable` (pointer,
  touch and keyboard sensors, sorting animations) replace the native HTML
  drag used today for promote, move and group; the board answers the
  write, with the order shown at once and put back if the write fails.
- Strings: "Nuova sessione", "Pubblica bozze ({{count}})", "chiusa",
  "Aggiungi colonna" (exists) in 12 languages; "Avvia Sessione 0.5" and the
  closed-round sentence go if unused.

## As built (46d_1, 2026-10-27)

- `SessionZeroTitle` became `SessionZeroHeader` and `RoundsBar` became
  `SessionPicker` (`SessionPicker`, `NewSession`); `PublishAll` moved into
  the header. The header is one wrapping `Group`, the Master's actions
  pushed right, so a phone shows it on two lines.
- A new session left with its prefilled default stores no title, so the
  default shows in each viewer's language; any other name is stored as the
  round's `title`. `lib/sessionZero.defaultRoundName` gives the default.
- `BoardsSplit` sets its height to the window's height under its top (at
  least `MIN_BOARDS_HEIGHT`, 360px), again on resize; each side is a
  `.sz-pane` with its own vertical scroll.
- Strings: `rounds.start` is now "New session", `rounds.title` "Name",
  `rounds.startButton` "Create", new `rounds.closedBadge`; `publishAll.button`
  shortened; `rounds.titlePlaceholder` removed (12 languages).

## Tests

- The header shows selector, timer, publish and the Master's actions on one
  row; a Player sees no "Nuova sessione" nor ⋮; no "Retro" / "Linee e Veli"
  headings on a wide screen.
- A new session sends the typed name; the prefilled default when unchanged;
  the selector lists sessions by name; a closed one carries the badge.
- "Aggiungi colonna" is an icon button with its accessible name.
- Comments' reactions keep the small size; post-its' use the large one.
- Backend: layout route moves and reorders, keeps groups' post-its
  together, refuses a closed session, another board, a missing or repeated
  item, a Player moving someone else's post-it or any group; `revision`
  bumps once; the migration keeps today's order.
- Frontend: drop between post-its moves, onto one groups, onto a group
  joins it; Esc cancels; a failed write restores the order; a Player has no
  handle on groups and columns.
- Visual check (screenshots): headings size, one-line header, each panel
  scrolling alone with long columns.

## Estimate

Claude's build time: one session for decisions 1-6 (frontend), one for
decision 7 (migration, route, drag and drop). Two PRs: 46d_1 (layout) and
46d_2 (drag and drop).

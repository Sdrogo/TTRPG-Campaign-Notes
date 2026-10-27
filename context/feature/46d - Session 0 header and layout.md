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
- Frontend only: no API change, no migration. Everything else in specs 46
  and 46c stays as decided.

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
   as today (the round's optional `title`), so no backend change. *Open:
   see the question to the product owner.*
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
- Strings: "Nuova sessione", "Pubblica bozze ({{count}})", "chiusa",
  "Aggiungi colonna" (exists) in 12 languages; "Avvia Sessione 0.5" and the
  closed-round sentence go if unused.

## Tests

- The header shows selector, timer, publish and the Master's actions on one
  row; a Player sees no "Nuova sessione" nor ⋮; no "Retro" / "Linee e Veli"
  headings on a wide screen.
- A new session sends the typed name; the prefilled default when unchanged;
  the selector lists sessions by name; a closed one carries the badge.
- "Aggiungi colonna" is an icon button with its accessible name.
- Comments' reactions keep the small size; post-its' use the large one.
- Visual check (screenshots): headings size, one-line header, each panel
  scrolling alone with long columns.

## Estimate

Claude's build time: one session, frontend only.

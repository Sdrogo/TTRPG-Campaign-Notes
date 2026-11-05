# 63 - Clock out of the Session 0 tools

## Goals

- Product owner's request (2026-11-04), on the add-block popover of a
  Section: "Qualcosa non mi convince nella creazione di un Blocco. Il clock
  si perde un po' nei Tool della sessione 0, e può essere anche fuorviante
  dal momento che il clock è slegato dalla sessione 0."
- Today (spec 61 Decision 18) the popover shows three tiles (Documenti,
  Mappe, Sessione 0) and, under a "Strumenti" divider whose hint speaks of
  "uno strumento della Sessione 0", six buttons: Sondaggio, Retro, Stelle e
  Desideri, Domande, DDI **and Clock**. Clock is the odd one out: it is
  Room content like Documents and maps, it owns no Session 0 step, and the
  hint above it is wrong for it.
- Goal: Clock sits with the other Room content; everything about Session 0
  sits together in one place.
- **Frontend only, no migration, no API change.** The block kind `clocks`
  already exists on its own (it is not a `tool` block), so the data stays
  as it is.

## Options

### A. Two groups: Room content and Session 0 (recommended)

```
┌ Nuovo blocco ─────────────────────────────────────────┐
│ CONTENUTI DELLA STANZA                                 │
│ [Documenti]       [Mappe]           [Clock]            │
│  I Documenti con   Tutte le mappe,   I clock della     │
│  alcuni Tag        o di un tipo      Stanza            │
│                                                        │
│ SESSIONE 0 ─────────────────────────────────────────── │
│ [Panoramica]  Sessioni, tappe e sondaggi della Stanza  │
│ Oppure uno strumento tutto suo, nascosto ai giocatori  │
│ finché non lo mostri:                                  │
│ (Sondaggio) (Retro) (Stelle e Desideri) (Domande) (DDI)│
└────────────────────────────────────────────────────────┘
```

- Clock becomes a tile with the same weight as Documenti and Mappe.
- The Session 0 tile and the five tools share one heading, so a Master
  reads "this is all Session 0" once, and nothing else is under it.
- Cost: the Session 0 tile moves down and gets a new name ("Panoramica"),
  since a tile called "Sessione 0" under a heading "Sessione 0" repeats
  itself. The block it makes is unchanged (default heading still
  "Sessione 0").

### B. Four tiles, tools below

```
[Documenti] [Mappe] [Clock] [Sessione 0]
STRUMENTI DELLA SESSIONE 0 ───────────────
(Sondaggio) (Retro) (Stelle e Desideri) (Domande) (DDI)
```

- Smallest change: Clock moves from the buttons to a fourth tile, the
  divider is renamed "Strumenti della Sessione 0".
- Cost: the Session 0 tile and the Session 0 tools stay in two places, and
  four tiles in a 480 px popover are narrow (2 × 2 on a small screen).

### C. Keep the layout, only move the Clock button

Clock in its own row "Altro" under the tools. Rejected: it still looks
like a lesser kind of block and the popover gets a third heading.

## Decisions (proposed, option A)

1. **Two labeled groups** in the add-block popover (both the dashed
   "+ Blocco" bar and the small "+" between blocks, same component
   `AddBlock`):
   - **"Contenuti della Stanza"**: three tiles, Documenti, Mappe, **Clock**
     (timer icon, body "I clock della Stanza, alcuni o tutti quelli
     aperti"). Picking Clock does what the Clock button does today (a
     `clocks` block, opened on its "+ Clock" picker).
   - **"Sessione 0"** (divider): one wide tile **"Panoramica"** (body
     "Sessioni, tappe e sondaggi della Sessione 0 della Stanza") making the
     `session_zero` block as today; under it the hint "Oppure uno strumento
     tutto suo, nascosto ai giocatori finché non lo mostri" and the five
     tool buttons (Sondaggio, Retro, Stelle e Desideri, Domande, DDI),
     unchanged in behavior.
2. **Phone**: the bottom sheet keeps the same order in one column: the
   three content tiles, then the Session 0 group.
3. **Nothing else moves**: block kinds, the block bar, the blocks already
   saved, export/import (schema 5), Room duplication and the Clocks page
   are untouched. Existing Clocks blocks keep working as they are.
4. **Wording** in the 12 UI languages (`roomLanding.tiles.*`): new keys
   for the group headings, the Clock tile title/body, the "Panoramica"
   tile; `tools`/`toolsBody` reworded. English: "Room content",
   "Clock" / "The Room's clocks, some or all open ones", "Session 0",
   "Overview", "Or a tool of its own, hidden from the Players until you
   show it".
5. **Spec 61 Decision 18** ("Clock among the Strumenti") is superseded by
   this ticket for the popover only; the rest of Decision 18 stands.

## Design

- `components/landing/SectionEditor.tsx` → `AddBlock`: a first labeled
  `SimpleGrid` (`cols={{ base: 1, xs: 3 }}`) over `documents`, `maps`,
  `clocks`; a `Divider` "Sessione 0"; a full-width `.room-landing-tile`
  for `session_zero` (icon and text in a row); the hint and the five
  `TOOL_KINDS` buttons. The Clock button after the tools goes away.
- `i18n/locales/*.json`: keys under `roomLanding.tiles` (`content`,
  `clocks` becomes `{ title, body }`, `session_zero.title` → "Panoramica",
  `tools` → "Sessione 0", `toolsBody` reworded). Every use of
  `roomLanding.tiles.clocks` is updated.
- `context/ui-context.md` (Room landing / tool blocks paragraphs) and the
  tracker updated with what is built.

## Tests

- `SectionEditor.test.tsx`: the popover shows the "Contenuti della Stanza"
  group with Documenti, Mappe and Clock tiles; the "Sessione 0" group with
  "Panoramica" and the five tools; no Clock among the tools.
- Picking the Clock tile adds a `clocks` block and opens its "+ Clock"
  picker (existing test moved to the tile); picking "Panoramica" adds a
  `session_zero` block; a tool still makes a tool block.
- Locale parity test (all 12 files carry the new keys) keeps passing.

## Estimate

About 30–45 minutes of Claude's build time (one component, 12 locale
files, tests, docs). One PR into `staging`, no migration.

## Confirmed

The product owner chose **option A** (2026-11-05: "Avevo risposto con la
Proposta A"). She named no other words, so the defaults of Decisions 1 and
4 stand: the heading "Contenuti della Stanza" over the three tiles and
"Panoramica" for the Session 0 tile (Q2 and Q3 are open to change later).

## Built (2026-11-05)

- `AddBlock` in `SectionEditor.tsx` draws the two groups; a small
  `AddBlockTile` makes each tile (`wide` for "Panoramica"). The Session 0
  divider reuses `roomLanding.blockTitle.sessionZero`.
- Locales (all 12): `tiles.content` new, `tiles.clocks` is now
  `{ title, body }`, `tiles.session_zero` is "Panoramica" (the overview),
  `tiles.toolsBody` reworded. `tiles.tools` stays: it is the fallback
  heading of a tool block without a kind.
- Test: `SectionEditor.test.tsx` checks the order and that Clock is a tile.
  No migration.

## Open questions (for the product owner)

- **Q2/Q3**: only if she wants other wording than "Contenuti della
  Stanza" and "Panoramica" (a locale-key change).

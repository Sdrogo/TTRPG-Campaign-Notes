# 49 - Larger text and icons

## Goals

- Product owner's request (2026-10-28): "la typography in generale mi sembra
  troppo piccola intorno all'app, sia per i testi normali, sia per le icone,
  penso siano poco incisive e facili da misscliccare in certe situazioni".
- Make body text, small text and icons one step larger across the whole app,
  and make every icon button a bigger click/tap target, with a further bump
  on touch screens.
- Do it once, at the theme level, so every page follows without per-page
  restyling.
- **Not** in scope: page headings h1-h3 (the larger display sizes of the
  first Figma pass, PR #252, were rejected as too big and stay rejected),
  layout density and spacing (specs 25/25b were dropped), the exported PDFs,
  text drawn inside a map's board.

## Today

- Text follows Mantine's default scale: `xs` 12px, `sm` 14px, `md` 16px,
  `lg` 18px, `xl` 20px. Most of the app is `sm` (about 160 `Text`s) or `xs`
  (about 115): Comments, Notes, info panel rows, card captions, Room setup
  lists, Session 0 post-its.
- Icons are mostly 14px (60 uses) and 16px (83 uses) inline, 18-20px in
  action buttons; a few 10-12px.
- `ActionIcon` / `LabeledActionIcon` sizes are Mantine's: `xs` 18px, `sm`
  22px, `md` 28px, `lg` 34px. Many row actions (Notes, PDFs, Comments,
  Tags, Room setup lists, maps toolbar) are `sm`, i.e. **22px, under the
  24px WCAG 2.5.8 minimum** that `ui-context.md` promises, and the same
  22px on a phone.

## Decisions

Proposed by Claude on 2026-10-28 with +1px steps; the product owner answered
the same day ("farei un doppio step: testi piccoli da 14px, normale a 16px,
icone da 16 a 24 px, bottoni a icona almeno 24px su desktop e 40 su tablet e
telefono") and the Decisions below follow that answer.

1. **Text scale +2px per step** (theme `fontSizes`): `xs` 12 → **14**,
   `sm` 14 → **16**, `md` 16 → **18**, `lg` 18 → **20**, `xl` 20 → **22**.
   Line heights stay Mantine's. Hard-coded sizes in `index.css` move with it.
2. **Headings h1-h3 unchanged** (34 / 26 / 22px). Only the small headings
   move with the body so they never end up smaller than the text under
   them: `h4` 18 → 20, `h5` 16 → 18, `h6` 14 → 16.
3. **Icons from 16px to 24px**: nothing under 16px; every UI icon moves up
   (≤ 14 → 16, 16 → 18, 18 → 20, 20 and 22 → 24). Icons of 24px and more
   (empty states, avatars, Room icon) stay as they are. The `ui-context.md`
   rule becomes 18px inline, 24px for standalone actions.
4. **Icon button targets** (Mantine `--ai-size-*`): `xs` 18 → **24**,
   `sm` 22 → **28**, `md` 28 → **32**, `lg` 34 → **38**, `xl` unchanged
   (44). Nothing in the app is under 24px any more.
5. **Touch screens get bigger targets** (`@media (pointer: coarse)`, i.e.
   phones and tablets, not a mouse): every icon button is at least **40px**
   (`xs`-`md` → 40, `lg` → 44), `CloseButton` 40px too. The icon inside
   keeps Decision 3's size; only the hit area grows. Rows with several
   actions (Note actions, PDF rows, Room setup lists) get taller on a phone;
   that is accepted.
6. **Tag links** keep their invisible padding trick (`TagList`).
7. **No user setting** for text size in this ticket: one scale for
   everyone.

## Design

- `frontend/src/theme/theme.ts`: `fontSizes`, `headings.sizes.h4-h6` and an
  `ActionIcon` size map (Mantine 9 reads `--ai-size-*`), in one place.
- `frontend/src/index.css`: the `(pointer: coarse)` block raising
  `--ai-size-*`, `Button` compact/xs heights and `CloseButton`; hard-coded
  font sizes aligned to the new scale.
- Phosphor icon sizes: every literal `size={n}` under 24 bumped one step
  (Decision 3), one mechanical commit, no logic change.
- `context/ui-context.md`: Typography (scale table), Icons (new sizes),
  Accessibility targets (24px desktop, 40px touch) updated.

## Screens to check (before/after screenshots, desktop and phone)

Header and Account menu, My Rooms, Room page (cards, Maps row, Room Index
tab, FAB), Document page (info panel, PDFs, Notes and their actions,
Comments with reactions and replies), Room setup (Members, Tags lists,
Grouping), Maps page and a map's toolbar, Session 0 (boards, post-its,
module chain), Search modal, Landing page.

## As built (2026-10-28)

- `theme.ts`: `fontSizes` and `headings.sizes.h4-h6` as in Decisions 1-2.
- `index.css`: `--ai-size-*` on `.mantine-ActionIcon-root` (Decision 4), the
  `(pointer: coarse)` block (Decision 5; buttons in an input section are
  left out so they never overflow the input), Badge font sizes and heights
  two pixels up per size (11/12/13/15px on 20/22/24/30px), the Session 0
  reaction chip 13 → 15px.
- About 200 Phosphor `size={n}` literals moved per Decision 3. Exception:
  icons in a Badge's section (pinned, promoted, accepted, relational link,
  revealed, lock, the Owner chip's ✕) are 14px, since a 16px icon would
  fill a 20px badge.
- `BoardColumns`' add-column button was `size={32}`, now `size="md"` (32px,
  40px on touch).
- Text inside the mention map's cards uses the theme sizes, so it grew too;
  the free and geographic boards' own fonts are unchanged.
- Checked on the Demo at 1920px and on an iPhone 13 profile: every icon
  button ≥ 24px on desktop and ≥ 40px on the phone, no horizontal scroll.

## Tests

- Existing frontend tests stay green (no logic changes).
- A theme unit test asserting `fontSizes.sm` and the `ActionIcon` `sm`
  size, so a later theme edit doesn't silently shrink them back.
- Visual check with Playwright at 1920px and 390px (phone, coarse pointer
  emulated): no icon button under 24px on desktop or 40px on phone, no
  horizontal scroll on the phone pages listed above.

## Estimate

About an hour and a half of Claude's build time: theme and CSS are small; the icon
bump is mechanical; most of the time goes to screenshots and fixing any
row that overflows.

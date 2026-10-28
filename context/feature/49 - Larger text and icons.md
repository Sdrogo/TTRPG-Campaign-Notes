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

## Decisions (proposed by Claude, 2026-10-28)

1. **Text scale +1px per step** (theme `fontSizes`): `xs` 12 → **13**,
   `sm` 14 → **15**, `md` 16 → **17**, `lg` 18 → **19**, `xl` 20 → **21**.
   Line heights stay Mantine's. The few hard-coded sizes in `index.css`
   (e.g. 13px) move with it.
2. **Headings h1-h3 unchanged** (34 / 26 / 22px). Only the small headings
   move with the body so they never end up smaller than the text under
   them: `h4` 18 → 19, `h5` 16 → 17, `h6` 14 → 15.
3. **Icons one step up**: 10 → 12, 12 → 14, 14 → 16, 16 → 18, 18 → 20,
   20 → 22. Icons of 24px and more (empty states, avatars, Room icon) stay
   as they are. The `ui-context.md` rule becomes 18px inline, 22px for
   standalone actions.
4. **Icon button targets** (theme `ActionIcon` sizes): `xs` 18 → **24**,
   `sm` 22 → **28**, `md` 28 → **32**, `lg` 34 → **38**, `xl` unchanged
   (44). Nothing in the app is under 24px any more.
5. **Touch screens get bigger targets** (`@media (pointer: coarse)`, i.e.
   phones and tablets, not a mouse): every icon button is at least **40px**
   (`xs`-`md` → 40, `lg` → 44), compact buttons (`Button size="xs"`, the
   `compact-*` sizes) at least 36px, `CloseButton` 32px. The icon inside
   keeps Decision 3's size; only the hit area grows. Rows with several
   actions (Note actions, PDF rows, Room setup lists) get taller on a phone
   because of this; that is accepted.
6. **Tag links** keep their invisible padding trick (`TagList`), now 28px
   tall on desktop and 36px on touch screens.
7. **No user setting** for text size in this ticket: one scale for
   everyone. A "Testo: normale / grande" switch in Account can come later
   if the new scale is still not enough.

## Questions for the product owner

- **Q1, step size.** +1px per step (Decision 1, `sm` becomes 15px) or a
  bolder +2px (`sm` 16px, `xs` 14px)? Claude recommends +1px: it is clearly
  more readable without making dense pages (Room setup, Comments) spill.
- **Q2, phone targets.** 40px minimum (Decision 5) or the 44px Apple /
  WCAG AAA size? Claude recommends 40px: 44px makes rows of three or four
  actions noticeably taller.

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

## Tests

- Existing frontend tests stay green (no logic changes).
- A theme unit test asserting `fontSizes.sm` and the `ActionIcon` `sm`
  size, so a later theme edit doesn't silently shrink them back.
- Visual check with Playwright at 1920px and 390px (phone, coarse pointer
  emulated): no icon button under 24px on desktop or 40px on phone, no
  horizontal scroll on the phone pages listed above.

## Estimate

About an hour of Claude's build time: theme and CSS are small; the icon
bump is mechanical; most of the time goes to screenshots and fixing any
row that overflows.

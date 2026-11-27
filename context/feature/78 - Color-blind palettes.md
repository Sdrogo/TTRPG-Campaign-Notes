# 78 - Color-blind palettes

## Goals

- Product owner's request (2026-11-27): "ho una serie di colori che uso più
  volte per definire relazioni, aree e altre cose simili [...] vorrei fare
  una verifica per i daltonici, magari la possibilità di cambiare la palette
  per i diversi casi di daltonismo". And, in the same thread: "nella pagina
  dell'account ogni user possa settare quale palette usare, la migrazione
  deve essere 1 a 1 tra uno che ha settato una palette per daltonici ed uno
  che non l'ha settata. Ognuno vede i colori suoi, ma c'è una corrispondenza
  che è sempre uguale".
- That is: (1) check the 17-color map palette (`MAP_COLORS`, spec 28
  Decision 8, mostly Tokyo metro line colors) for protanopia, deuteranopia
  and tritanopia; (2) let **each user** pick, on the Account page, a palette
  made for their kind of color blindness. Every palette has the same 17
  slots: "red" is always "red", whoever looks, only the shade drawn changes.
- **No data changes.** Maps, legends, presets, clocks and Session 0 columns
  already store the color's **name** (`'red'`, `'cobalt'`...), never a hex;
  the hex is looked up only when drawing (`colorValue` in
  `src/lib/maps.ts`). So the 1-to-1 mapping the product owner asks for is
  already how the data works: existing maps, legends (spec 68/77b) and
  exports keep working unchanged, and two people at the same table talking
  about "the red line" mean the same relation.
- One small migration: the user's choice on `users` (Decision 6).
  `requirements.md` is not touched.

## Analysis (2026-11-27)

Method: each color simulated at full severity (dichromacy) with the Machado
2009 model (`colorspacious`, "sRGB1+CVD", severity 100) and at 50 % for the
far more common anomalous trichromacy; distance between every pair
(136 pairs) measured as **CIEDE2000** (ΔE00). Rule of thumb for 2 px lines
on a dark board: under 5 is the same color, 5-10 is hard to tell apart,
over 10 is distinguishable. Contrast is WCAG against the board
(`--bg-base` #0d0a0f); 3:1 is the minimum for graphics. Script and data:
`/mnt/project-files/color-blind-palettes/` (`final.json`, and
`confronto-palette.png`, every palette drawn as swatch + relation line).

Theme colors resolve to: default #e8e3ea, red #f75555 (`--accent-strong`),
green #51cf66, purple #cc5de8, blue #339af0, gold #fcc419 (Mantine `-5`
shades); the other 11 are the hexes in `COLOR_VALUES`.

**Today's palette:**

| Vision | Closest pair (ΔE00) | Pairs < 10 | Pairs < 5 |
| --- | --- | --- | --- |
| Normal | rose-pink 11.1 | 0 | 0 |
| Protanopia (no red cones, ~1 % of men) | gold-lime **1.3** | 13 | 3 |
| Deuteranopia (no green cones, ~1 % of men) | silver-rose **2.1** | 15 | 7 |
| Tritanopia (no blue cones, very rare) | red-pink 5.1 | 5 | 0 |
| Protanomaly 50 % (~1 % of men) | purple-violet 6.4 | 4 | 0 |
| Deuteranomaly 50 % (~5 % of men) | purple-violet 7.0 | 4 | 0 |

- Protanopia, practically the same: gold-lime 1.3, purple-violet 3.0,
  cobalt-violet 4.1; hard: silver-emerald 5.5, purple-cobalt 5.7, green-lime
  6.9, green-gold 7.6, blue-violet 7.9, purple-blue 8.8, orange-lime 8.9,
  red-brown 9.1, pink-cobalt 9.1, green-orange 9.8.
- Deuteranopia, practically the same: silver-rose 2.1, purple-blue 2.2,
  green-champagne 3.2, orange-lime 3.6, blue-violet 4.3, purple-violet 4.4,
  pink-emerald 4.8; hard: red-champagne 6.1, gold-orange 6.4, gold-lime 6.7,
  **red-green 7.2**, green-lime 8.1, rose-pink 8.7, midnight-cobalt 8.7,
  cobalt-violet 8.9.
- Tritanopia, hard: red-pink 5.1, orange-rose 5.1, blue-emerald 7.4,
  green-emerald 7.9, gold-champagne 9.7.
- Everyone: **midnight (#4251B0) has contrast 2.8:1** on the board, under
  3:1, also with normal vision; brown (3.8) and cobalt (4.2) are the next
  darkest. Rose-pink, blue-cobalt, purple-violet and green-lime are the
  closest pairs for normal vision too (11-13).
- The pairs the product owner uses most (spec 68 demo: red "Avversario",
  green "Alleato") are among the problems: red-green is 7.2 for
  deuteranopia, and red-brown 9.1 for protanopia.

**Proposed palettes** (drafted by an optimizer: maximize the closest pair as
seen by that kind of vision **and** with normal vision, keep each color at
most ΔE00 12 from today's so its name still fits, contrast ≥ 3:1):

| Palette | Closest pair, its own vision | Closest pair, normal vision | Pairs < 10 (own) | Lowest contrast |
| --- | --- | --- | --- | --- |
| Protanopia | purple-violet 12.4 (was 1.3) | 12.8 | 0 (was 13) | 3.0 |
| Deuteranopia | red-champagne 11.8 (was 2.1) | 12.3 | 0 (was 15) | 3.3 |
| Tritanopia | green-blue 15.5 (was 5.1) | 15.9 | 0 (was 5) | 3.0 |

Each palette fixes its own kind and not the others (the deuteranopia one
still has 7 hard pairs for protanopia, the tritanopia one 9 for
deuteranopia): that is why there is one palette per kind and not one
"color-blind" palette. With only 17 colors and two working color axes, no
palette can make all 17 far apart for everyone; ~12 is what fits.

Draft values (to fine-tune in the mock-up; `default` never changes):

| Name | Standard | Protanopia | Deuteranopia | Tritanopia |
| --- | --- | --- | --- | --- |
| default | #e8e3ea | #e8e3ea | #e8e3ea | #e8e3ea |
| red | #f75555 | #dd204a | #e9094f | #ff0007 |
| green | #51cf66 | #75ffa8 | #51f8ad | #44ff6e |
| purple | #cc5de8 | #c476b4 | #a073b3 | #d31eff |
| blue | #339af0 | #25a8ff | #40b6ff | #8bbdf3 |
| gold | #fcc419 | #ffe741 | #ffe80f | #ffdd42 |
| orange | #ff9500 | #d87f35 | #d37c03 | #f67f1a |
| midnight | #4251b0 | #7140c1 | #6546df | #684ab2 |
| silver | #b5b5ac | #a3967c | #9bb9a9 | #92a0a5 |
| champagne | #c1a470 | #c6bd88 | #b39f7d | #aaab75 |
| rose | #ee86a7 | #ffa2d0 | #f3a2dd | #ff9de1 |
| pink | #e85298 | #f05880 | #ff05a3 | #d01d8e |
| cobalt | #0079c2 | #266b88 | #2d6986 | #246483 |
| violet | #8f76d6 | #9e51ff | #8c66ff | #9975c4 |
| emerald | #00ac9b | #30bdae | #0f9170 | #009688 |
| brown | #9c5e31 | #ab540f | #815c3c | #7f654d |
| lime | #9acd32 | #afb530 | #92d661 | #bfee0f |

## Decisions

*Proposed 2026-11-27. Decisions 1-3 are the product owner's; the others are
defaults to confirm (see Open questions).*

1. **Four palettes, same 17 slots**: "Standard" (today's, unchanged),
   "Protanopia", "Deuteranopia", "Tritanopia". Each maps every color name
   to a hex; names, order (`MAP_COLORS`) and translated labels
   (`maps.colors.*`) stay the same. Picking a palette changes only what
   **this user** sees.
2. **Chosen on the Account page**, by each user (product owner): a new
   section "Colori" / "Accessibilità dei colori" with a radio list of the
   four palettes, each with a strip of its 17 swatches, and one line saying
   that the others in the Room keep seeing their own colors and that the
   color names stay the same. The choice applies at once, without a reload.
3. **1-to-1 mapping** (product owner): stored data never holds a palette's
   hex, only the name, so nothing is migrated or converted and a map drawn
   by someone on "Deuteranopia" opens in the same slots for someone on
   "Standard".
4. **Everything drawn from the palette follows the choice**: free map cards,
   text cards, groups and relations (spec 28), the color legend panel, chip,
   drawer and dialog (spec 68, 77b), the color picker swatches, geographic
   map areas, pins and links (spec 38), clocks and their rules (spec 61),
   Session 0 columns (`--sz-color`, spec 46c), the demo (spec 45). The red
   **accent** of the UI (buttons, links) is a theme token, not a palette
   color, and does not change.
5. **How it is built**: the palette becomes CSS custom properties
   (`--palette-red` ...) defined on `:root` for Standard and overridden
   under `:root[data-palette='protan' | 'deutan' | 'tritan']`; `COLOR_VALUES`
   returns `var(--palette-<name>)`. Switching sets one attribute on
   `<html>`, so nothing re-renders and SVG strokes/fills follow by
   themselves. The values live in one place (`index.css`), and
   `ui-context.md` lists them as the third exception to "no hex in
   components". Anything that needs a real hex (none today: no canvas or
   image export draws map colors) reads it with `getComputedStyle`.
6. **Stored per account** (product owner: "ogni user"): nullable
   `users.color_palette` (`'protan' | 'deutan' | 'tritan'`, null =
   Standard), sent in `GET /account` and changed with `PATCH /account`
   (unknown value: 422). It follows the user to every device. The frontend
   also keeps the last value in `localStorage` (`ttrpg.palette`, try/catch)
   and applies it before the first paint, so the board doesn't flash the
   standard colors while `/account` loads. Signed out (landing, demo):
   the `localStorage` value, else Standard. One migration (one column).
   The GDPR data export (spec 31) includes it.
7. **Non-color cues, already there and kept**: the legend rows name the
   color ("Rosso") as tooltip and accessible name, and clicking a row
   highlights that color's relations or areas and fades the rest (spec 68
   Decision 12): this works for any vision, so the ticket only points to it
   in the Account page's help line. No new line patterns: dashes already
   mean "Master only" (relations) and "proposed" (areas).
8. **Standard palette fix for everyone**: midnight goes from #4251B0 to a
   lighter shade (about #5566C8, contrast 3.9:1)
   because it fails 3:1 also for normal vision. This is the only change for
   people who choose nothing (Open question 2).
9. **Picker order**: unchanged (the first six are default, red, green,
   purple, blue, gold).
10. **Languages**: the new strings in the 12 UI languages; the palette
    names use the medical terms ("Protanopia (rosso)", "Deuteranopia
    (verde)", "Tritanopia (blu)") with the color in brackets, since few
    people know the names.

## Design

- **Frontend**: `src/lib/palette.ts` (the four ids, read/apply/store,
  `applyPalette(id)` sets `document.documentElement.dataset.palette`);
  `COLOR_VALUES` → `var(--palette-*)`; the `--palette-*` block in
  `index.css`; `main.tsx` applies the stored value before render; the
  account hook applies the server value when it arrives; new
  `components/account/ColorPaletteSection.tsx` on `AccountPage` (after
  "Lettura ad alta voce"); i18n keys `account.palette.*` in 12 files.
- **Backend**: `users.color_palette` column + Alembic migration;
  `AccountResponse.color_palette`, `UpdateProfileRequest.color_palette`
  (Literal of the three ids or null); domain validation; GDPR export field.
- **Docs**: `ui-context.md` (palette exception, Account section),
  `architecture.md` (users column), progress tracker.

## Tests

- Backend: `PATCH /account` sets and clears `color_palette`, rejects an
  unknown value (422), `GET /account` returns it; GDPR export contains it.
- Frontend: `palette.ts` (apply sets the attribute, bad stored value falls
  back to Standard, storage errors are ignored); `colorValue` returns the
  CSS variable; `ColorPaletteSection` saves the choice and applies it at
  once; a check (unit test over the table in `index.css` or a TS copy) that
  each palette has all 17 names, `default` unchanged, contrast ≥ 3:1 on
  `--bg-base`, and closest pair ≥ 10 ΔE00 in its own simulated vision.
- Manual: a free map, a geographic map, a clock and Session 0 in each
  palette, desktop and phone (screenshots in the project files).

## Estimate

About **2 hours** of Claude build time (migration, account field,
CSS palettes, Account section, 12 languages, tests), plus a mock-up first
if the product owner wants to see the four palettes on real maps before the
build (~30 min).

## Open questions

1. **Per account (migration) or per browser?** Proposed per account, since
   it's on the Account page and should follow you to the phone. The other
   choices on that page made per browser (language, spec 34; read aloud,
   spec 30) needed no migration.
2. **Fix midnight in the Standard palette too** (Decision 8)? It is below
   3:1 for everyone. It changes how every existing map looks a little.
3. **Achromatopsia** (seeing no color at all, very rare): no palette can
   help with 17 colors; leave it to the legend highlight (Decision 7)?
4. **Mock-up first?** An HTML page with a sample map in the four palettes,
   seen with and without the simulation, before the build.

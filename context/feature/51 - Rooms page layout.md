# 51 - Rooms page layout

## Goals

- Product owner's request (2026-10-29): "La Room page non mi piace come è
  adesso. è concentrata solo al centro ed il resto è inutilizzato. Inoltre
  le immagini non fanno bene il gradiente". The screenshot is the
  **My Rooms** list (`/rooms`) on a 2747px-wide screen.
- Use the whole width of the page for the Room cards, with more columns on
  wide screens.
- Make a Room's image melt into its card instead of ending on a dark band.
- **Not** in scope: the inside of a Room (`/rooms/:id/documents`), which
  already uses the full width; the Room card's content and menu (kept as
  they are since the Figma review, PR #252); Document cards, whose fade
  already matches their background.

## Today

- `RoomsPage` wraps the list in `<Container fluid>`, meant to be full
  width. But the Container sits inside a column flex `Stack`
  (`MyRoomsPage`), and Mantine centres it with `margin-inline: auto`: auto
  margins in a flex column switch off stretching, so the Container shrinks
  to its content and sits in the middle (about 900px wide on a 2747px
  screen, measured). That is the "only in the centre" of the screenshot:
  a bug, not a design choice.
- The grid is `cols={{ base: 1, sm: 2, lg: 3 }}`: three columns at most,
  however wide the screen.
- The card image's left edge fades (`DocumentCardImages`,
  `linear-gradient(to right, var(--bg-surface) 0%, transparent 35%)`) into
  `--bg-surface` (#17121c, almost black), which is the Document card's
  background. A Room card is a plain Mantine `Card`, grey
  (`--mantine-color-dark-6`, #2e2e2e), so the fade paints a dark stripe
  between the text and the picture instead of melting into the card.
  Screenshot: `rooms-page/before.png` in the project files.

## Decisions

Proposed by Claude on 2026-10-29; the product owner merged the ticket (PR
#268) the same day.

1. **Full width**: the page's main area spans the whole window, with the
   same side gutters as the Documents page (`sm` / `lg` / `xl`). The
   heading row (My Rooms + Create Room) spans it too.
2. **Columns grow with the width available** (container-based, so a narrow
   window behaves like a phone): 1 column under 640px, 2 from 640px,
   3 from 1040px, 4 from 1440px, 5 from 1840px, 6 from 2240px. A card is
   therefore never narrower than about 300px nor wider than about 480px.
   With 6 Rooms on a 2747px screen they fit in one row. No maximum page
   width.
3. **The image fades into the card's real colour**: the fade colour
   becomes a variable that each card sets (Room card: its grey; Document
   card: `--bg-surface` as today, so Document cards don't change).
4. **A softer, longer fade**: from the card colour at the left edge,
   half-transparent at 20%, fully clear at 50% of the image panel (today:
   clear at 35%, with a hard start). On a light picture the text column
   still ends on the card colour.
5. Card heights, the image taking the right half, and the ⋮ menu are
   unchanged.

## Design

- `pages/RoomsPage.tsx`: `w="100%"` on the `Container` (the fix for the
  centring); `SimpleGrid type="container"` with the breakpoints of
  Decision 2.
- `components/DocumentCardImages.tsx`: the fade reads
  `var(--card-image-fade, var(--bg-surface))` and uses the stops of
  Decision 4.
- `components/RoomCard.tsx`: sets `--card-image-fade` to
  `var(--mantine-color-dark-6)` on the card.
- `context/ui-context.md`: Rooms page grid and the image-fade rule.
- Frontend only, no migration, no new strings.

## Tests

- `RoomsPage`: the main area is full width (`width: 100%`) and the grid is
  a container grid.
- `RoomCard` with an image sets `--card-image-fade`; the fade overlay
  (`card-image-fade`) uses that variable.
- Document cards keep `--bg-surface` as their fade colour.
- Manual: 2747px (6 columns), 1920px (5), 1366px (3), phone (1).
  Prototype screenshots in `rooms-page/` in the project files.

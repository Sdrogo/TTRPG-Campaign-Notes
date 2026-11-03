# 62c - Visible split pane button on maps

## Goals

- Product owner's request (2026-11-03): "Dobbiamo in qualche modo rendere
  più evidente l'esistenza della possibilità di aprire le cose in preview,
  al momento il pulsante per farlo è mezzo nascosto dietro i 3 puntini."
- Today the free and geographic map page (`RelationshipMapPage`) offers
  "Mostra il pannello affiancato" only as the first item of its ⋮ menu; the
  mention map page (`MentionMapPage`) has an icon-only `SplitToggle` with a
  tooltip. Neither says what it is at a glance.
- Frontend only, **no migration**, no API change. Built in the same PR as
  tickets 62 and 62b.

## Decisions

Defaults picked on 2026-11-03, to confirm in the PR.

1. **A labeled button in the map header**: on the free, geographic and
   mention map pages, `SplitToggle` becomes a small button with its icon
   and a short word, "Anteprima" (`variant="light"` while the pane is
   open, `subtle` gray when closed, as today), next to the save status and
   before the ⋮ menu. Its tooltip keeps the long label ("Mostra / Nascondi
   il pannello affiancato"). The item leaves the ⋮ menu.
2. **Same button everywhere**: the three map pages use the one
   `SplitToggle`, so the button looks and sits the same on all of them.
3. **Card names say what a click does**: on a wide screen a Document
   card's name shows the tooltip "Apri in anteprima" (Ctrl/Cmd-click for a
   new tab stays as in 62b), so the preview is found from the card itself,
   not only from the header. A geographic map's places keep their own
   behavior (spec 38b, 50).
4. **Not on a phone**: as today, no button below the split breakpoint; a
   tap on a card already shows the Document in the lower half.
5. **Wording**: "Anteprima" in Italian, "Preview" in English, the other 10
   languages translated like the rest of `documents.open.*`.

## Design

- `components/maps/SplitToggle.tsx`: `Button` with `leftSection` icon and
  the short label, wrapped in the existing `Tooltip`.
- `pages/RelationshipMapPage.tsx`: the menu item removed, `<SplitToggle />`
  in the header group before the ⋮ menu (so `hasActions` may drop to false
  for a reader with no other action: the menu then hides as today).
- `components/maps/DocumentCardNode.tsx`: a `Tooltip` on the name when
  `onSelect` is set.
- i18n: `documents.open.preview` and `maps.openPreview` in all 12 locales.
- `context/ui-context.md` (Relationship maps, Mention map) updated when
  built.

## Tests

- The map page shows the "Anteprima" button on a wide screen and no split
  item in the ⋮ menu; clicking it opens and closes the pane.
- The mention map page shows the same button.
- No button on a phone.

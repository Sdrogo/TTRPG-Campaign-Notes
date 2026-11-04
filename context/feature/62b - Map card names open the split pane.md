# 62b - Map card names open the split pane

## Goals

- Product owner's request (2026-11-03): "Vorrei anche rimuovere la
  navigation alla DocumentDetailScreen quando clicchiamo sul titolo di una
  Card di un Document in una Mappa. Adesso che abbiamo la possibilità di
  aprire il documento in split screen non sembra più utile."
- Today, on a wide screen with the split pane closed, a click on a Document
  card's name on a free map (spec 28) or a mention map (spec 36) leaves the
  map for the Document page (`DocumentCardNode`, a `Link`). Only with the
  pane open (spec 37 rework, `SplitToggle`) or on a phone does the click
  show the Document beside or under the map.
- Frontend only, **no migration**, no API change. Built in the same PR as
  ticket 62.

## Decisions

Defaults picked on 2026-11-03, confirmed by the product owner the same day ("passa alla implementazione").

1. **A click on the name always opens the split pane**: on the free map
   page and the mention map page, a plain click on a card's name shows its
   Document in the pane, opening the pane when it is closed, the way a
   Document's place on a geographic map already does (spec 38b). On a phone
   it keeps showing it in the lower half (PR #227).
2. **Ctrl/Cmd-click (and middle click) still open the Document in a new
   tab**: the name stays a real link for that, so nothing is lost for whoever
   wants the full page; only the plain click changes.
3. **The pane's own way to the full page stays**: the Document in the pane
   keeps its existing link to its page, so leaving the map is one deliberate
   click away.
4. **The small boards on the Document page are unchanged**: the mention map
   and the linked map in a Document's aside (`MentionMapPanel`,
   `LinkedMapPanel`) have no split pane of their own (the Document is
   already the page), so a click on a card's name there still goes to that
   Document's page.
5. **Geographic maps are unchanged**: a place's click already opens the
   pane; the "Apri il Documento" button of the place card while editing
   stays.
6. **`SplitToggle` stays**: it still opens an empty pane and closes it.

## Design

- `RelationshipMapPage.tsx`, `MentionMapPage.tsx`: pass
  `onSelectDocument={split.open}` always (today only when the pane is open
  or on a phone).
- `DocumentCardNode.tsx`: unchanged logic (a plain click with `onSelect`
  prevents the link's navigation); its comment updated.
- `context/ui-context.md` (Relationship maps, Mention map) and spec 37's
  notes updated when built.

## Tests

- Free map and mention map pages, wide, pane closed: a click on a card's
  name opens the pane with that Document and stays on the map.
- Ctrl/Cmd-click does not prevent the link.
- `MentionMapPanel` on the Document page: the name still links to the
  Document.

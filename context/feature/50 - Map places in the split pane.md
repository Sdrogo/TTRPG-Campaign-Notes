# 50 - Map places in the split pane

## Goals

- Product owner's request (2026-10-28): "Al momento, nelle mappe
  geografiche, se evidenziamo un elemento con informazioni, ma non definito
  come documento, apriamo una piccola preview che è scomoda. Vorrei che
  aprissimo anche questi dentro la preview grande in split screen".
- On a geographic map being read, a click on a plain area or pin (one with
  its own name, subtitle and note, not bound to a Document) shows it in the
  same split pane a Document's place opens in (spec 37, spec 38b), instead
  of the small card floating over the board.
- Frontend only, no migration.
- **Not** in scope: free relationship maps and mention maps (their cards are
  Documents or text cards, already handled by spec 37b), map editing.

## Today

- `GeographicBoard` (spec 38b): a click on a Document's area or pin calls
  `onSelectDocument`, and `RelationshipMapPage` opens it with `?side=<id>`
  in the split pane (beside the map on a wide screen, in the lower half on a
  phone, PR #227).
- A click on a plain area or pin shows a 260px card in the board's top-right
  corner with the name, the area's subtitle and the note. It is small, the
  note is cut by nothing but the board, and it covers the map.
- In editing mode the same card also carries **Modifica** for every place,
  Document places included.

## Decisions

Defaults proposed by Claude on 2026-10-28 and confirmed by the product
owner the same day ("procedi"). Built in PR #265.

1. **Reading mode: plain places open in the pane.** A click on a plain area
   or pin opens the split pane (or the lower half on a phone) on that place,
   exactly like a Document's place. The floating card is no longer shown
   while reading.
2. **The address keeps it**: `?side=place:area:<id>` or
   `?side=place:pin:<id>`, so a reload or a shared link reopens it, like a
   Document (spec 37 Decision 3). Only the map page understands these
   values; any other page ignores them and keeps its full width.
3. **What the pane shows**: the same header as a Document's pane (the
   place's name in the display font, close button; no "open page" button
   since a place has no page), then the area's subtitle, then the note
   rendered as Markdown (spec 48), with a dimmed "Nessuna nota" line when
   there is none. Under it, **Collegamenti**: the places this one is linked
   to on the map (spec 38 links), each with the link's label when it has
   one; a click on one opens it in the pane (a Document's place opens the
   Document) and selects it on the map.
4. **Picking another place replaces it**, Document or plain, one at a time;
   closing the pane clears the selection on the map.
5. **A place that disappears** (deleted by another editor, seen on the next
   5 s refresh of spec 43, or hidden by the Tag filter) leaves the pane with
   its close button and a dimmed "Luogo non trovato" line.
6. **Editing mode is unchanged**: while the map is being edited, the small
   card stays for every place, since it carries **Modifica**.
7. **The split toggle** (spec 37b) works as today: with the pane open and
   nothing picked, a click on any place, plain or Document, fills it.

## Design

- `hooks/useSideDocument.ts`: helpers `placeSide(kind, id)` and
  `parsePlaceSide(sideId)` for the `place:` prefix.
- `PageLayout`: an optional `renderSide?: (sideId: string) => ReactNode | null`
  prop; when it returns content, the split (and the phone's lower half)
  shows it instead of `DocumentSidePane`. A `place:` value on a page without
  it counts as no pane.
- `components/maps/PlaceSidePane.tsx`: the pane of Decision 3, reusing
  `DocumentSidePane`'s header layout and `MarkdownText`.
- `GeographicBoard`: a new `onSelectPlace?(ref)` prop called for plain
  places when not editing; the floating card shows only while editing or
  where no pane is offered. The selection follows the `?side=` value, so the
  highlighted place matches the pane after a reload.
- `RelationshipMapPage`: passes `onSelectPlace` and `renderSide` for
  geographic maps, from the board it already holds.
- i18n: `maps.geo.placePane`, `maps.geo.noNote`, `maps.geo.placeNotFound`,
  `maps.geo.connections` in all 12 languages (spec 34).

## Tests

- Clicking a plain pin while reading puts `?side=place:pin:<id>` in the
  address and the pane shows its name and note; no floating card.
- A plain area shows its subtitle; a note's Markdown renders.
- Clicking a connection in the pane opens that place (or Document).
- Reloading with `?side=place:...` reopens the pane and selects the place.
- An unknown place id shows "Luogo non trovato" with a close button.
- In editing mode the floating card with **Modifica** still appears.
- `?side=place:...` on the Documents page leaves the page at full width.
- Phone: the place opens in the lower half, like a Document.

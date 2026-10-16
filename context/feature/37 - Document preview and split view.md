# 37 - Document preview and split view

## Goals

- Product owner's request (2026-10-14): on the Maps, resting the mouse on a
  Document card for a moment opens a preview of the Document, like a
  `#Document` mention on the Document page (spec 32). Clicking the card
  offers two choices: open the Document in half of the screen, or go to
  its page. Half screen splits the page into two resizable panes. Something
  similar on the Document page and on the Room's Documents page.
- Lets a Master or Player read a Document next to the map, the Document or
  the list they are working on, without losing their place.

## Rework on maps (2026-10-16, product owner)

The hover preview on maps was awkward. On the maps it is removed, and so is
the click menu on cards. Instead, a button on the map page (relationship
map and mention map full page; not below `sm`) splits the screen, and the
right pane shows the Document of whichever Document card is selected
(a click on the card or its name; Ctrl/Cmd-click on the name still opens a
tab). Open with no card picked, the pane asks to select one; closing it or
pressing the button again gives the width back. The rest of this spec (the
menu on `#Document` mentions, the `?side=` address, the pane itself) stays.
Decisions 1 and 2's map parts below are superseded by this; the
mention map panel under a Document's images has no preview or menu either.

## Decisions (2026-10-14, confirmed by the product owner)

1. **Hover preview on map cards** (product owner): on a relationship map
   (spec 28) and a mention map (spec 36), resting the pointer on a Document
   card for 400 ms shows that Document's `DocumentCard`, 440 px wide, as
   spec 32 Decisions 2 and 3 (it closes 150 ms after the pointer leaves the
   card and the preview). Not while the card is being dragged, and never
   for text cards or groups.
2. **The choice on click** (product owner): clicking a Document (a map
   card, a `#Document` mention on the Document page, a card on the
   Documents page) opens a small menu at the pointer with two items:
   "Apri a metà schermo" and "Apri il Documento" (navigate to its page).
   - On a map being edited, a plain click on a card's body keeps selecting
     and dragging it as today; the menu opens from the card's name, which
     is already the link to the Document. On a read-only map, a click
     anywhere on the card opens the menu.
   - Ctrl/Cmd-click and middle-click keep opening the Document in a new
     browser tab, with no menu.
   - On the Documents page the menu opens from a click on a `#Document`
     mention inside a card (its description): those mentions become links
     there, with the hover preview too. The rest of the card keeps its
     current behavior (a click opens the card's Document), and Tag mentions
     stay plain colored text (product owner).
3. **Split view** (product owner): "Apri a metà schermo" splits the page
   into two panes side by side: the page as it was on the left, the
   Document on the right, with a draggable divider.
   - Starts at half and half; each pane at least 320 px wide; the width
     chosen is remembered in the browser (per viewer, `localStorage`, a
     convenience only).
   - The right pane shows the Document as its own page does (name, Tags,
     description, Notes, images, Comments), with a header holding the
     Document's name, an "Apri il Documento" link and a close button. It
     works as on the page: whoever may edit edits there.
   - One Document at a time: choosing another Document's "metà schermo"
     replaces it. A mention clicked inside the right pane offers the same
     menu, and "metà schermo" there replaces the right pane.
   - The open Document is in the address (`?side=<documentId>`), so a
     reload or the Back button keeps or restores it, and the link can be
     shared.
4. **Where** (product owner): the relationship map page, the mention map
   full screen page (spec 36), the Document page (its mentions, including
   those quoted under "Menzionato in") and the Room's Documents page. The
   mention map panel under the Document's images (spec 36) gets the hover
   preview and the menu too, opening the split on the Document page.
   The split itself is part of the page layout, so it works on any Room
   page whose address carries `?side=`.
5. **Phones and touch**: below the `sm` breakpoint there is no
   split view and no menu: a tap opens the Document as today. The hover
   preview needs a device that can hover (`(hover: hover) and (pointer:
   fine)`), like spec 32.
6. **Visibility (Invariant 1, VR-07)**: unchanged. The preview uses the
   Document the page already has for the viewer (spec 32 Decision 4); the
   right pane loads the Document with the same request as its page, so a
   hidden Document answers 404 and the pane says so. During View As (spec
   22b) both are read-only, as everywhere.
7. **No backend change, no migration**.

## Implementation

- Frontend only, built in PR #190 into `staging` (2026-10-14).
- `components/documents/DocumentOpenMenu.tsx`: the two-item menu (Mantine
  `Menu` under what was clicked), and `hooks/useSideDocument.ts`, which
  reads, sets and clears `?side=`.
- `components/layout/SplitView.tsx`: two panes and a divider (pointer and
  keyboard: arrow keys move it, `aria-orientation="vertical"`,
  `role="separator"`), min widths, the stored width. No new dependency.
- `components/documents/DocumentSidePane.tsx`: the pane header over
  `DocumentView`.
- Map cards (`DocumentCardNode`): hover preview through
  `DocumentMentionPreview` (spec 32), menu on click per Decision 2.
- `MentionText`'s Document mentions use the menu; `DocumentCard` gets a
  mode where its description's Document mentions are links above the
  card's own link (the Documents page uses it; the hover preview's card
  does not, so a preview never opens another).
- `PageLayout` wraps a Room page's content in `SplitView` when `?side=`
  is set; `DocumentView` (the Document page's body, moved out of
  `DocumentDetailPage` so the page and the pane share it).
- i18n: the menu items, the pane's close label, the divider's label, in the
  12 languages.
- Tests: preview on hover on a map card (not while dragging, not on a text
  card), the menu and both choices, the split with the divider (pointer and
  keyboard), the stored width, `?side=` on reload, replacing the pane,
  nothing of this on a phone, 100% branch coverage.
- Update `ui-context.md` and `progress-tracker.md`.

## Definition of Done

- On a relationship map, resting the pointer on "Thorn" shows Thorn's card;
  clicking it and choosing "Apri a metà schermo" shows Thorn next to the
  map; dragging the divider resizes both; a reload keeps Thorn open;
  closing the pane gives the whole width back to the map.
- On Mira's page, clicking `#Thorn` and choosing "Apri il Documento" goes
  to Thorn's page; "Apri a metà schermo" opens Thorn next to Mira.
- On the Documents page, clicking `#Thorn` in Mira's card offers the same
  choice; clicking elsewhere on the card opens Mira as before.
- On a phone a tap opens the Document directly.
- A Player never sees a preview or a pane of a Document hidden from them.
- Checks green.

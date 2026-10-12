## Goals

- Product owner's request (2026-10-12): on the Document page, hovering a `#Document` mention opens a small preview of that Document, looking like its card on the Documents list (`DocumentCard`).
- Lets a reader check who or what a mention points to without leaving the page they are reading.

## Decisions (2026-10-12, to confirm in the PR)

1. **Where**: every linked `#Document` mention on the Document page: the description, the Notes and the Comments (replies included). Tag mentions get no preview (a Tag has no card). Mentions that are only colored, not linked (inside a `DocumentCard`, the preview included), get none either, so a preview never opens another one.
2. **When**: after the pointer rests on the mention for 400 ms; it closes 150 ms after the pointer leaves the mention and the preview, so the pointer can move into the preview.
3. **What**: the Document's `DocumentCard` as shown on the Documents list (name, visibility, Tags, description, images, Played by, Owners, unread marks), 360 px wide. Clicking it opens the Document, like a click on the mention.
4. **Data**: the Document is the one the mention already resolved against: the Room's Document list, which the page has loaded and cached for mentions (`DocumentMentionsProvider`). The preview adds **no request and no backend change**; the members list (for Owners and Played by) is the cached query the page already uses.
5. **Visibility (VR-07, Invariant 1)**: unchanged by construction. The list is filtered by the backend for the viewer (and for the "View as" preview, spec 22b), so a mention of a hidden or deleted Document is plain text with no preview, and the preview shows exactly what that viewer's card would.
6. **Touch and keyboard**: only on devices with a precise pointer that can hover (`(hover: hover) and (pointer: fine)`). On a phone or tablet the mention stays a plain link and a tap opens the Document. Focusing the link with the keyboard opens nothing; the link works as before.

## Implementation

- Frontend only, one branch into `staging`.
- `components/mentions/DocumentMentionPreview.tsx`: wraps a mention link in a Mantine `HoverCard` whose dropdown is the `DocumentCard` (no padding or border of its own: the card brings its own).
- `MentionText`: a linked Document mention goes through `DocumentMentionPreview`.
- Tests: the preview opens on hover with the Document's card; no preview for a Tag mention, an unlinked mention, or on a device without hover.

## Definition of Done

- On a desktop browser, resting the pointer on `#Il Cancello` in a description, a Note or a Comment shows Il Cancello's card; moving into it and clicking opens Il Cancello.
- On a phone, a tap on the mention opens the Document with no preview.
- A Player never sees a preview of a Document hidden from them (the mention is plain text).
- Checks green.

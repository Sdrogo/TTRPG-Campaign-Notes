## Goals

The Thread features left out of **19** (product discussion, 2026-10-02):

- **@User mentions and reactions** on Comments (FR-T6).
- **Pin** a Comment and mark a discussion **resolved** (FR-T7).
- **Promote** a Comment into the Document's description or into a new Document, by an Owner (FR-T8).

Each part is small and independent; build them as separate branches in the order below. Not included: in-app notifications (FR-T9, *Could*), so a mention only highlights the name for now.

## Decisions (confirmed by the product owner, 2026-10-02)

1. **Reactions** (any emoji, product owner's choice, 2026-10-02): a member reacts with **any Unicode emoji**, picked from a full emoji picker with search; the emoji already used on that Comment are shown as chips, one click adds yours. Each member at most once per emoji per Comment, at most **20 different emoji per Comment** (so a Comment can't be flooded). A reaction shows a count, and hovering (or a long press) lists who reacted. Anyone who sees the Comment may react; not on a deleted placeholder. The server accepts exactly one emoji grapheme (skin tones and ZWJ sequences included), never free text.
2. **@User mentions**: typing `@` offers the Room's members (same popup as `#` for Documents); stored as a token `@[Name](user:<uuid>)` in the same grammar as the `#` tokens of ticket 20, shown highlighted. A mention never widens visibility: a mentioned member who can't see the Comment still doesn't see it.
3. **Pin**: an Owner of the Document or the Master pins a **top-level** Comment; pinned Comments are shown first, above the toolbar's sort, at most 3 per Document.
4. **Resolved**: the author of a top-level Comment, an Owner or the Master marks its branch resolved; a resolved branch is shown collapsed with a "Resolved" label and can be reopened. A new reply doesn't reopen it automatically.
5. **Promote** (Owner or Master):
   - *into the description*: the Comment's text is **appended** to the description in the editor, where the Owner can adjust it before saving; the Comment stays, marked "Promoted".
   - *into a new Document*: the creation form opens prefilled with the text, the Comment's images offered as the new Document's images; the Comment gets a link to the new Document.
   - **Visibility**: promotion can **widen** who sees the text (a Private Comment into a Room-visible description). The Owner must confirm in a dialog that says so, and it is recorded in the AuditLog like a visibility change (VR-08), the same way a future Reveal (FR-V2) will be.
   - Notes (Details) are already managed by Owners, so promoting a Note is out of scope.

## Design

### Backend

- **Reactions**: table `comment_reactions` (`comment_id`, `user_id`, `emoji`), unique on the three, `emoji` checked in the domain layer as one emoji grapheme (≤ 32 bytes), RLS + deny policy; `PUT`/`DELETE /…/comments/{id}/reactions/{emoji}`; `CommentResponse` gains `reactions: [{emoji, count, reacted_by_me, user_ids}]`.
- **Pin and resolved**: `comments.pinned_at`, `comments.resolved_at` + `resolved_by` (nullable); `POST`/`DELETE /…/comments/{id}/pin` and `/resolve`, with the permission rules above in `app/domain/comments.py`.
- **Mentions**: no schema change: stored inline in the body as `@[Name](user:<uuid>)`, parsed by `app/domain/mentions.py` (ticket 20); saving turns an id that isn't a member of the Room back into plain text; the frontend resolves names with the members list.
- **Promotion**: `POST /…/comments/{id}/promote` records the "promoted" mark (and the target Document, if new) and writes the AuditLog row; the description update and Document creation reuse their existing routes.
- Tests at 100% for every permission rule and limit.

### Frontend

- Reaction bar under each Comment, with an emoji picker (an existing library such as `emoji-mart`, loaded lazily so it doesn't weigh on the first page load; labels in the UI language); `@` popup in `MentionTextarea`; pin and resolve in the Comment's menu; pinned section on top; "Promote" in the menu for Owners and the Master, with the confirmation dialog when it widens visibility.
- New strings in `en.json` and `it.json`.

## Implementation

- Order: reactions → pin and resolved → @mentions → promotion. Each is one backend and one frontend branch into `staging`, after 19 is merged.

## Definition of Done

- A member reacts and un-reacts; the Master pins a Comment and an Owner resolves a branch; a member is mentioned with `@`; an Owner promotes a Private Comment into the description after the warning, and the AuditLog shows it.
- Checks green; `architecture.md` updated.

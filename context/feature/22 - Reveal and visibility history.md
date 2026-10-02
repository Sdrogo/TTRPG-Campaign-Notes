## Goals

- **Reveal** (FR-V2, VR-06, UC-13): the Master widens who sees a piece of content in one deliberate step, and the players who just gained it are told.
- **Visibility history** (FR-V5, VR-08): the AuditLog that every visibility change already writes becomes readable.
- **Room default visibility** (VR-05): new content starts at a level the Room chooses instead of always "Room".
- "View as player X" (FR-V3) is split out into **22b**.

## Decisions (product discussion, 2026-10-02)

These follow `requirements.md` (FR-V2, FR-V5, VR-05, VR-06, UC-13) and don't change it.

1. **Reveal** is a "Reveal" action in the menu of a **Document**, of **each single Note** and of a **Comment**, for the **Master** only. It asks for the new audience (the whole Room, or chosen players added to the current audience), shows who will gain access, and asks for confirmation. Cancel leaves everything as it was. Reveal only widens; narrowing stays an ordinary edit.
2. **What it carries**: revealing a Document reveals the Document only. The same dialog lists its Notes that the new audience can't see, each with a checkbox (unchecked by default), so the Master can reveal some of them in the same step. Comments are never carried along.
3. **Telling the players**: each member who gains access gets the content marked **"Revealed"** (on the Document card, the Note or the Comment) until they open it, and the header avatar counts unseen reveals next to Friend requests and Room invitations (same badge, same refresh on focus, D-04). Not a general notification system (FR-T9 stays *Could*).
4. **Visibility history**: a "History" tab on the Room setup page, for the Master and the Administrators: who changed what, when, from which visibility to which, Reveals marked as such, newest first, filterable by kind of content.
5. **Room default visibility**: a Room setting, chosen by Administrators, among Room, Master only and Private (Selective needs a list, so it can't be a default). It is the starting level of every new Document, Note and Comment, including a Document created from the mention popup. A reply still starts with its parent's visibility (ticket 19). Existing content doesn't change.

## Design

### Backend (22_1)

- **Migration**:
  - `rooms.default_visibility` (not null, default `room`).
  - `reveals` (`id`, `room_id`, `content_kind` = `document` | `note` | `comment`, `content_id`, `revealed_by`, `revealed_at`) and `reveal_recipients` (`reveal_id`, `user_id`, `seen_at` nullable), RLS + deny policy, cascades from the Room and from the revealed content.
- **Domain** (`app/domain/reveal.py`): `plan_reveal(content, current audience, requested audience, members)` refuses anything that isn't a strict widening (422) and returns the new visibility and grants, the **recipients** (members who gain access, computed as new audience minus old audience, never the Master or the author), and the AuditLog entry (`*_revealed`, before/after, as VR-06 requires). The Notes picked in the dialog are planned the same way in the same transaction.
- **Routes**: `POST /rooms/{id}/documents/{doc}/reveal`, `.../notes/{note}/reveal`, `.../comments/{comment}/reveal` (Master only; 404 before 403 as elsewhere); `GET /reveals/mine` (unseen, still visible, for the badge); opening the content marks the caller's recipient row seen (the single-Document response does it for the Document and its Notes and Comments).
- **History**: `GET /rooms/{id}/audit-log?kind=&before=` (Master or Administrator, paginated). An Administrator who isn't the Master may not see every piece of content, so an entry about content they can't see **names it only as "a hidden Document / Note / Comment"** (VR-07); the Master sees every name.
- **Default visibility**: `PATCH /rooms/{id}` accepts `default_visibility` (Administrator); create routes use it when the request omits `visibility`. Changing it is audited like other Room settings, if they are; otherwise not (it changes no existing content).
- Tests at 100%: only the Master reveals; narrowing refused; recipients exclude those who already saw it; a Note revealed alone vs carried with its Document; badge counts drop once opened and never include content hidden again later; history redacts names for an Administrator who can't see the content; defaults applied on create and ignored for replies.

### Frontend (22_2)

- "Reveal" in the Document, Note and Comment menus (Master only), with the dialog of Decisions 1 and 2.
- "Revealed" badge on cards, Notes and Comments; the header counter (`useReveals`, shared query keys with Friends and invitations).
- "History" tab on the setup page (table on desktop, list on mobile).
- Default visibility selector in the Room settings; every visibility picker starts from it.
- New strings in `en.json` and `it.json`.

## Implementation

- **22_1** backend and migration, then **22_2** frontend, two branches into `staging`. Independent of 19–21; if 19 has landed, revealing a Comment also restores the replies that were narrowed with it (their own visibility is kept, ticket 19).
- Update `architecture.md` (Reveal, recipients, history redaction).

## Definition of Done

- The Master reveals a Master-only Document to the Room together with one of its Notes: Players see both marked "Revealed" and a count on their avatar, which drops after opening.
- The Master reveals a single Note of a visible Document to one Player only: only that Player gets it.
- The History tab lists both Reveals with before/after; an Administrator who isn't the Master sees hidden content unnamed.
- With the Room default set to "Master only", a new Document, Note and Comment all start there.
- Checks green.

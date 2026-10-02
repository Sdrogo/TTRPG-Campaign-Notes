## Goals

- A member sees **what is new since their last visit**: new Comments and replies on a Document they've already read (FR-T4, unread indicator).
- Builds on **19** (threaded replies); split out of it in the product discussion of 2026-10-02.
- No real-time (D-04): counts refresh when a page loads or the window regains focus, like the Friends badge.

## Decisions (to confirm before building)

1. **What counts as new**: a Comment or reply **created** after the member last opened the Document, written by someone else, and **visible to them** (effective visibility, ticket 19). Edits don't count. A post that becomes visible later (its parent widened, a Reveal) doesn't count either: it was not created after the visit. *(Alternative: count it too, which needs a per-viewer "first seen" record.)*
2. **When a Document counts as read**: opening its detail page marks it read up to that moment. No "mark as unread".
3. **Where it shows**:
   - on the **Document detail page**, a "New" mark on each new post, and a collapsed branch says how many of its hidden replies are new (and starts expanded if it holds a new one);
   - on the **Documents list**, a small count on the Document card.
   - Not on the Room card or in the header for now.
4. **First visit**: a Document never opened shows no count (everything would be "new"), only a plain "not yet read" dot. *(Alternative: count everything.)*

## Design

### Backend (19b_1)

- **Migration**: table `document_reads` (`user_id`, `document_id`, `last_read_at`), primary key on the pair, `ON DELETE CASCADE` from Documents, RLS + deny policy. Leaving or being removed from a Room drops that member's rows for its Documents.
- `POST /rooms/{id}/documents/{doc_id}/read` sets `last_read_at` to now (idempotent, any member who sees the Document). The single-Document response gains `last_read_at` (the value **before** this visit, so the page can mark what's new), and the list gains `unread_count` per Document, computed with the same visibility filter as the Thread (no count may reveal a hidden post, VR-07).
- Counting must stay one query per list (NFR-04), not one per Document.
- Tests at 100%: hidden posts never counted, own posts never counted, Master counts everything, counts reset after reading.

### Frontend (19b_2)

- Detail page: call `read` once per visit after the Thread loads; "New" marks from `last_read_at`.
- Document card: the count (or the "not yet read" dot), with an accessible label.
- New strings in `en.json` and `it.json`.

## Implementation

- Backend then frontend, two branches into `staging`, after 19_2 is merged.

## Definition of Done

- Two members on one Document: one posts a reply, the other sees "1" on the card, opens the Document, sees the reply marked "New", and the count is gone on return.
- A Master-only reply is never counted for a Player.
- Checks green; `architecture.md` updated.

## Goals

- FR-V3: the Master previews the Room **exactly as one member sees it**, to check what a player knows before revealing something (ticket 22).
- Split out of 22 in the product discussion of 2026-10-02, because it touches every read path.

## Decisions (product discussion, 2026-10-02)

1. The Master picks a member ("View as…" in the Room's menu) and browses the Room **read-only** with that member's visibility; a banner on every page names the member and has an "Exit" button.
2. Only the Master, only inside their own Room, only for its current members.
3. Nothing can be written while viewing as someone else: every create, edit, delete, Reveal and upload is hidden in the UI **and refused by the backend**.

## Design

### Backend (22b_1)

- A request header `X-View-As: <user_id>` (rejected with 403 unless the caller is the Master of the Room in the path and the user is a member). The access helpers (`app/api/access.py`) resolve the **effective viewer** from it once, and every read path already filters by that viewer, so no visibility rule is duplicated. Routes outside a Room (`/account`, `/friends`, `/rooms` list) ignore the header.
- Any non-GET request carrying the header is refused (403) before reaching the route.
- Signed image and file links are issued as for the effective viewer (they only ever cover visible content).
- Not audited (it reads, never changes). *(To confirm: some groups may want a record of who previewed whom.)*
- Tests at 100%: a Player's preview hides exactly what the Player can't see on every list, detail, search (21), backlinks (20) and unread count (19b); non-Masters and non-members refused; writes refused.

### Frontend (22b_2)

- "View as…" picker for the Master; the chosen member lives in the URL (`?as=<user_id>`), so a reload or a shared tab keeps it and leaving it is one click. The API client adds the header while it is set and keeps a separate query cache, so nothing seen as the player leaks into the Master's own view and vice versa.
- A sticky banner with the member's name and "Exit"; all write controls hidden.
- New strings in `en.json` and `it.json`.

## Implementation

- After 22 (it reuses its audience computations in tests). **22b_1** backend, then **22b_2** frontend, into `staging`.

## Definition of Done

- The Master views as a Player: Master-only Documents, Notes and Comments are gone, Revealed ones are there; trying a write through the API with the header fails; "Exit" returns to the Master's view with nothing stale.
- Checks green.

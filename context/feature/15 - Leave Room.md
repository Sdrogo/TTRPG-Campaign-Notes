## Goals

- Any member can **leave a Room from the UI** again (UC-19, FR-R4). Since spec 11 the only place that offered it was the members page, which became the Administrator-only setup page, so a Player, or a Master who is not an Administrator, has no way to leave.
- Frontend only. The backend already supports it: `DELETE /rooms/{id}/members/{own user id}` removes the caller (self-removal needs no Administrator flag), refuses the last Master or the last Administrator with `409` (D-16, Invariant 5) and writes the AuditLog row (Invariant 7).

## Design

- **Where**: a "Leave" action on the **Room card** on the Rooms page, for every member. The card already raises its buttons above the card link (spec 13_1a), so the action sits in that group. To keep the card light, put it in a small `Menu` (three-dots `ActionIcon`, accessible name "Room actions for {name}") rather than a third visible button; Setup and Invite stay as they are.
- **Confirmation**: a `Modal` like Delete Document: title, body, red `Leave` button with loading state. The body says what happens: your Documents, Comments and Notes stay in the Room (D-15) and you need a new invite to come back. No typing of the Room name (that is reserved for deleting the whole Room).
- **Last Master / last Administrator**: the backend answers `409` with a translated `detail`; show it with `notifyError` and keep the modal open. Do not re-derive the rule on the client (it would need the full members list, which a Player's card does not have).
  - Nice to have: when the member is an Administrator, the body adds one line pointing at the setup page to designate a successor first.
- **After success**: `useRemoveMember(roomId)` already invalidates `['rooms']`; also drop the Room-scoped caches (same helper Delete Room uses in 13_1c), `notifySuccess`, stay on `/`.
- **Also from inside the Room?** Not in this unit. The Rooms page is the one place every member reaches.

## Implementation

- Branch from `origin/main`: `feature/15-leave-room`.
- Reuse `useRemoveMember` (`src/hooks/useMembers.ts`) with the current user's id (`useAuth`). If the hook needs a variant that does not require the members query, add `useLeaveRoom` next to it rather than duplicating the fetch.
- `RoomCard.tsx`: add the menu and a `LeaveRoomModal` (new file under `src/components/`). Mantine primitives and theme tokens only.
- i18n: new keys under `rooms.leave.*` in `it.json` and `en.json` (`common.leave` already exists for the button label).
- Tests (`src/test/…`, 100% coverage): the menu is reachable for a Player, a Master and an Administrator and does not trigger the card link; cancel does nothing; confirm calls `DELETE /rooms/{id}/members/{me}`; success refreshes the Rooms list and the card disappears; a `409` shows the backend message and keeps the modal open.

## Definition of Done

- A Player can leave a Room from the Rooms page, and the last Master or Administrator gets the backend's refusal.
- Frontend lint, `tsc`, build and tests at 100% coverage.
- Mark the spec 11 open question "who may set up a Room, and leaving" point (a) as resolved in `progress-tracker.md`.

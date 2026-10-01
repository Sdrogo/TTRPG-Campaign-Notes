## Goals

- Users can become **Friends** across Rooms: send a request, accept or decline it, remove a Friend.
- First use of a friendship: **add a Friend to a Room directly**, without sharing an invite link.
- This is the first feature that is **not scoped to a Room** (everything else follows D-06). Spec: D-26, D-27, FR-F1…FR-F5, UC-23…UC-25, I-14 in `requirements.md` (v0.4). Planned as its own unit, after 15-17.

## Decisions (recorded in `requirements.md`, change them there first)

1. **What a friendship unlocks in v1**: a Friends list on the Account page, and "Add a Friend" in a Room's invite flow. Nothing else. Profile privacy ("only Friends see my bio") is a later step, already flagged in the Account open question.
2. **How you find someone** (there is no user directory, and email search would leak who has an account):
   - from a **shared Room**: "Add as Friend" next to a member;
   - with a personal **friend link/code** shown on your Account page (regenerable, like an invite).
   No search by name or email.
3. **Adding a Friend to a Room** creates a **pending invitation they accept** (same role choice as invite links, Administrator only, FR-R2/UC-03). They are never put into a Room without saying yes.
4. **Blocking**: not in v1. Declining or removing is silent (the sender sees "pending" until they cancel); a declined request can't be re-sent for 30 days.

## Design

### Backend (18_1)

- **Table** `friendships`: `user_low`, `user_high` (the pair stored ordered, so one row per pair and a unique constraint), `requested_by`, `status` (`pending` | `accepted` | `declined`), `created_at`, `responded_at`. A **declined row is kept** (with `responded_at` as the decline time) so `plan_request` can enforce the 30-day cooldown; a request after the cooldown reuses that row and sets it back to `pending`. Cancelling a pending request and removing a Friend delete the row. **Table** `friend_codes`: `user_id` (one active code per user), `code` with a **unique constraint**, `created_at`; regenerating replaces the row. RLS + deny policy.
- **Domain** (`app/domain/friends.py`): `plan_request` (not yourself, not already friends or pending, cooldown), `plan_response` (only the recipient accepts or declines; declining sets `declined`), `plan_removal` (deletes an accepted or pending row, never a declined one, so the cooldown survives). Requests from a shared Room need the two users to share one at request time.
- **Routes** (`app/api/friends.py`, caller-scoped like `/account`, no user id for "me" in the path): `GET /friends` (accepted + incoming + outgoing), `POST /friends/requests` `{user_id}` (shared Room) or `{code}`, `POST /friends/requests/{id}/accept|decline`, `DELETE /friends/{user_id}`, `GET/POST /account/friend-code`.
- **Room invite**: `POST /rooms/{id}/invitations/direct` `{user_id, role}` (Administrator, target must be a Friend of the caller) creates an invitation addressed to that user; `GET /invitations/mine` lists them; accepting reuses the existing invitation acceptance (FR-R3).
- **Privacy**: a friend response carries the same profile fields the members list does (`api/profiles.py`), nothing more. The email isn't sent to a Friend who shares no Room with the user (that is the existing audience rule for profiles).
- Not audited (Invariant 7 lists Room-scoped changes; friendships aren't one). The direct invitation is audited like any invitation if invitations are.

### Frontend (18_2)

- Account page: a **Friends** section (list, incoming requests with Accept/Decline, outgoing with Cancel, your friend link with Copy and Regenerate).
- Setup page members list: "Add as Friend" on each member who isn't one yet.
- Invite modal: a "Friends" tab to pick a Friend and a role.
- An unread badge in the header for incoming requests and Room invitations (no real-time: refreshed on focus, D-04).

## Implementation

- Split in at least three branches: 18_1a friendships backend, 18_1b direct Room invitations backend, 18_2 frontend (after both are merged).
- Tests at exactly 100%: no self-request, no duplicate in either direction, only the recipient answers, removal by either side, cooldown, code lookup and regeneration, direct invite only to a Friend and only by an Administrator, a pending invite never makes someone a member.

## Definition of Done

- Two users who met in a Room become Friends, one adds the other to a new Room, and the other joins after accepting.
- Checks green; architecture.md updated with a new "not Room-scoped" section.

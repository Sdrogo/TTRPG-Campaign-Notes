> **Dropped (product owner, 2026-10-06)**: not to be built. Kept for
> reference only; FR-G2 (Agent access on behalf of a user) has no
> implementation.

## Goals

- FR-G2: an external AI Agent reads a Room **on behalf of a user**, without that user signing in each time, and never sees more than the user does (I-01).
- Split out of 23 (product discussion, 2026-10-02) because it is a security topic of its own.

## Decisions (proposed, to confirm before building)

1. A member creates a **personal access token for one Room** on the Account page (or the Room's menu), with a name ("my Master assistant") and an expiry (30, 90 days or none).
2. A token is **read-only** and gives exactly the user's own visibility in that Room: the export of 23 (JSON or Markdown), the search of 21 and a single Document. No writes in v1.
3. The token is shown **once**; only a hash is stored. The user sees their tokens (name, Room, created, last used, expiry) and can revoke any of them. Leaving or being removed from the Room revokes its tokens.
4. Using a token is **not** "view as" (22b) and never grants anything the user lacks; if the user's access shrinks, so does the token's.

## Design

### Backend (23c_1)

- Table `access_tokens` (`id`, `user_id`, `room_id`, `name`, `token_hash` (SHA-256), `prefix` for display, `created_at`, `expires_at`, `last_used_at`, `revoked_at`), RLS + deny policy.
- Auth dependency accepting `Authorization: Bearer ttrpg_<token>` on a small allow-list of GET routes only (export, search, single Document), resolving the user and checking the Room in the path matches the token's Room. Every other route keeps accepting Supabase JWTs only.
- Rate limit per token (simple in-process counter is enough at this size). `last_used_at` updated at most once a minute.
- Routes: `GET/POST /account/tokens`, `DELETE /account/tokens/{id}`.
- Tests at 100%: wrong Room, expired, revoked, after leaving the Room, write attempt refused, visibility identical to the user's.

### Frontend (23c_2)

- "Agent access" card on the Account page: create (shows the token once with Copy), list, revoke; a short how-to with an example `curl`.
- New strings in `en.json` and `it.json`.

## Implementation

- After 23_1. One backend and one frontend branch into `staging`. Update `architecture.md` (second auth path, scope).

## Definition of Done

- A token created by a Player lets `curl` download the Player's export and nothing else; after revoking it, 401.
- Checks green.

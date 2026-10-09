## Goals

- Product owner's request (2026-10-09): make the app compliant with the EU General Data Protection Regulation (GDPR).
- Close the gaps an audit of the app found (below) with what code can do: the right of access and portability (art. 15, 20), the right to erasure (art. 17) and the information notice (art. 13).
- Legal review stays with the product owner: this ticket builds the mechanisms and a draft notice, not legal advice.

## Audit (2026-10-09)

What the app keeps about a person, and where:

| Data | Where | Notes |
| --- | --- | --- |
| Sign-in account: provider identity, email, name and picture in `user_metadata` | Supabase Auth (`auth.users`), project in `eu-central-1` (Frankfurt) | Created by Supabase on the first OAuth sign-in. |
| Mirror and profile: `users` (`email`, `display_name`, `pronouns`, `bio`, `avatar_path`) | Supabase Postgres, avatar in the private Storage bucket | The email is never sent to other users (NFR-03). |
| Room content with an author: Documents (`created_by`, `played_by`), Owners, Notes, Comments (`author_id`), reactions, images and PDF Attachments (`created_by`, `uploaded_by`), versions (`edited_by`) | Supabase Postgres and Storage | |
| Relationships: Memberships, Friendships, friend code, invitations (`created_by`, `invitee_user_id`), visibility grants | Supabase Postgres | |
| Usage: Document reads, Reveal receipts, AuditLog (`actor_user_id`, `target_user_id`) | Supabase Postgres | |
| Jobs: Room PDFs (`export_jobs`), imports (`import_jobs`) | Supabase Postgres and Storage | Already time-limited: PDFs expire after 24 hours, imports are deleted 7 days after they finish. |
| Request logs | OVHcloud VPS in Erith, United Kingdom (Docker `json-file`, 10 MB x 5 per container); Caddy logs no access lines; Vercel and Supabase keep their own platform logs | Uvicorn's access lines carry the method, path (search queries included) and the proxy's address, not the visitor's IP, unless `FORWARDED_ALLOW_IPS` is set in the server's `backend.env` (not checked). |
| Browser storage | `localStorage`/`sessionStorage`: Supabase session, language, read-aloud voice, "Post as" per Room, dismissed PDF notices, pending invite or friend link | Strictly necessary or set by the user: no consent banner needed. No cookies, analytics or trackers; fonts are self-hosted. |
| Third parties | Google, Discord, GitHub (sign-in); Openverse (image search, spec 29) | The browser loads Openverse thumbnails directly, so Openverse sees the viewer's IP. |

Gaps found: no account deletion, no export of one's own data, no privacy notice.

## Decisions (proposed 2026-10-09, confirm in the PR)

1. **Account deletion** (`DELETE /account`, body `{"confirmation": "DELETE"}`): permanent, effective at once, no grace period.
2. **Rooms**: a Room whose only member is the user is deleted with everything in it (as spec 13). Every other Room is left as a member leaves it (UC-19, audited `member_left`), which needs a successor: if the user is the last Master or Administrator of a Room with other members, the deletion is refused (409) naming every such Room, and they hand the role over first (D-16, as when leaving).
3. **What is erased and what stays**: erased: the `users` row and avatar, Friendships and friend code, reactions, Document reads, Reveal receipts, Ownerships, visibility grants, invitations addressed to them, and the Supabase Auth account (which holds the email and the provider identity). **Content written in shared Rooms stays**, as part of the campaign others co-wrote, shown as "Unknown user": with the profile and the sign-in account gone, the ids left in `author_id`, `created_by`, versions and the AuditLog no longer lead to a person. Room PDF and import jobs they started are left to expire on their own (24 hours, 7 days).
4. **Order**: the database changes commit first, then the Auth account is deleted through Supabase's admin API with the backend's secret key. If that call fails the answer is 502: the data is gone already, the user is still signed in, and asking again finishes the job (the call is idempotent).
5. **Personal data export** (`GET /account/export`, JSON, `format_version: 1`): profile (with email), Rooms and roles, the Documents they created, own or play, every Comment they wrote, their reactions, uploads (metadata), Friends as they see them (D-27: a silently declined request stays hidden) and friend code. Room content is filtered as everywhere else (Invariant 1): a Document's name is given only while they see it; their own Comments are always theirs (VR-02). The Room export (spec 23) remains the way to get a campaign's content as a whole.
6. **Privacy notice** at `/privacy`, public (linked from the sign-in screen and the Account page), in Italian and English. The controller's name and contact address are the product owner's to provide (`frontend/src/lib/privacy.ts::PRIVACY_CONTROLLER`); until set, the page shows "[to be completed]".
7. **No cookie banner**: the app sets no cookies and only stores what it needs to work (ePrivacy art. 5(3) exemption).

## Design

- Backend 31_1: `app/domain/account.py` (`ensure_confirmed`, `plan_account_erasure`), `app/db/account_repo.py`, `app/db/auth_admin.py`, the route in `app/api/account_data.py`; the Room deletion body moves to `app/api/rooms.py::purge_room`, shared by both. New error keys `errors.account.deletionNotConfirmed`, `successorNeeded`, `signInDeletionFailed`.
- Backend 31_2: `GET /account/export` in the same module.
- Frontend 31_3: `components/account/PrivacySection.tsx` ("Your data" on the Account page: download, link to the notice, delete with a typed confirmation word in the app language), `hooks/useAccount.ts` (`useExportPersonalData`, `useDeleteAccount`, which signs out locally after the deletion), `pages/PrivacyPage.tsx` and `lib/privacy.ts`.
- No migration.

## Left to the product owner

- The controller's identity and contact address for the notice.
- Legal review of the notice's text, retention periods and legal bases.
- Data processing agreements with Supabase, OVHcloud and Vercel (each offers a standard DPA), and confirming Vercel's EU-U.S. Data Privacy Framework certification, as the notice states.
- Whether request logs need a time limit as well as the size limit they have.

## Definition of Done

- A user downloads their data from the Account page and gets a JSON file with the content above.
- A user deletes their account: their solo Rooms are gone, their shared Rooms show them as an unknown user, they are signed out, and signing in again with the same provider starts a new, empty account.
- The last Master or Administrator of a shared Room is told which Rooms to hand over first.
- `/privacy` is readable signed out.
- Backend `pytest` at 100% coverage, `ruff`, `mypy`; frontend `npm run build`, `npm run lint`, `npm test`.

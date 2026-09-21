# Architecture Context

## Stack

| Layer     | Technology                          | Role                                                                 |
| --------- | ------------------------------------ | --------------------------------------------------------------------- |
| Frontend  | React + Vite + TypeScript            | SPA UI. Talks to the backend API only — never queries Supabase directly for domain data (see Auth and Access Model). |
| Backend   | Python + FastAPI                     | Sole writer/reader of domain data. Owns authorization, visibility filtering, ownership rules, the Reveal action, audit logging, and the Agent export/API. |
| Database  | Supabase (PostgreSQL)                | Persistent storage for all domain metadata — Rooms, Memberships, Documents, Tags, Threads/Posts, Glossary, Invitations, AuditLog. |
| Auth      | Supabase Auth (Google OAuth)         | Identity and session issuance (D-07). Backend verifies the Supabase JWT on every request; it does not manage passwords or OAuth itself. |
| File Storage | Supabase Storage                  | Document images and other uploaded media (D-09, FR-D1). Only the file path/URL is stored in Postgres. |

## System Boundaries

**Two codebases**, each with its own repo/folder:

- `frontend/` — React SPA. Renders UI, manages client‑side Supabase Auth session (login, token refresh, logout), and calls the backend API for everything else (Rooms, Documents, Threads, Tags, Glossary, visibility, invites, export). It never reads or writes Postgres or Storage directly.
- `backend/app/api/` — FastAPI route handlers, one module per resource (`rooms`, `documents`, `threads`, `tags`, `glossary`, `visibility`, `invitations`, `export`). Routes parse/validate input and call the domain layer; they contain no business rules themselves.
- `backend/app/domain/` — Framework‑independent business logic: role checks, Ownership rules (D-03, D-12), visibility filtering (VR-01…VR-11), the Reveal action, the reply‑visibility constraint (D-17), Administrator/Master succession rules (D-16). This is where every invariant in this document is enforced, and it is what a test can exercise without spinning up FastAPI or a real database.
- `backend/app/db/` — Data access layer: Postgres queries/repositories and Supabase Storage calls. No business rules here — only reads/writes, shaped by what the domain layer asks for.
- `backend/app/auth/` — Verifies the Supabase‑issued JWT on incoming requests and resolves it to an internal user id + active Room membership.
- `context/` — This spec/context folder, shared reference for both codebases and for any Agent (not part of either app's build).

## Storage Model

- **Database (Supabase Postgres)**: all metadata and relationships — Users (mirrored from Supabase Auth), Rooms, Memberships (role: Master/Player, Administrator flag), Documents (name, description, Tags, Owner refs, image *reference*), Tags, GlossaryEntries, Threads/Posts (Comments and Details), Invitations, VisibilityRule, AuditLog.
  - The `Users` mirror is intentionally minimal (`id`, `email`) and kept in sync **opportunistically, not via a dedicated sync job**: whenever a request creates a Room or accepts an Invitation, the backend upserts a row for the acting user from their already-verified JWT claims (`app/db/users_repo.py`). This is enough to show a human-readable identity in the members list (built for UC-05) without a webhook or scheduled job; a user who has never created/joined a Room simply has no row yet, which is fine since they can't be a `Membership.user_id` in that case either.
- **File/Blob Storage (Supabase Storage)**: Document images and other uploaded media. The backend authorizes an upload (checking the user is an Owner of the target Document, D-12); the client never talks to Storage and never holds a bucket key.
  - **Document images** (bucket `document-images`, table `document_images`, many per Document) are **proxied through the backend**, not uploaded client-side with a signed URL: the client sends either the file (`POST .../images`, multipart) or a URL (`POST .../images/from-url`), and the backend validates the bytes are a real PNG/JPEG/WebP/GIF (Pillow, by content, not filename), downscales to ≤1920px on the longest side, re-encodes to WebP (which also strips EXIF/GPS metadata), then uploads with its secret key. Chosen over the signed-upload-URL flow because URL imports have to be fetched and resized server-side anyway, and one server-side pipeline means the size/format rules can't be bypassed by a modified client. Replaced the earlier single-`image_path`-column draft (never shipped) on 2026-09-21.
  - **URL imports are an SSRF surface**: `app/db/remote_images.py` only allows http(s) to publicly routable addresses (re-checked on every redirect hop, max 3), with a timeout and a 20 MB streaming cap. Residual risk: DNS rebinding between the check and httpx's own resolution is not prevented.
  - **The bucket is public**; object paths are `{room_id}/{document_id}/{random uuid}.webp`, so an image URL can't be guessed, but anyone who *has* a URL can fetch it regardless of the Document's current visibility — and Supabase's CDN keeps serving a deleted object's public URL for a while (confirmed live). Tracked as an open question in `progress-tracker.md` (private bucket + short-lived signed read URLs is the fix if this matters).

## Backend Data Access

- The backend connects to the Supabase Postgres instance **directly** — SQLAlchemy 2.0 (async, `postgresql+asyncpg` driver) for queries, Alembic for schema migrations — rather than through Supabase's PostgREST/`supabase-py` client. Decided when building the Rooms/Membership slice (2026‑09‑21). (`asyncpg` over `psycopg[binary]`'s async mode: the latter cannot run under Windows' default `ProactorEventLoop`, which is what `uvicorn`/`alembic` use on Windows by default — `asyncpg` has no such restriction.)
- Chosen so that a multi‑table write (e.g. creating a Room + its initial Membership + its default Tags, or a role change + its AuditLog row per Invariant 7) commits as one real Postgres transaction. PostgREST has no cross‑table transaction primitive from the client side; the alternative would have been pushing that logic into Postgres functions/RPCs, which would split business logic between Python and SQL and contradict the File Organization rule that `backend/app/domain/` is where every invariant is enforced.
- Connects via Supabase's **Session Pooler** (`aws-0-<region>.pooler.supabase.com:5432`, user `postgres.<project-ref>`), not the Direct Connection host — the direct host only has an IPv6 DNS record, which isn't reachable from every network (confirmed during setup: `db.<project-ref>.supabase.co` resolves only to an AAAA record).
- `backend/app/domain/` stays framework‑independent per `code-standards.md`: it works with plain dataclasses, not SQLAlchemy model instances, and does not itself open a DB session. `backend/app/db/` holds the SQLAlchemy models and the repository functions that turn a domain decision into an atomic write.
- Because RLS is not the primary authorization mechanism (see Auth and Access Model below), the backend's Postgres role has normal read/write access to its own tables; policy hardening is tracked under Open items.
- App tables that reference a user (`Room.created_by`, `Membership.user_id`, `Invitation.created_by`, ...) store the id as a plain UUID column with **no database‑level foreign key to Supabase Auth's `auth.users`**. That id always comes from a server‑verified JWT `sub` claim (`backend/app/auth/`), never from unchecked input, so the FK would only guard against a bug this app structurally cannot have — while coupling our migrations to a schema we don't own and blocking integration tests from using synthetic user ids (a real FK rejected them, since Supabase Auth never created a matching row for a self‑signed test token).

## Auth and Access Model

- Every user signs in via **Supabase Auth using Google OAuth** (D-07, FR-A1); the frontend holds the resulting session and attaches it as a Bearer token on every backend request.
- The **backend verifies the Supabase JWT** on each call and resolves it to an internal user id — it is the only component that trusts the token; the frontend never talks to Postgres directly, so Row‑Level Security is not relied on as the primary authorization mechanism (kept as optional defense‑in‑depth, not a substitute for backend checks).
- **Roles are per‑Room** (D-06): Master, Player, and the stackable Administrator role (D-11), all read from the `Membership` row for the (user, room) pair — never assumed globally for a user.
- **Ownership** of a Document determines who can edit its description and reassign its Ownership (D-03, D-12). The Master always has *implicit* Ownership of every Document in their Room, even without an explicit Owner row.
- **Visibility** is a separate axis from role/Ownership: it governs which members can *see* a given Document, block, Post, or Glossary entry (section 8 of `requirements.md`). The Master always sees everything in their Room regardless of visibility (D-01, VR-01).
- Every mutating endpoint checks role/Ownership **before** applying any change; every read endpoint applies the visibility filter **before** returning any content — see Invariants.

## Invariants

1. **Visibility is enforced only in `backend/app/domain/`, on every read path** — lists, search, Tag filters, Glossary, counts, backlinks, notifications, exports, and the Agent API all pass through the same visibility filter before a response is built. No route handler or data‑access query is allowed to return unfiltered content directly to the client (I-01, NFR-01, VR-07).
2. **The frontend never accesses Postgres or Storage directly.** All domain reads and writes go through the backend API, so authorization and visibility logic exist in exactly one place (this document's Auth and Access Model).
3. **A reply can never be stored with a visibility wider than its parent post.** This is enforced in the domain layer when a reply is created or its visibility changed, not only validated client‑side (D-17, VR-04, FR-V6).
4. **The Master is always treated as an implicit Owner** of every Document in their Room, even with no explicit Owner row — any Ownership check must account for this rather than querying the Owner list alone (D-12).
5. **A Room can never end up without a Master or without an Administrator.** The last Master cannot leave or be demoted, and the last Administrator cannot leave, without first designating a successor — enforced as an application‑level check on every membership‑removal and role‑change request, not left to the UI (D-16, FR-R7).
6. **Role and Ownership checks run before any mutation**, and visibility checks run before any content is included in a response — never after (mirrors the corresponding rule in `code-standards.md`).
7. **Every visibility change, Reveal action, role change, and Ownership transfer is written to the AuditLog** in the same transaction as the change itself (VR-08, NFR-06).

## Open items for this layer

- **RLS as defense‑in‑depth**: whether to also add Postgres Row‑Level Security policies mirroring the backend's rules, as a second safety net in case of a backend bug. Proposed for a later hardening pass, not the MVP.
- **Export format for Agents** (FR-G1): JSON vs. Markdown vs. both — to be decided when the export endpoint is designed.

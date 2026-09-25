# TTRPG Campaign Notes

## Overview

A web application where the members of a tabletop RPG (TTRPG)
campaign collaboratively build and maintain the notes and lore of
that campaign — places, NPCs, events, artifacts, and anything else
worth recording. Players and the Game Master (called Master here)
work in shared "Rooms," each representing one campaign, with
fine‑grained control over who can see which piece of information.
The resulting documentation is meant to become a stable knowledge
base that later powers AI Agents (e.g. a Master's assistant, a
lore‑lookup bot) with campaign context scoped to what the
requesting user is allowed to see.

Full requirements, decisions and open questions live in
`context/requirements.md` (the source spec). This file summarizes
them for day‑to‑day implementation use; IDs like `D-01`, `FR-D1`,
`UC-06` refer to that document.

## Goals

1. A signed‑in user can create a Room and invite others, who join
   with a role (Master or Player) that applies only to that Room.
2. Members can create Documents (places, NPCs, events, artifacts,
   or anything else — Documents are not rigidly typed, see D-05)
   and organize them with Tags and a Glossary.
3. Members can discuss and enrich a Document through a thread of
   Comments and titled Details, each with its own visibility.
4. Every piece of content (Document, Detail, Comment, Glossary
   entry) can be hidden from specific members; visibility is
   enforced server‑side on every read path, not just in the UI
   (NFR-01, VR-07).
5. A Room's content can be exported as structured context, scoped
   to the visibility of the requesting user, for consumption by an
   AI Agent (FR-G1, FR-G2).

## Core User Flow

1. User signs in with Google (FR-A1), or with Discord, Facebook, GitHub
   or X (spec 08). Their provider name and picture
   become their display name and avatar by default (copied once, then
   theirs to change or remove), and they can adjust their profile on
   the Account page: display name, avatar, pronouns and a short
   description (FR-A2). The display name is shown instead of
   their email wherever the app names them.
2. User creates a Room (becomes Administrator + Master, UC-02) or
   joins one via an invite link (becomes Player by default, UC-04).
3. A member creates a Document (a place, an NPC, an event, …),
   gives it a name, description, image and Tags, and sets its
   visibility (UC-06).
4. Other members browse Documents by Tag or search, and read the
   ones visible to them (UC-09, UC-15).
5. Members add Comments and Details to a Document's thread, each
   with its own visibility (UC-11, UC-18).
6. The Master reveals previously hidden content when the story
   calls for it (UC-13).
7. An Owner of a Document may promote a thread contribution into
   the Document's own description (UC-16).
8. An Agent, acting on behalf of a specific user, requests a
   context export and receives only what that user can see (UC-17).

## Features

### Authentication & Account
- Google sign‑in (FR-A1), plus Discord, Facebook, GitHub and X
  (spec 08, 2026-09-23). Google stays the highlighted option.
- Profile defaults from the sign-in provider (Google, Discord, Facebook,
  GitHub or X): the first time a user opens the app, their sign-in
  provider's name and picture are copied in for whatever they haven't
  set. It happens once; later edits and removals stick, and changes to
  the sign-in provider's account don't overwrite them.
- Account page (FR-A2), opened from the circular avatar at the top
  right of every page: display name, avatar (file upload or image
  URL, cropped to a square and resized server‑side, always shown as a
  circle), pronouns, short description, and sign‑out. Logout lives
  here only; the old header "Esci" button is gone.
- A user is named by their display name everywhere (members list,
  Document Owners, Comments, pickers, account button), falling back
  to their email. Pickers that grant access (Owner, Selective) show
  "Name (email)", since names aren't unique.

### Language
- The UI is in Italian and English (spec 09, 2026-09-24). It starts in the
  browser's language (English for any other locale), and a flag
  selector just before the account avatar switches it. The choice is
  remembered on that browser.
- Every UI string lives in a resource file per language, so adding a
  language means adding a file (plus its flag).

### Rooms
- Create / edit / archive / delete a Room (FR-R1).
- Invite via link or code, with expiry and revocation (FR-R2, FR-R3).
- Per‑Room roles: Administrator, Master, Player — a role is scoped
  to one Room, not global to the user (D-06). Administrator is a
  third, stackable role (assignable to multiple users) that manages
  Room membership and settings; Master owns the content (D-11,
  OQ-09). The Room creator starts as both.
- Manage members and roles; designate a new Master or Administrator
  (FR-R4, FR-R5). The last Administrator cannot leave without
  naming a successor (D-16, FR-R7).
- A departing/removed member's content stays, unless deleted;
  Document ownership they held is reassignable (D-15, FR-R8).

### Documents
- CRUD with name, image, description (rich text/Markdown), Tags
  (FR-D1). No rigid "type" field — types are just Tags (D-05).
- Ownership model: creator is Owner by default, Master is always an
  implicit Owner, Owners can be added/removed (D-12, FR-D2).
- Only an Owner edits the description; everyone else contributes
  via the thread (D-03).
- Details: titled sub‑descriptions posted to the Document's main
  thread (e.g. "Distinguishing marks: a wooden leg that creaks with
  every step") — the mechanism for arbitrary extra information, in
  place of custom fields (D-18, FR-D3).
- Cross‑Document links via mentions, with backlinks (FR-D4).
- Version history with restore (FR-D5).
- Per‑Room toggle for whether Players can create Documents,
  default on (D-13, FR-D7).

### Tags, Glossary & Navigation
- Room‑scoped Tags with optional category; default Tags (NPC,
  Place, Event, Artifact) created with the Room (D-14, FR-N1).
- Filter Documents by one or more Tags (FR-N2).
- Glossary of terms, filterable by Tag, linked to related Documents
  (FR-N3, FR-N4).
- Full‑text search across Documents, Posts and Glossary, always
  visibility‑filtered (FR-N5).

### Threads
- Every Document has one main thread; Comments and Details are
  posts within it, with nested replies (FR-T1).
- A reply is never more visible than its parent post (D-17, FR-V6).
- Edit/delete own posts; Master can moderate (FR-T5).
- Mentions, reactions, pinning, marking resolved (FR-T6, FR-T7).
- Promote a post/Detail into the Document's description or into a
  new Document (FR-T8).

### Visibility
- Levels: Room (all members), Master‑only, Private (author/Owner +
  Master), Selective (explicit user list) — section 8 of the spec.
- Applies to a Document, a block within it, and any post (FR-V1).
- Master always sees everything in their Room (D-01, VR-01).
- A Player controls the visibility of their own contributions
  relative to other Players (D-08, VR-02).
- "Reveal" action widens visibility and is audit‑logged (FR-V2).
- Enforced server‑side on every read path — lists, search, tag
  filters, glossary, counts, backlinks, exports, API (FR-V4, VR-07).

### Agent Integration
- Structured Room export (JSON/Markdown) with stable IDs, Tags,
  Document links and thread structure (FR-G1).
- API access scoped to the requesting user's own visibility — an
  Agent never sees more than the user it acts for (FR-G2, I-01).

## Scope

### In Scope
- OAuth authentication: Google (preferred), Discord, Facebook, GitHub, X.
- A per‑user profile (display name, avatar, pronouns, description)
  managed on the Account page.
- Rooms, per‑Room roles (Administrator, Master, Player) and invites.
- Documents with Tags, Glossary, and version history.
- Threaded Comments and Details per Document.
- Multi‑level, server‑enforced visibility, including the Reveal
  action and an audit log.
- Structured export / API for Agent consumption, scoped per user.
- Mobile‑usable web UI.
- UI in Italian and English, chosen by browser locale or flag selector.

### Out of Scope (for now)
- Real‑time collaborative editing (D-04) — concurrent contribution
  is fine, live co‑editing is not.
- Game‑system mechanics: character sheets, dice rolling, combat,
  maps.
- Native mobile apps.
- Email/password or magic-link login; providers beyond the five above.
- Changing the login email or deleting the account from inside the
  app — the email comes from the account and the Account page
  only shows it.
- Fully sealed content hidden even from the Master (VR-09) — future
  evolution, not prioritized.
- Localized backend messages (API error texts are still Italian; a
  separate task, see `architecture.md` → UI Language), languages
  beyond Italian and English, and translating user content (Documents,
  Comments, Tag names).

## Success Criteria

1. A signed‑in user can create a Room, invite another user, and
   that user joins as a Player while the creator is Administrator
   and Master (UC-01–UC-04).
2. A Player can create a Document, and a different Player cannot
   edit its description but can add a Comment or a Detail with
   independently chosen visibility (D-03, D-08, UC-06, UC-07,
   UC-11, UC-18).
3. Content set to "Master‑only" is invisible to Players in every
   list, search result and export until the Master reveals it, and
   that action is recorded (UC-13, VR-06, VR-07).
4. A reply can never be set to a wider visibility than its parent
   post (D-17, VR-04) — enforced, not just documented.
5. Removing or leaving a member preserves their existing content
   and makes their Document ownership reassignable, without ever
   leaving a Room without a Master or without an Administrator
   (D-15, D-16, UC-19).
6. A context export for a given user contains only Documents,
   Details and Comments that user is allowed to see (UC-17).

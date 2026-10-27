# Ex Libris

## Overview

Ex Libris (`exlibris.world`; the repository is still named
`TTRPG-Campaign-Notes`) is a web application where the members of a tabletop RPG (TTRPG)
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
   or anything else — Documents are not rigidly typed, see D-05),
   organize them with Tags and find them through the Room Index and
   full‑text search.
3. Members can discuss and enrich a Document through Notes (titled
   Details) and a thread of Comments, each with its own visibility.
4. Every piece of content (Document, Note, Comment, map) can be hidden
   from specific members; visibility is enforced server‑side on every
   read path, not just in the UI (NFR-01, VR-07).
5. Members can see how the campaign's Documents relate: live mention
   maps, hand‑drawn relationship maps and geographic maps (D-30…D-36).
6. A Room's content can be exported (JSON, Markdown, a printable PDF
   manual) scoped to the visibility of the requesting user, for people
   and for AI Agents (FR-G1, FR-G3).

## Core User Flow

1. A visitor lands on the public landing page, can try the read‑only
   Demo, and signs in with Google (FR-A1), Discord or GitHub. Their
   provider name and picture become their display name and avatar by
   default (copied once, then theirs to change or remove), and they can
   adjust their profile on the Account page: display name, avatar,
   pronouns and a short description (FR-A2). The display name is shown
   instead of their email wherever the app names them.
2. User creates a Room (becomes Administrator + Master, UC-02) or
   joins one via an invite link (becomes Player by default, UC-04).
3. A member creates a Document (a place, an NPC, an event, …),
   gives it a name, subtitle, description, images and Tags, and sets
   its visibility (UC-06). Names of other Documents are linked as
   mentions on save.
4. Other members browse Documents by Tag, through the Room Index or
   search, and read the ones visible to them (UC-09, UC-15).
5. Members add Comments (and Owners add Notes) to a Document, each
   with its own visibility (UC-11, UC-18).
6. The Master reveals previously hidden content when the story
   calls for it (UC-13), checking first with "View as" (UC-14).
7. Members draw maps of the campaign: a Document's mention map, free
   relationship boards, geographic maps (UC-26…UC-29).
8. A member exports the Room as a PDF manual, JSON or Markdown, or a
   user (or an Agent acting for them) uses the export as context
   (UC-17, UC-31).

## Features

### Landing page and Demo (spec 45, built)
- `/` is a public landing page for everyone: what Ex Libris is, six
  feature cards, sign‑in for visitors, "Open my Rooms" once signed in.
  The Rooms list is at `/rooms`, and a header burger menu jumps between
  the landing page, the Rooms page and each Room (FR-L1).
- A **Demo** shows the real app pages over a sample Room kept in the
  browser ("The Lost Lighthouse", English or Italian): no account,
  nothing reaches the backend, every write is refused. A banner switches
  the viewer between the Master and two Players, and a 13‑step guided
  tour points at the main features (FR-L2, D-44).

### Authentication & Account
- Google sign‑in (FR-A1), plus Discord and GitHub
  (spec 08, 2026-09-23; Facebook and X removed 2026-10-03). Google stays the highlighted option.
- Profile defaults from the sign-in provider (Google, Discord or
  GitHub): the first time a user opens the app, their sign-in
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
- The UI is in twelve languages (D-42, NFR-09): English and Italian,
  plus German, Spanish, French, Dutch, Polish, European Portuguese,
  Russian, Japanese, Korean and Simplified Chinese, marked beta until a
  native speaker reviews them. It starts in the browser's language
  (English for any other locale), and a flag selector before the
  account avatar switches it; the choice is remembered on that browser.
  The API's error messages follow the same choice.
- Every UI string lives in a resource file per language, so adding a
  language means adding a file (plus its flag); terms shared across
  languages are in `context/i18n-glossary.md`.

### Account and personal data (spec 31)
- From the Account page a user downloads all their personal data as a
  file and can delete their account: permanent and immediate; content
  written in shared Rooms stays, shown as "Unknown user" (FR-A3, FR-A4,
  D-41). A public `/privacy` notice is reachable without signing in.
  The legal review of that notice and the processing agreements with
  Supabase, OVHcloud and Vercel are owed by the product owner.

### Rooms
- Create / edit / archive / delete a Room (FR-R1), with an optional
  Room image set by an Administrator (FR-R9, spec 26).
- Invite via link or code, with expiry and revocation (FR-R2, FR-R3);
  invite a Friend directly (FR-F5).
- Per‑Room roles: Administrator, Master, Player — a role is scoped
  to one Room, not global to the user (D-06). Administrator is a
  third, stackable role (assignable to multiple users) that manages
  Room membership and settings; Master owns the content (D-11,
  D-28). The Room creator starts as both. Several Masters are allowed.
- Manage members and roles on the Room setup page; designate a new
  Master or Administrator (FR-R4, FR-R5). The last Administrator or
  Master cannot leave without naming a successor (D-16, D-29, FR-R7).
- A departing/removed member's content stays, unless deleted;
  Document ownership they held is reassignable (D-15, FR-R8).
- The Master can duplicate a Room from the Room card's menu: setup,
  Tags, Documents with Notes and images, and maps are copied; Comments,
  Attachments and members are not (FR-R10, specs 33, 40).

### Documents
- CRUD with name, optional subtitle, up to 20 images (one favorite),
  description (Markdown), Tags (FR-D1, FR-D10). No rigid "type" field —
  types are just Tags (D-05). An Owner can delete a Document behind a
  confirmation.
- Ownership model: creator is Owner by default, Master is always an
  implicit Owner, Owners can be added/removed (D-12, FR-D2). Only an
  Owner edits the description; everyone else contributes via Comments
  (D-03).
- **Notes** (the spec's Details): titled sub‑descriptions under the
  description, managed by the Owners and the Master, each with its own
  visibility, no replies (D-18, D-19, FR-D3). A Note can be flagged as a
  **Relational link**, the only source of a mention map's relations
  (D-33, spec 41).
- Mentions `#Document` with backlinks ("Mentioned in", FR-D4); names
  are linked automatically on save and "Generate mentions" links them in
  existing text (D-34, spec 39); a mention shows the Document's card on
  hover (spec 32); a Document or map opens side by side in a split view
  (spec 37).
- One version history per Document (name, description, every Note)
  with restore (FR-D5, specs 24, 24b).
- PDF Attachments (FR-D8, spec 16) and Characters with Posts written
  in character (FR-D9, FR-T11, spec 17).
- Image search over free libraries (Openverse) and read aloud with the
  browser's voices (FR-D13, FR-D14, specs 29, 30, 30b).
- Per‑Room toggle for whether Players can create Documents, default
  on (D-13, FR-D7).
- **Not built**: draft/published status (FR-D6).

### Tags, Room Index & Search
- Room‑scoped Tags with optional category; default Tags created with
  the Room (D-14, FR-N1). An Administrator picks and orders the **Main
  Tags**, which group the Documents list and the Room Index.
- Filter Documents by one or more Tags (FR-N2).
- **Room Index** (spec 44): a tab on the left edge of every Room page
  opens a small card with links to each Main Tag's Documents and to the
  Room's maps (FR-N7).
- Full‑text search across Documents, Notes, Comments and Tags, always
  visibility‑filtered, also from `Ctrl+K` (FR-N5, spec 21).
- **Not built**: the Glossary as its own entity of terms and
  definitions (FR-N3, FR-N4, FR-N6); the Room Index is the navigation
  that exists.

### Threads
- Every Document has one main thread of Comments with nested replies,
  limited indentation and collapsible branches (FR-T1, FR-T2, FR-T4);
  unread replies are marked (spec 19b).
- A reply is never more visible than its parent post (D-17, FR-V6).
- Edit/delete own posts; Master can moderate (FR-T5).
- @member mentions, reactions, pinning, marking resolved (FR-T6,
  FR-T7, spec 19c); images on Comments.
- Promote a Comment into the Document's description or into a new
  Document (FR-T8).
- **Not built**: paginated loading (FR-T3, parked) and general
  notifications (FR-T9; only the "Revealed" marks exist).

### Visibility
- Levels: Room (all members), Master‑only, Private (author/Owner +
  Master), Selective (explicit user list) — section 8 of the spec. A
  Room sets the default level for new content (VR-05).
- Applies to Documents, Notes, Comments and maps (FR-V1, VR-14).
- Master always sees everything in their Room (D-01, VR-01).
- A Player controls the visibility of their own contributions
  relative to other Players (D-08, VR-02).
- **Reveal** widens visibility in one step; the members who gain the
  content see it marked "Revealed" and a counter on the header avatar
  (FR-V2, spec 22). The visibility history is readable (FR-V5).
- **View as**: the Master previews the Room exactly as one member sees
  it (FR-V3, spec 22b).
- Enforced server‑side on every read path — lists, search, Tag
  filters, counts, backlinks, maps, history, exports (FR-V4, VR-07).
- **Not built**: sealed content hidden from the Master too (VR-09).

### Maps (specs 28, 36, 38, 41–43)
- **Free maps** (relationship maps): boards of Document cards (the
  Document's image as background, subtitle as caption), text cards,
  groups and labeled relations, with a color palette, strike‑through and
  Master‑only items. A relation belongs to its map only (FR-M1, FR-M2,
  D-30).
- **Mention maps**: a Document's live map of the Documents it mentions
  and that mention it, depth 0–3, drawn under its images; full‑screen
  page to arrange cards, copy as a free map (FR-M3, D-31).
- **Geographic maps**: a plane with a background image, areas, pins
  bound to Documents and labeled links; reading mode opens a Document
  beside the map; JSON import with a preview report, and export
  (FR-M4, FR-M5, D-32, specs 38, 38b).
- A map can be linked to a Document and shown on its page (FR-M6); the
  Room page shows a row of map cards that an Administrator can place
  among the Main Tag groups.
- A map can be unlocked so Players edit it (FR-M7, D-35); saves are
  sent change by change and an open map refreshes every 5 seconds
  (FR-M8, D-36). Maps work on phones (pinch zoom), but are edited from
  a larger screen.

### Export, Import and Agent Integration
- Structured Room export (JSON/Markdown) with stable IDs, Tags,
  Document links, Notes and thread structure (FR-G1, spec 23). One
  Document can be exported on its own in the same format (spec 27).
- **Room PDF**: the Room laid out like a game manual, in four styles
  (Gothic, Modern, Print, Parchment), A4 or Letter, built as a
  background job (FR-G3, specs 23b, 35). The PDF of one Document (spec
  27b) is specified, not built yet.
- Import one or more Documents, or a whole Room export, from JSON or
  Markdown, copying or replacing, with a preview first (FR-G4, spec 27).
  Maps travel in the Room's JSON export and import (spec 40).
- Everything exported is only what the requester sees; an Agent uses
  that export. **Dropped**: direct API access with personal tokens for
  Agents (FR-G2, spec 23c, D-45).

## Scope

### In Scope
- OAuth authentication: Google (preferred), Discord, GitHub.
- Landing page, read‑only Demo and guided tour.
- A per‑user profile managed on the Account page, personal data
  download and account deletion.
- Rooms, per‑Room roles (Administrator, Master, Player), invites,
  Friends, Room duplication.
- Documents with subtitle, images, Notes, Tags, mentions, Attachments,
  Characters and version history.
- Threaded Comments per Document.
- Multi‑level, server‑enforced visibility, including Reveal, "View as"
  and an audit log.
- Free, mention and geographic maps.
- Export (JSON, Markdown, PDF) and import, scoped per user.
- Mobile‑usable web UI in twelve languages.

### Out of Scope (for now)
- Real‑time collaborative editing of text (D-04): concurrent
  contribution is fine, live co‑editing is not. Maps only refresh
  every few seconds (D-36).
- Game‑system mechanics: character sheets (beyond a PDF Attachment),
  dice rolling, combat, battle maps.
- Native mobile apps.
- Email/password or magic-link login; providers beyond the three above.
- Changing the login email from inside the app.
- Direct API access for Agents (FR-G2, dropped).
- Translating user content (Documents, Notes, Comments, Tag names).
- Not built, still in the spec: Glossary entries (FR-N3/N4), draft
  status (FR-D6), notifications (FR-T9), sealed content (VR-09); see
  `requirements.md` §14.

## Success Criteria

1. A signed‑in user can create a Room, invite another user, and
   that user joins as a Player while the creator is Administrator
   and Master (UC-01–UC-04).
2. A Player can create a Document, and a different Player cannot
   edit its description but can add a Comment with independently
   chosen visibility (D-03, D-08, UC-06, UC-07, UC-11).
3. Content set to "Master‑only" is invisible to Players in every
   list, search result, map and export until the Master reveals it,
   and that action is recorded (UC-13, VR-06, VR-07, VR-14).
4. A reply can never be set to a wider visibility than its parent
   post (D-17, VR-04) — enforced, not just documented.
5. Removing or leaving a member preserves their existing content
   and makes their Document ownership reassignable, without ever
   leaving a Room without a Master or without an Administrator
   (D-15, D-16, UC-19).
6. A context export for a given user contains only Documents,
   Notes and Comments that user is allowed to see (UC-17).
7. A visitor can try the Demo without an account, and nothing they do
   in it reaches the server (UC-33).

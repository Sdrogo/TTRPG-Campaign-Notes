# 46 - Session 0 boards

## Goals

- Product owner's request (2026-10-27): "Vorrei che l'app fornisse una serie
  di strumenti di supporto alla sessione 0 di una campagna. Io personalmente
  ho usato diverse Retro boards per discutere cosa si vuole al tavolo, cosa
  va trattato con cura e cosa va evitato."
- A Room gets a **Session 0** page with two boards side by side:
  - a **Retro board**: columns the Master names (preset "Lo vogliamo al
    tavolo", "Con cura", "Da evitare", "Domande"), where every member writes
    post-its;
  - a **Lines & Veils board** ("Linee e Veli"): two fixed columns, **Lines**
    (never in the game) and **Veils** (happens off screen, only hinted at),
    filled by promoting post-its from the Retro board.
- Post-its are private drafts until their author publishes them; published
  post-its take reactions; a shared timer paces the writing; every change
  reaches every member's screen at once (push, not polling).
- `requirements.md` has no requirement for Session 0; this ticket adds none
  until the product owner asks.

## Decisions

Decisions 1-6 were taken with the product owner in the brainstorm thread on
2026-10-27; 7-15 are defaults picked the same day, to confirm on this
ticket.

1. **Draft, then publish** (product owner): a new post-it is a draft only
   its author sees, the Master included. "Publish" makes it visible to every
   member of the Room. Publishing cannot be undone (the author can still
   delete it, Decision 9). There is no Master reveal on the boards.
2. **Promote = copy** (product owner): a published Retro post-it can be
   promoted to Lines or Veils, by a **"Promote" button** on the post-it
   (main path, works on a phone) and by drag and drop from the Retro board
   onto a Lines & Veils column (desktop, same action). Promoting creates a
   copy on the Lines & Veils board linked to the original ("from the
   Retro"); the original stays where it is. A post-it promoted to Lines can
   still be promoted to Veils too (two copies), but not twice to the same
   column (409).
3. **Live updates** (product owner): every create, publish, edit, delete,
   promotion, reaction, column change and timer change appears on every open
   Session 0 page within about a second, without reloading, and the changed
   post-it or column glows briefly. Presence ("Marco is writing...") is not
   wanted (product owner: "possono bastare gli aggiornamenti").
4. **Timer** (product owner): the Master starts a countdown (5, 10, 15 min or
   a custom length up to 60 min), shown to everyone at the top of the page.
   It **does not block** anything: post-its can be written, edited and
   published before, during and after it. At zero it shows "Tempo scaduto"
   until the Master clears it or starts another. The Master can pause,
   resume and stop it. One timer per Room, shared by both boards.
5. **Reactions** (product owner): any member reacts to a published post-it
   with emojis, on both boards, like Comment reactions (spec 19c: one use of
   each emoji per member, at most 20 different emojis, the picker already
   used for Comments). Drafts take none.
6. **Not built on maps**: the boards are a new object, not a kind of free
   map (spec 28); maps keep their own 5 s refresh (spec 43).
7. **Anonymous or signed**: when publishing, the author chooses (default
   signed). An anonymous post-it shows no author to anyone, the Master
   included; the server keeps `author_id` only so the author can edit or
   delete it, and never sends it to anyone else. A promoted copy keeps its
   original's choice and shows the original author the same way.
8. **Who promotes**: the Master promotes any published post-it; a Player
   promotes their own. Players cannot move others' post-its. A Lines &
   Veils copy is deleted by the Master or by the original's author.
9. **Editing and deleting**: the author edits the text of their draft or
   published post-it (published edits go live, Decision 3) and deletes it;
   the Master deletes any published post-it (moderation). Editing an
   original does not change its copies. Deleting an original keeps its
   copies (their link just goes away).
10. **One Session 0 per Room**, created empty the first time someone opens
    the page; the Retro board starts with the four preset columns. The
    Master adds, renames, reorders and deletes Retro columns (a column with
    published post-its asks for confirmation; its post-its go with it).
    Lines & Veils columns are fixed. Several boards per Room (one per story
    arc) is a later ticket.
11. **Who sees it**: every member of the Room, both roles. No per-post-it
    visibility beyond draft/published. "View as" (spec 22b) shows the board
    as the member sees it, read-only, with their drafts hidden (drafts are
    never shown to anyone but the author).
12. **Limits**: post-it text up to 500 characters, plain text; at most 200
    post-its per board and 8 Retro columns.
13. **Where it lives**: a "Session 0" entry in the Room Index (spec 44) and
    in the Room title's "⋮" menu; route `/rooms/:roomId/session-zero`. On a
    phone the two boards are two tabs, and promotion is the button only.
14. **Not audited**, no History revisions (spec 24b), not in Room
    duplication (spec 33), JSON/PDF export (spec 23, 27) or search (spec 21)
    for now. Included in the user's own data export (spec 31: their own
    post-its, drafts too) and erased with the account (anonymous or not).
15. **Not in scope**: a Table Pact Document generated from the boards
    (later ticket 46b, proposed), a ready-made list of common themes, the
    X-card and end-of-session check-in, PC bond questions, presence and
    live cursors.

## Design

### Backend: boards (46_1)

- Migration, all tables backend-only (RLS + deny policy, like
  `comment_reactions`):
  - `session_zero` (`room_id` PK, `revision` int, `timer_duration_s`,
    `timer_ends_at`, `timer_paused_remaining_s`, `created_at`);
  - `session_zero_columns` (`id`, `room_id`, `board` `'retro'|'lines_veils'`,
    `kind` null or `'lines'|'veils'`, `title`, `position`);
  - `session_zero_cards` (`id`, `room_id`, `column_id`, `author_id`, `body`,
    `anonymous`, `published_at` null = draft, `source_card_id` null or the
    Retro original (`ON DELETE SET NULL`), `position`, `created_at`,
    `updated_at`); unique (`source_card_id`, `column_id`);
  - `session_zero_card_reactions` (`card_id`, `user_id`, `emoji`,
    `created_at`), as `comment_reactions`.
- Domain `app/domain/session_zero.py` (pure): `plan_publish`,
  `plan_promote` (published Retro original, target is a Lines & Veils
  column, Decision 8 rights, 409 on a second copy in the same column),
  `ensure_can_edit_card` / `ensure_can_delete_card`, column rules, timer
  rules (`start`, `pause`, `resume`, `stop`, a remaining time computed from
  `timer_ends_at` so clients only need the end time), limits. Emoji parsing
  reuses `app/domain/reactions.py::parse_emoji`.
- Routes `app/api/session_zero.py` under `/rooms/{id}/session-zero`:
  `GET` (both boards as the caller sees them: their own drafts plus all
  published post-its, `author` omitted on anonymous ones unless the caller
  wrote it, `mine`, `can_edit`, `can_delete`, `can_promote`, reactions,
  timer, `revision`); `POST .../cards`, `PATCH`/`DELETE .../cards/{card}`,
  `POST .../cards/{card}/publish` `{anonymous}`,
  `POST .../cards/{card}/promote` `{column_id}`, `PUT`/`DELETE
  .../cards/{card}/reactions/{emoji}`, `POST/PATCH/DELETE .../columns`,
  `PUT .../columns/order`, `POST .../timer` `{action, duration_s}`. Every
  write bumps `revision` under the Room's `session_zero` row lock. 404 for a
  draft that isn't the caller's (never 403, so a draft's existence never
  leaks). View-as refuses writes as usual.
- Account deletion and data export (spec 31) cover the new rows.

### Backend: live push (46_2)

- `GET /rooms/{id}/session-zero/events`: Server-Sent Events. Membership is
  checked when the stream opens; the stream then holds **no database
  connection** (the Session Pooler allows 15 clients in total).
- Events carry no content, only `{"revision": n, "kind": ..., "id": ...}`
  (`card`, `column`, `timer`, `reaction`). The client then re-reads the
  board with the normal `GET`, so the visibility rules stay in one place and
  a draft can never travel through the stream.
- An in-process broker (`app/realtime/broker.py`, a set of `asyncio.Queue`
  per Room) fans out after each write commits. One backend process serves
  each environment (uvicorn without workers, on the VPS and on Render), so
  in-process is enough; more processes would need Postgres
  `LISTEN/NOTIFY`, noted in `architecture.md` as the next step.
- A comment line every 25 s keeps proxies (Caddy, Render) from closing the
  stream; the client reconnects with backoff and re-reads on reconnect. A
  member who leaves the Room gets their stream closed on the next event.
- The stream is read with `fetch` and a `ReadableStream` (not
  `EventSource`), so it sends the usual `Authorization` header.

### Frontend: page (46_3)

- `pages/SessionZeroPage.tsx` at `/rooms/:roomId/session-zero`; entries in
  `RoomIndex` and the Room title menu.
- Desktop: Retro board (left, wider) and Lines & Veils (right), columns as
  vertical lists. Phone: two tabs. The timer bar sits on top, sticky.
- Post-it card: text, author or "Anonimo", "Bozza" badge on drafts,
  "dalla Retro" on copies, reactions row (`CommentReactions` reused or
  generalised), "⋮" with Publish, Edit, Promote to Lines / Veils, Delete as
  allowed. Publishing opens a small dialog with the anonymous switch.
- Drag and drop with native HTML5 drag (no new dependency; the app has no
  drag-and-drop library besides `@xyflow/react` for maps), only from a published Retro post-it the caller may promote
  onto a Lines & Veils column; dropping calls promote.
- Master tools: timer menu (5/10/15/custom, pause, resume, stop), column
  add/rename/reorder/delete.
- Strings in all 12 languages; "Session 0", "Lines", "Veils", "post-it"
  added to the i18n glossary.

### Frontend: live client (46_4)

- `hooks/useSessionZeroEvents.ts` opens the stream while the page is
  mounted and the tab visible, and invalidates `['rooms', roomId,
  'session-zero']` on each event (refetch, at most one in flight). Fallback:
  re-read every 30 s if the stream is down.
- The changed post-it or column glows for about 1.5 s (event `id`); the
  timer counts down locally from `timer_ends_at`.

## Tests

- Backend: a draft is invisible (404) to everyone but its author, the
  Master included; publish shows it to all; anonymous hides the author from
  everyone else in every response; promote rights (Master any, Player own,
  not a draft, not to the Retro, 409 twice to the same column); editing the
  original leaves the copy; deleting it keeps the copy; reactions only on
  published post-its; timer start/pause/resume/stop and remaining time;
  column rules and limits; writes bump `revision`; view-as refuses writes;
  account deletion and data export cover post-its.
- Live push: a write emits one event per open stream of that Room only;
  events carry no text; a non-member cannot open a stream.
- Frontend: drafts render with the badge; Promote menu and drop call the
  same mutation; an event triggers a refetch; the timer counts down from
  `timer_ends_at`.

## Build estimate

Claude's build time, not developer-days: 46_1 and 46_2 in one session,
46_3 and 46_4 in one or two more. One migration, to apply to the staging
database before merging and to production before the release.

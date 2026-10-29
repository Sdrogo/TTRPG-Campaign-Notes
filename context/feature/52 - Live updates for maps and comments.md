# 52 - Live updates for maps and comments

## Goals

- Product owner's request (2026-10-29): "Adesso che abbiamo implementato
  l'SSE per la sessione 0, vorrei capire quale sia l'effort ed il peso sul
  backend per farlo anche nelle mappe relazionali. E per portare qualcosa di
  simile a livello dei singoli Document (per i commenti principalmente)".
  After the analysis in the project thread, the product owner asked for this
  technical ticket the same day.
- Extend the Session 0 live push (spec 46_2 / 46_4) to:
  - **relationship maps**, free and geographic, replacing the 5 s polling of
    spec 43_2;
  - **a Document's page**, above all its Comments, which today change on
    screen only when the page reads them again.
- Keep the Session 0 model: content-free events after commit, the client
  re-reads with `GET`, an open stream holds no database connection.
- **Not** in scope: presence (who is looking or dragging), live typing,
  live mention maps (spec 36), the Documents list and the Room page, more
  than one backend process (see Decision 9).

## Today

- `app/realtime/broker.py`: an in-process broker; each stream is a
  `Subscription(room_id, user_id)` with a 64-event queue (a full queue
  closes the stream and the client reconnects). `publish` goes to every
  stream of a Room, or to one user's streams. `rooms_repo` closes a member's
  streams when they leave, and all of a Room's when it is deleted.
- `GET /rooms/{id}/session-zero/events` (`app/api/session_zero.py`):
  membership checked on a session closed before streaming, `: keep-alive`
  every 25 s, events `{revision, kind, id}` sent by `on_commit`.
- `deploy/Caddyfile`: the stream path is served without `encode` and with
  `flush_interval -1`.
- Client: `lib/sessionZeroEvents.ts` (`fetch` reader, since `EventSource`
  can't send `Authorization`) and `hooks/useSessionZeroEvents.ts`
  (open while the page is mounted and the tab visible, never in the Demo;
  reconnect after 1-30 s with a 30 s re-read meanwhile; 403/404 stop it;
  1.5 s glow on others' changes).
- Maps: `useMap(roomId, mapId, true, …)` and `useGeoMap(…, true)` refetch
  every `MAP_REFRESH_MS` (5 s) on `RelationshipMapPage` and
  `LinkedMapPanel`, whether anything changed or not. Each read takes a
  database connection and computes `visible_board`. Five viewers of one map
  make 60 reads a minute. Every map write already bumps
  `relationship_maps.revision` (`relationship_maps_repo.update_map`).
- Comments: `useComments` has no refetch interval; another member's Comment,
  reaction, pin or resolve appears only on the next read (focus, remount,
  own write).

## Decisions

Proposed by Claude on 2026-10-29, to be confirmed by the product owner.

1. **One stream per tab, per Room**: `GET /rooms/{id}/events`. It carries
   every topic (`session_zero`, `map`, `document`, `comments`), so a tab
   opens one connection whatever it shows (a map with a Document in the
   split pane included). It is open while a page that listens to it is
   mounted (Session 0, a map, a Document, the split pane) and the tab is
   visible.
2. **Session 0 moves onto it.** `GET /rooms/{id}/session-zero/events` stays
   as an alias that sends only the `session_zero` topic, for tabs opened
   before the deploy, and is removed in the release after.
3. **Events stay content-free**: `{topic, kind, id, revision}`. `id` is the
   map, Document or Comment touched; `revision` is the map's or the Session
   0's after the write (null for `document` and `comments`). `kind` says what
   happened (`changed`, `deleted`, and Session 0's existing kinds).
4. **An event goes only to the members who may know the object exists**,
   computed before commit and sent after it, to the union of who could see
   it **before and after** the write (so whoever just lost access also
   re-reads and sees it go):
   - `map`: members for whom `is_map_visible` holds;
   - `document`: members for whom `is_document_visible` holds;
   - `comments`: members who see that Comment in its thread
     (`is_comment_visible_in_thread`, a hidden parent included). The
     event's `id` is the **Document**, never the Comment, so a viewer never
     learns the id of a Comment they can't see.
   Masters are members like the others here (they see everything anyway).
   A "View as" header is ignored, as on the Session 0 stream.
5. **Maps drop the 5 s polling.** A map page re-reads its map on a `map`
   event for that map, and on any `document` event (cards show Document
   names, subtitles and images, and a reveal can add a card the viewer
   couldn't see, whose id they don't know yet). Re-reads are coalesced: at
   most one per second, and none while a pointer is down (the spec 43 rebase
   rule). An event whose `revision` the map already has is the viewer's own
   write and changes nothing. A `deleted` event, or a 404 on the re-read,
   shows the existing "map not found" state.
6. **While the stream is down**, a map is read every `MAP_REFRESH_MS` (5 s,
   today's behaviour), Session 0 every 30 s as today, a Document page every
   30 s. Once the stream is back, each listener re-reads at once.
7. **Document page**: a `comments` event for the Document re-reads its
   Comments (and the Document, for comment images in its gallery); Comments
   that another member added or changed glow for 1.5 s (`GLOW_MS`, as on
   Session 0). A `document` event re-reads the Document when it is being
   read; while the viewer has its edit form open, the form is left alone
   and the Document is re-read when the form closes. A Comment the viewer is
   writing or editing is local state and is never touched by a re-read.
8. **Which writes push** (backend):
   - `map`: every route that writes a map in `relationship_maps.py`
     (`PATCH`/`DELETE /{map_id}`, `PUT`/`PATCH /{map_id}/board`),
     `geographic_maps.py` (`PUT`/`PATCH /geo`, background upload, import
     and delete); creating a map pushes nothing (no page shows it yet).
   - `document`: `PATCH`/`DELETE` of a Document, reveal (visibility and
     grants), its images (upload, from URL, delete, favourite), owners and
     character player, restoring a version. Creating one and marking it
     read push nothing.
   - `comments`: every write in `comments.py` (create, edit, delete,
     images, reactions, pin, resolve, promote, reveal). A `document` event
     that changes a Document's visibility also covers its Comments.
9. **Still one backend process.** The in-process broker stays; the
   architecture already notes that more uvicorn processes would need
   Postgres `LISTEN/NOTIFY`, which would also need a direct connection (the
   Supabase transaction pooler doesn't support `LISTEN`). Not built here.
10. **No migration**: maps already have `revision`; Documents and Comments
    need none since their events carry no revision.
11. **Demo**: no stream and no polling, as for Session 0 today (the Demo has
    one user).

## Design

### Backend (52_1, 52_3)

- `app/realtime/broker.py`: `Event` gains `topic`; `publish(room_id, event,
  *, user_ids: Collection[uuid.UUID] | None = None)` replaces the single
  `user_id` (None = every stream of the Room, as today for Session 0's
  shared writes). `Subscription` gains `topics: frozenset[str] | None` for
  the Session 0 alias (Decision 2).
- `app/realtime/audience.py` (new): the audience helpers of Decision 4,
  `map_audience`, `document_audience`, `comment_audience`, each one query
  for the Room's memberships plus the grants the visibility functions
  already take (owners, selective grants, thread). Small Rooms make this a
  handful of rows. `push(session, room_id, event, before, after)` sends to
  `before | after` via `on_commit`, like `session_zero._push`.
- `app/api/events.py` (new): `GET /rooms/{id}/events`, the body of today's
  `session_zero_events` and `_stream` moved here (membership on an
  independent session, keep-alive, `X-Accel-Buffering: no`). Session 0's
  route becomes the alias; `session_zero._push` uses the new `Event`.
- Each route of Decision 8 computes the "before" audience when it loads the
  object (it already loads it to check access) and the "after" one before
  returning. A route that changes nothing visible may skip the push.
- `deploy/Caddyfile`: the matcher becomes
  `path /rooms/*/events /rooms/*/session-zero/events`.

### Frontend (52_2, 52_3)

- `lib/roomEvents.ts`: `readRoomEvents` (today's `readBoardEvents`, the
  parser shared) with `topic` on each event.
- `hooks/useRoomEvents.ts`: one stream per Room per tab, shared through a
  small provider at the Room route level and reference-counted by the
  listeners mounted; the reconnect, fallback and 403/404 rules of
  `useSessionZeroEvents` move here. `useRoomEvent(roomId, filter, onEvent,
  fallbackMs)` subscribes a listener.
- `useSessionZeroEvents` becomes a listener on topic `session_zero` (same
  behaviour, same glow).
- `useMap` / `useGeoMap`: `refetchInterval` only while the stream is down
  (Decision 6); `useMapEvents(roomId, mapId)` invalidates with the
  coalescing of Decision 5 (`lib/coalesce.ts`, pure, tested).
- `useComments` / Document page: `useDocumentEvents(roomId, documentId,
  editing)` (Decision 7), the glow reusing the Session 0 helper.
- `context/architecture.md` (Storage Model, live push) and
  `context/ui-context.md` (glow on Comments) updated with what is built.

### Units

- **52_1 Backend Room stream + map and Document events**: broker topics and
  audiences, `/rooms/{id}/events`, Session 0 alias, pushes of Decision 8
  for maps and Documents, Caddyfile. About 2 h of Claude build.
- **52_2 Frontend shared stream + live maps**: provider, Session 0 on the
  shared stream, maps without polling, coalescing. About 1.5 h.
- **52_3 Comments**: comment pushes and audience, Document page listener,
  glow, edit-form rule. About 2 h.
- Total one session, about 5-6 h, plus the product owner's test with two
  browsers on staging (one Master, one Player, a hidden Document on a map
  and a Private Comment).

## Load

- Connections: one stream per open tab inside a Room, none outside; no
  database connection while open (pool cap 5 + 2 unchanged).
- Memory: a queue and a suspended generator per stream, a few KB, plus
  Caddy's proxy state; 30 tabs stay well under 5 MB.
- Reads: an idle map costs nothing instead of 12 reads a minute per
  viewer. While several people edit, re-reads are capped at one per second
  per viewer and skipped during a drag, so the worst case is about today's
  polling, and only while somebody works.
- Writes: each pushing write adds one memberships query for its audience.

## Tests

- Broker: `user_ids` delivery, `None` to the whole Room, topic filter of
  the alias, a full queue still closes.
- Audiences: a map, Document and Comment hidden from a Player never reach
  their stream; a Player who loses access by a write gets the event (the
  "before" side); a Comment under a hidden parent; the `comments` event
  carries the Document id, not the Comment's.
- Routes: each write of Decision 8 publishes once, after commit, nothing on
  rollback; the alias sends only `session_zero`; leaving the Room closes
  the Room stream.
- Frontend: one stream for two listeners in one tab; coalescing (burst ->
  one re-read per second, none while the pointer is down); own revision
  ignored; fallback interval only while down; Document edit form not reset
  by a `document` event; Comment glow; the Demo opens nothing.
- Manual (staging, two browsers): a Player sees a Master's map edit within
  a second; a Document revealed to a Player appears on the map; a Private
  Comment never reaches the Player; Session 0 still live.

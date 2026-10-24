# 43 - Real-time map editing (analysis)

Analysis only: no decision is taken here and nothing is built. It sizes the
work so the product owner can pick a path; a ticket follows for the chosen
steps.

## Request

Product owner, 2026-10-24: "Vorrei che si possa sbloccare una mappa per
essere modificata dai giocatori. Inoltre penserei ad un sistema per rendere
Product owner, 2026-10-24: "I'd like a map to be unlockable so players can edit it. I'd also like a system that makes real-time editing between several people more effective; please analyse the implementation cost of this kind of feature."
peso implementativo di questo tipo di feature."

Two asks: (A) a map can be **unlocked** so Players edit it too; (B) make
**several people editing the same map at once** work well. This document
covers both, because (A) is what makes (B) a real problem.

## Decisions so far

- Unlocking maps for Players (Part A below) is specced and built separately
  as spec 42 (`42 - Maps editable by players.md`, PR #230); this file covers
  the multi-user sync. Spec 42 keeps whole-board saves with a stale-save
  guard (product owner's pick there, 2026-10-24): `relationship_maps.revision`
  (migration `e2b7c4f9a1d6`), raised on every save, and an optional
  `base_revision` on `PUT .../board` and `.../geo` that answers 412.
- **Per-item saves are built here, on top of spec 42**, once PR #230 merges:
  B1 reuses `revision` as its version number (so B1 needs no migration of
  its own), replaces the whole-board body and drops the 412 reload
  (`useReloadIfStale`). The unlock flag in Part A is spec 42's
  `players_can_edit`.

- **B1 confirmed** (product owner, 2026-10-24): "Mi piace l'idea di far
  salvare solo l'elemento modificato invece dell'intera mappa, anche per il
  salvataggio automatico ok". Saves, the 800 ms autosave included, send only
  the items that changed, not the whole board.
- **B2 is enough, no push** (product owner, 2026-10-24): "Può andare bene
  anche un refresh automatico ogni tot di secondi." The scope is B1 + B2;
  B3 (SSE) and B4 (presence) are not planned.
- **No editing on phones** (product owner, 2026-10-24): "Non si modifica da
  telefono." The editor keeps needing a screen at least `sm` wide, unlocked
  maps included.

## How it works today

Free boards (spec 28) and geographic maps (spec 38) save the same way.

- **Who edits**: `domain/relationship_maps.py::can_manage_map`, the map's
  creator and the Master; everyone else reads. Editing also needs a screen at
  least `sm` wide (`RelationshipMapPage.tsx::useMapAccess`).
- **Frontend**: the page loads the map once, keeps its own copy
  (`useAutosave`) and, 800 ms after the last change, sends **the whole board**
  (`PUT /rooms/{room}/maps/{map}/board`, `PUT .../geo` for geographic maps).
  The copy is never refreshed while the page is open: a refetch updates the
  React Query cache, not what is drawn.
- **Backend**: `plan_board_edit` applies the sent board in one transaction
  under the map's row lock (`lock_map`). What the editor sees and did not send
  is **deleted**; what they can't see is left alone (Invariant 1, hidden
  Documents never reach them). There is no version or ETag: `updated_at` is
  only shown.

### What goes wrong with two editors

Saves serialize, so the database never breaks, but the result is
**last-write-wins on the whole board, deletions included**:

1. A and B open the map. B adds a card and it saves.
2. A moves another card. A's save sends A's board, which has no B card; the
   B card is visible to A, so the backend reads it as "A removed it" and
   **deletes it**. B still sees it until reload, and B's next save re-creates
   it under the same id.
3. A and B both add the same Document: the second save is refused whole
   ("a Document twice on the map") and the editor shows a save error with no
   way out but reloading, losing their pending changes.
4. Nobody sees anybody else's changes until they reload.

Today this rarely shows because a map usually has one editor (its creator or
the Master). Unlocking maps for Players makes it the normal case.

## Constraints that shape the options

- **Single backend process** on the OVH VPS (one `uvicorn` worker, Caddy in
  front, `deploy/Caddyfile`). In-process pub/sub is enough today; a second
  instance would need a shared bus.
- **Pool cap**: 5 + 2 connections per process on the Supabase Session Pooler
  (15 per project). A long-lived connection (a socket per viewer, or a
  `LISTEN` per viewer) must **never hold a DB connection**.
- **Every `public` table is backend-only** (RLS deny policy for `anon` and
  `authenticated`). Supabase Realtime *Postgres Changes* respects RLS, so
  clients can't subscribe to map tables without opening them up, which the
  architecture forbids.
- **Per-viewer boards**: a Player must not learn about Documents or
  Master-only items they can't see. Anything pushed to clients either goes
  through the same `visible_board` filter or carries no content (a "changed"
  ping).
- **12 UI languages**: every new string is 12 translations.

## Part A: unlocking a map for Players

Now spec 42 (PR #230); kept here as the original sizing. Small and
independent of the sync work.

- **DB**: one migration, `relationship_maps.players_can_edit boolean not null
  default false`.
- **Backend**: split `can_manage_map` into *manage* (rename, visibility,
  delete, background, unlock: creator and Master, unchanged) and *edit the
  board* (also any member who sees the map when it is unlocked). `save_board`
  and `save_geo` use the second. Room duplication and JSON export/import
  (spec 40) carry the flag. The existing rules already fit Players: hidden
  items stay untouched, Master-only content is refused (403).
- **Frontend**: a switch in the map settings modal, `canEdit` already drives
  the editor, a small "unlocked" badge on the map card.
- **Tests**: permission matrix (Player on locked/unlocked, Selective map,
  preview-as-member refused).
- **Effort**: about 1.5 days, i18n included.
- **To decide**: who may unlock (proposed: creator and Master); whether a
  Player may delete items others placed (proposed: yes, like the creator
  today; the History doesn't cover maps, so there is no undo).

## Part B: options for multi-user editing

Effort is for one developer, backend + frontend + tests, on both map kinds.

| Option | What it fixes | Backend | Frontend | DB | Effort | Risk |
|---|---|---|---|---|---|---|
| B1 Patch saves + version | Lost items, whole-save failures | Save endpoints take a diff against `revision` | Diff last-saved vs current | none (spec 42's `revision`) | 2-3 d | Low |
| B2 Polling + merge | Others' changes appear in a few s | `GET .../version` (cheap) | Poll while visible, merge remote into local | none | 1.5-2 d | Low |
| B3 Push (SSE) | Changes appear at once, no polling | In-process broker, SSE route | Stream reader, same merge as B2 | none | 2-3 d | Medium |
| B3' Push (Supabase Broadcast) | Same as B3 | Send ping via Realtime REST | supabase-js channel | RLS on `realtime.messages` | 2-3 d | Medium |
| B4 Presence + soft locks | Who is here, "X is moving this" | Heartbeats in memory, pushed on B3 | Avatars, item highlight | none | 2-3 d | Low |
| B5 Live cursors | See others' pointers | WebSocket hub, throttling | Cursor layer | none | 3-4 d | Medium |
| B6 Hard per-item locks | No two people on one item | Lock table/leases, expiry | Lock UX, refusals | lock table | 3-4 d | Medium |
| B7 CRDT (Yjs) | Merge everything, offline | y-websocket or pycrdt server, persistence | Rewrite both boards on Y.Doc | new storage | 10-15+ d | High |

### B1. Patch saves and a board version (the fix)

The real bug is that a save means "this is the whole board". Instead:

- The client keeps the last board the server confirmed and sends only the
  difference: `created`, `updated` (whole items, per-item last-write-wins),
  `deleted` ids, plus the `base_revision` it started from.
- The backend applies it under the same lock, keeps every rule of
  `plan_board_edit` (visibility, Master-only, caps, foreign ids), bumps
  `revision` and returns the new board as the editor sees it.
- Conflicts become per item and harmless: an update or delete of an item that
  no longer exists is skipped (no resurrection); a second card for the same
  Document is dropped and reported, not the whole save; an arrow whose end was
  deleted by someone else is dropped.
- `base_revision` is informative (it tells the client to refetch), not a
  reason to refuse the save (unlike spec 42's 412): refusing would bring back "save failed" for
  ordinary concurrent work.
- Same change for `PUT .../geo` (areas, pins, links). Import, duplication and
  export (specs 38, 40) are untouched: they don't go through the editor.
- **Tests**: domain tests for each conflict case on both kinds; the existing
  `plan_board_edit` tests mostly carry over.

### B2. Polling and merge

- `GET .../maps/{map}/version` returns `revision` (one indexed read,
  no board). The editor and the read-only viewer poll it every ~4 s while the
  tab is visible; when it moves they fetch the board and **merge**: remote
  items replace local ones except items with an unsaved local change or being
  dragged.
- Load: 10 open maps at 4 s = 2.5 short requests a second, no pool pressure.
- This alone, on top of B1, makes shared editing usable at table speed.

### B3. Push instead of polling

- **SSE from the backend** (recommended if push is wanted): an in-process
  broker (`dict[map_id, set[queue]]`) fed by the save endpoints after commit;
  `GET .../maps/{map}/events` streams `{"version": n}` pings, so no content
  leaks and every client refetches through the normal filtered read. The
  stream checks visibility once at connect, then **releases its DB session**.
  `EventSource` can't send the `Authorization` header, so the client uses a
  fetch-based reader (or a short-lived stream token). Caddy proxies SSE as is.
  Limit: one process only; a second instance would need Postgres
  `LISTEN/NOTIFY` on one shared connection (counts against the pool) or
  Redis.
- **Supabase Realtime Broadcast** instead: the backend posts the same ping to
  a private channel per map; clients subscribe with the supabase-js client
  they already have. Works with several backend instances, but needs RLS
  policies on `realtime.messages` that check Room membership (through a
  `security definer` function, since app tables deny clients), a new
  dependency and its quotas. Worth it only if the backend goes multi-instance.
- **WebSocket from the backend**: only if B5 is wanted; for pings SSE is
  simpler.

### B4. Presence and soft locks

- Each open editor sends a heartbeat (`POST .../presence`, every 10 s, plus
  "I'm moving item X" while dragging); the broker keeps it in memory and
  pushes it on the B3 stream. The page shows who is on the map and outlines
  an item someone else holds, with their name.
- Advisory only: nothing is refused, B1 still settles conflicts. Covers most
  of what hard locks would give, at a third of the cost.

### B5, B6, B7. Not recommended now

- **Live cursors** need a bidirectional socket and add little to a board that
  updates within a second.
- **Hard locks** add expiry, stuck locks and refusal UX for a problem B1 + B4
  already make rare.
- **CRDT (Yjs)** would replace the storage model with one shared document per
  map: every client would hold every item, breaking Invariant 1 (Players
  would receive hidden Documents and Master-only items), and export,
  duplication, search and the per-viewer read would all need rework. Out of
  proportion for maps edited by a handful of people.

## Recommended path

All steps build on spec 42 (PR #230), which brings the unlock switch and the
`revision` column; Part A above is kept only as the analysis that led to it.

1. **B1** per-item saves (2-3 days, confirmed by the product owner), once
   spec 42 merges: replaces the whole-board save and spec 42's 412 reload,
   reusing `revision` as the version.
2. **B2** polling and merge (about 2 days): others' changes show up in a few
   seconds. Stop here if it feels good enough at the table.
3. **B3 SSE** (2-3 days) if polling feels slow, then **B4** presence and soft
   locks (2-3 days) on the same stream.

Total for the full path: about 9-10 days; the first useful release (steps 1
and 2) about 4-5 days. No migration of its own: spec 42's `e2b7c4f9a1d6`
already adds `revision`.

## Open questions for the product owner

None left. Who may unlock a map, and whether Players may delete items others
placed, are settled in spec 42's Decisions.

# 75 - Monitoring dashboards

Status: **proposed 2026-11-17, waiting for the product owner's answers**
(Questions below). No code yet.

## Goals

- Product owner's request (2026-11-17): "ora che gestiremo tutto in casa,
  potremmo creare delle dashboard per monitorare statistiche, log e
  quant'altro?"
- With ticket 73 the whole stack (frontend, API, sign-in and, from step 5,
  the database) runs on our two OVH VPSes. Nobody else watches it any more,
  so we need to see, from a phone or a laptop:
  1. **Servers**: CPU, RAM, disk, network, and each Docker container, for
     production (VPS-2 Strasbourg, `51.77.150.38`) and staging (VPS-1 Erith,
     `57.129.179.240`).
  2. **Logs**: backend, Caddy and, after ticket 73 step 5, Postgres, in one
     place, searchable, without SSH.
  3. **App statistics**: users (total, new, active), Rooms, Documents, maps,
     storage used, background jobs, error rate, latency.
  4. **Alerts**: a message when something needs a person: API or site down,
     certificate about to expire, disk filling, server offline, nightly
     backup missing or too old (ticket 73 step 5).
- Light on resources: staging is a 4 GB box that also runs the product
  owner's own bots, production must keep its RAM for the app and Postgres.
- Nothing user-visible changes; `requirements.md` is not touched.

## Where we are (checked 2026-11-17)

- `deploy/compose.yaml`: `backend` + `caddy` per server, `json-file` logs
  rotated at 10 MB × 5 per container. Logs are read today only with
  `docker compose logs` over SSH.
- Caddy writes no access log (no `log` directive in `deploy/Caddyfile`).
- The backend logs with Python's `logging` (exceptions of the background
  jobs, auth, storage), unstructured, to stdout.
- `GET /health` answers `{"status": "ok"}` without touching the database;
  an external cron monitor pings it on both API hosts (architecture.md →
  Environments). It catches "API down", not "database down", and alerts
  nobody but the product owner's monitor account.
- Data the app already has for statistics: `auth_identities` (one per
  provider account, `created_at`, `last_sign_in_at`), `auth_sessions`
  (`created_at`, `rotated_at` on every token refresh, so it is a fair
  "last active" signal), `users`, `rooms`, `documents`, the maps tables,
  `files` / `document_images` (sizes), `export_jobs` / `import_jobs`.
- Backups do not exist yet: they ship with ticket 73 step 5, which already
  plans a "backup too old" check. This ticket gives that check its alert.

## Options

Rough RAM figures are the tools' typical idle use on a box this size, from
their documentation and common reports, not measured here; 75_1 measures
them.

### A. Light kit plus an Admin page in the app (recommended)

| Need | Tool | Runs where | RAM |
|---|---|---|---|
| Servers + containers, history, threshold alerts | **Beszel** (hub + one agent per server) | hub on staging, agents on both | hub ~30 MB, agent ~10 MB |
| Logs, live and searchable, every container | **Dozzle** (UI + agent) | UI on staging, agent on production | ~20–40 MB each |
| Uptime: API, site, certificates, backup heartbeat | **Uptime Kuma** | staging | ~100 MB |
| App statistics, errors, latency | **Admin page** inside Ex Libris | the app itself | a few MB in the backend |

- About **200 MB on staging, 40 MB on production**, a few MB of disk
  (Beszel keeps a small SQLite history; Dozzle stores nothing, it reads
  Docker's own logs).
- Monitoring sits on staging, **in another datacenter**: if production dies,
  the hub notices and alerts. If staging dies, the external cron monitor
  still pings production, and Beszel's own "agent offline" check fires
  when it comes back. Production carries only the two small agents.
- The Admin page reuses the app's sign-in, language, theme and tests, and
  counts rows through the backend, so no database port or read-only role
  has to be opened to another tool (after step 5 Postgres has no published
  port). It returns aggregate numbers only, never content, so the
  visibility filter (Invariant 1) has nothing to filter.
- Limits: Dozzle searches only what Docker keeps (10 MB × 5 per container,
  days to weeks at today's traffic), so it is a live/recent log viewer,
  not a log archive. Raising the rotation (e.g. 20 MB × 10) is free.

### B. Grafana stack

Grafana + Prometheus + node-exporter + cAdvisor + Loki + Alloy +
Alertmanager, plus a `/metrics` endpoint in the backend and Grafana reading
Postgres for the app statistics.

- One UI for everything, long retention, log queries (LogQL), any chart.
- **~0.8–1.2 GB RAM** and a few GB of disk for Prometheus and Loki
  retention; seven services to configure, upgrade and secure; dashboards are
  JSON to maintain. Grafana needs a path to production's Postgres (an SSH
  tunnel or Grafana running on production).
- Worth it with several servers and several people on call; for one product
  owner and two VPSes it is mostly upkeep.

### C. Light kit, app statistics in Grafana

Option A for servers, logs and uptime, but Grafana (~150 MB) with SQL panels
on a read-only Postgres role instead of the Admin page.

- No app UI to build; charts are configured, not coded.
- Another login, SQL in panels outside the repository's tests, no app
  error/latency data unless the backend writes it somewhere anyway, and the
  database path problem of B.

**Recommendation: A.** Smallest footprint, every piece replaceable on its
own, and the app statistics stay in code we already test and ship. If the
app grows to several servers or needs long log retention, Loki + Grafana
can be added later next to the same agents without undoing anything.

Rejected: SaaS monitoring (Grafana Cloud, Better Stack, Sentry): free tiers
exist, but the point of ticket 73 is not depending on another subscription,
and logs carry personal data (IPs, emails in auth logs) we would have to
list as another processor. Self-hosted Sentry/GlitchTip: several services
and ~1 GB+ for error tracking alone; the Admin page's error list covers it.

## Decisions (proposed defaults, option A)

1. **Hosts**: `monitor.exlibris.world` (Beszel), `logs.exlibris.world`
   (Dozzle), `status.exlibris.world` (Uptime Kuma), all A/AAAA records to
   the staging VPS, served by its Caddy with automatic certificates.
2. **Access**: each host behind Caddy `basic_auth` (one user, bcrypt hash
   in the staging server's `.env`, never in git), **plus** each tool's own
   login. Security headers as on the API (spec 72), `X-Robots-Tag: noindex`.
   No public status page.
3. **Agents on production, no new open port where possible**: the Beszel
   agent connects out to the hub over WebSocket with its token (supported in
   current Beszel versions; if the pinned version needs the hub to connect
   in, its port is opened in `ufw` to the staging IP only, and the agent
   runs with `network_mode: host` so `ufw` applies, since Docker bypasses
   `ufw` for published ports). The Dozzle agent listens on its port with
   the same rule (staging IP only). Docker socket mounted **read-only**.
4. **Files**: `deploy/monitoring/compose.yaml` + a `Caddyfile.monitoring`
   snippet for the staging server; the two agents as services in
   `deploy/compose.yaml` behind a compose profile `monitoring`, turned on by
   `COMPOSE_PROFILES=monitoring` in each server's `.env` (off by default, so
   a server without the settings keeps working). Images pinned by version.
   `deploy-staging.yml` copies the monitoring files on every deploy, like
   the rest of `deploy/`.
5. **Logs**:
   - Backend logs become one JSON line per event (time, level, logger,
     message, request id, route template, status, duration) so Dozzle
     can filter by field. No request bodies, no tokens, no user content;
     the user id only on errors, never the email.
   - Caddy gets an access log for the API host only, JSON to stdout, with
     the client IP **truncated** (last octet / last 80 bits zeroed) and the
     `Authorization` and `Cookie` headers dropped.
   - Postgres (after step 5): `log_min_duration_statement = 500ms`,
     connections and errors only.
   - Rotation raised to 20 MB × 10 per container (~200 MB worst case per
     container).
6. **Alerts**, through one channel (Question 1), sent by Beszel and Uptime
   Kuma (both use the same notification library family: Telegram, Discord,
   email, ntfy and others):
   - API `/health` and the site's `/` on both environments, every minute,
     after 3 failures;
   - TLS certificate expiring in under 14 days;
   - CPU above 90% for 10 minutes, RAM above 90%, **disk above 80%**,
     server offline;
   - **backup heartbeat**: the nightly backup job of ticket 73 step 5 pings
     an Uptime Kuma push URL on success; no ping for 26 hours = alert.
     Until step 5 ships the monitor exists but is paused.
   - a deep health check `GET /health/ready` (database reachable, under
     2 s) so "database down" alerts too; `/health` stays as it is for the
     container healthcheck.
   - Production alerts at any hour; staging alerts muted at night
     (Question 4).
7. **Admin page** (`/admin`, linked from the account menu only for admins):
   - Who: user ids listed in `ADMIN_USER_IDS` in `backend.env` (the product
     owner's). Everyone else gets 404 from both the page's API and the
     route. No new role in the data model.
   - **Overview**: users total, new (7/30 days), active (7/30 days, from
     `auth_sessions` refreshes), sign-ins per provider, Rooms, Documents,
     maps, Session 0s, Clocks, storage used (files + images, from the size
     columns), database size.
   - **Growth**: new users and new Rooms per week, last 26 weeks.
   - **Traffic**: requests per hour, 4xx and 5xx rate, p50 / p95 latency
     per route group (rooms, documents, maps, session zero, imports,
     exports, auth), last 7 days.
   - **Errors**: the last 100 server errors (time, route template, status,
     exception type and message, request id to find the full log in
     Dozzle). No request body, no user content.
   - **Jobs**: PDF exports and imports running, failed in the last 7 days.
   - Counts only, never content: the page shows no Room or Document names,
     no emails, no per-user list (privacy notice unchanged; spec 31).
   - Backend: a middleware times each request and adds it to hourly
     buckets in memory (per route group: count, 4xx, 5xx, a latency
     histogram), flushed every minute to `request_stats_hourly`; unhandled
     exceptions go to `error_events`. Retention 90 days for stats, 30 for
     errors, cleaned by the existing sweeper. Exact with one uvicorn
     process; when ticket 73's "several workers" ticket lands, each worker
     flushes its own rows and the page sums them (no shared counters
     needed). Neither table stores a user id, so
     `account_repo.erase_personal_rows` needs no change.
   - Frontend: one page, the app's components, simple bar/line charts in
     SVG (no chart library), strings in every UI language like any page.

## Units

| Unit | What | Claude build time | Product owner's part |
|---|---|---|---|
| 75_1 | Beszel hub + agents, Dozzle UI + agent, Caddy sites with basic auth, compose profile, JSON backend logs, Caddy access log, log rotation, notes in `architecture.md`, a setup guide in `/mnt/project-files/vps/` | ~1.5 h | 3 DNS records to staging; pick the password; the `ufw` rule on production if needed; first login to Beszel/Dozzle to create the admin users |
| 75_2 | Uptime Kuma, its monitors, `/health/ready`, Beszel thresholds, the alert channel; backup heartbeat wired (paused until 73 step 5) | ~45 min | create the Telegram bot / Discord webhook (Question 1) and paste its token in the tools' settings |
| 75_3 | Admin page: middleware + two tables (migration, `db-migration` label), stats/errors/jobs endpoints, page with charts, tests to the 100% coverage gate | ~2.5 h | add `ADMIN_USER_IDS` to both `backend.env` before the deploy; review the page |

Total: about **4.5–5 hours of Claude build time**, in two or three
sessions (75_1 and 75_2 together, then 75_3). 75_1–75_2 touch only the
servers and can ship before or after ticket 73 step 5; 75_3 is independent
of both. Each unit goes to staging first, as usual.

## Tests

- 75_1: `caddy validate` on the new Caddyfile (existing CI job); compose
  config check with and without the `monitoring` profile; a backend test
  that a log line is valid JSON and carries no `Authorization` value.
- 75_2: `/health/ready` answers 200 with the database up and 503 when the
  session raises; alert delivery tried by hand once per channel (the guide
  lists how).
- 75_3: middleware buckets (route templates, not raw paths; 5xx counted;
  flush), retention cleanup, admin gate (404 for a non-admin, for a missing
  setting, and for an admin id with a typo), each statistic against seeded
  rows, no personal fields in any response; frontend page states (loading,
  error, empty database) and the menu entry shown only to admins.

## Risks

- **Monitoring on staging**: a broken staging also hides production's
  dashboards. Mitigated by the external cron monitor staying on production
  and by staging having no other critical role. Moving the hub is a copy of
  one folder.
- **Docker socket access**: the agents read the socket (read-only mount),
  which still lets them see every container's settings, `backend.env`
  values included. Pinned official images, no published socket, agents
  reachable only from the staging IP.
- **Basic auth on public hosts**: brute force is the risk; bcrypt hash, a
  long password, Caddy rate limiting is not built in, so each tool's own
  login stays on as the second lock. Alternative in Question 2.
- **Personal data in logs**: IPs truncated, no emails or bodies logged;
  logs live on our servers only and rotate within weeks. The GDPR dossier
  gets one line (logs: what, where, how long) in 75_1.

## Questions for the product owner

1. **Alert channel**: Telegram (recommended: a bot in a private chat, push
   on the phone, both tools support it), Discord, email, or ntfy?
2. **Access to the dashboards**: public hosts with a password (recommended,
   works from the phone), or not exposed at all and reached through an SSH
   tunnel (safer, less handy)?
3. **App statistics**: Admin page in the app (recommended, option A) or
   Grafana (option C)? And anything missing from the list in Decision 7?
4. **Staging alerts**: muted at night (recommended) or treated like
   production?
5. **Where the monitoring lives**: on staging (recommended, other
   datacenter) or on production?
6. **Order**: 75_1–75_2 now and 75_3 after ticket 73 step 5 (recommended,
   the database work comes first), or all three right away?

## Out of scope

- Long-term log archive and log queries over months (Loki), tracing.
- Product analytics in the browser (page views, funnels, cookies).
- A public status page.
- Several API workers and shared counters (the separate ticket named in
  ticket 73 §5).

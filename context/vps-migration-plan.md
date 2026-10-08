# Production backend: Render → VPS migration plan

Written 2026-10-07 at the product owner's request. Scope: only the **production backend** moves. Staging stays on
Render, the database (and Auth and Storage) stays on Supabase, the frontend
stays on Vercel. The cutover happened on 2026-10-08: `architecture.md` →
Environments is the source of truth for the live setup, and this file is the
runbook (deploys, rollback) plus the remaining steps.

**Status (2026-10-08, 02:30 UTC)**: **cutover done.** Production runs on the
VPS (`api.exlibris.world` A/AAAA → VPS, Render production suspended for
rollback). Left: the frontend on `exlibris.world` (§10), deleting Render after
a quiet few weeks, backups and monitoring (§7, §8). History: §3 is done: the domain is `exlibris.world`
(registrar Hostinger, its DNS), `api.exlibris.world` is a custom domain of the
Render production service and the production frontend's `VITE_API_BASE_URL`
points at it. The VPS exists (OVHcloud VPS-1, 2 vCores / 4 GB, Debian 12 with
Docker, datacenter Erith, UK; host `vps-5a99f406.vps.ovh.net`, user `debian`)
and was hardened as in §4; `api-vps.exlibris.world` points at it. The files it
runs are in `deploy/` and `.github/workflows/deploy-prod.yml` (§5). Next: the
first deploy (§9 step 2), then the test and the switch. Production traffic is
still served by Render.

## 1. Where we are today

| | Production | Staging |
|---|---|---|
| Backend | Render Docker web service `exlibri-prod-docker.onrender.com` (created 2026-10-05; the old native service is retired once the switch is checked, see `architecture.md` → Environments) | Render Docker web service `ttrpg-campaign-notes-2.onrender.com` |
| Deploys | Render auto-deploys on push to `main` | Render deploys `staging` once CI passes |
| Frontend → backend | `VITE_API_BASE_URL` on Vercel points at the `*.onrender.com` URL, **no custom domain** | same, Preview variable scoped to `staging` |
| Settings | Render dashboard env vars (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `STORAGE_BUCKET`, `CORS_ORIGINS`) | same, pointing at the staging Supabase project, plus `CORS_ORIGIN_REGEX` for Vercel Preview deploys (staging only) |
| Uptime | An external cron/monitor pings `/health` (GET and HEAD, PR #88) to keep the instance awake and alert when it is down | none (left to sleep) |

What the backend needs at run time, all already in the image
(`backend/Dockerfile`): Python 3.12, Pango and friends for WeasyPrint, one
port (`$PORT`, default 10000), outbound HTTPS to Supabase (Postgres through the
**Session Pooler**, which is IPv4-reachable, plus the Storage and Auth APIs).
It stores **nothing on local disk** that must survive: PDFs go to Supabase
Storage, so the VPS holds no data to back up except its own configuration.

Three run-time properties that matter for this plan:

- **Database connections are shared.** Supabase's Session Pooler allows 15
  clients per project, across every backend on that database. With
  SQLAlchemy's default pool (5 + 10 overflow) Render and the VPS together
  went over it on 2026-10-08 and requests failed with `EMAXCONNSESSION`;
  each process is now capped at 5 + 2 (`DB_POOL_SIZE`, `DB_MAX_OVERFLOW`).

- **One process owns the background sweeps.** `app/main.py` starts the Storage
  cleanup sweep and the Room PDF sweep in the app's lifespan. At startup the
  PDF sweeper **fails every queued or running Room PDF job**
  (`export_jobs_repo.run_export_sweeper`), because it assumes nothing else is
  running. The Storage sweep is idempotent and safe to run twice. Consequence:
  whenever a second backend starts against the same database (a parallel run,
  a deploy that overlaps the old container), Room PDFs being rendered by the
  other one at that moment fail and the user has to start them again. Harmless
  for this migration, but it is why the plan keeps **one container** in
  production and accepts that a deploy can interrupt an in-flight PDF.
- **PDF rendering is the memory peak.** WeasyPrint on a large Room is the
  heaviest thing the backend does; 512 MB (Render Free/Starter) is tight for
  it, 2 GB+ is comfortable.

## 2. Cost comparison

Prices checked 2026-10-07 from public sources; **re-check on the provider's
page before ordering**, both Render and Hetzner changed prices in 2026.

| Option | Monthly | CPU / RAM | Notes |
|---|---|---|---|
| Render Free (likely today) | $0 | 0.1 CPU / 512 MB | Sleeps after 15 min idle (hence the keep-alive cron), cold starts, shared free instance hours, 5 GB bandwidth on the Hobby workspace since 2026-08-01 |
| Render Starter | $7 | 0.5 CPU / 512 MB | Always on, but the same 512 MB |
| Render Standard | $25 | 1 CPU / 2 GB | What a PDF-heavy backend really wants on Render |
| Hetzner Cloud, cost-optimized (CX23-class) | ~€4–6 + €0.50 IPv4 | 2 vCPU / 4 GB / 40 GB disk, 20 TB traffic | Best value; **availability limited since 2026-06** in some locations, prices raised in 2026 |
| Hetzner Cloud, ARM (CAX11-class) | ~€4–5 + IPv4 | 2 vCPU / 4 GB | Needs an `arm64` image (multi-arch build, see §5) |
| OVHcloud VPS (offer seen by the product owner) | €45/year (~€3.75) | 2 vCores / 4 GB / 40 GB NVMe | Daily backup included, unlimited traffic, 500 Mbps |
| OVHcloud VPS, larger (offer seen) | €86/year (~€7.20) | 4 vCores / 8 GB / 75 GB NVMe | Same, 1 Gbps |
| Netcup / Scaleway entry VPS | ~€3–7 | 1–2 vCPU / 2–4 GB | EU, similar class |
| DigitalOcean / Linode basic droplet | ~$6–12 | 1 vCPU / 1–2 GB | Pricier per GB, simpler UI |
| Backups add-on (Hetzner: +20% of the server) | ~€1 | | Optional, the server holds no data (§7) |

**Reading it**: against Render **Free** the VPS costs a few euros a month more
and buys an always-on instance with 8× the RAM and no cold starts. Against the
Render tier that would actually fit the PDF (Standard, $25), the VPS is about
5× cheaper. The real cost is the product owner's time: OS updates, TLS, deploys
and monitoring become ours (§4–§8), about an hour or two to set up and a few
minutes a month after that if unattended upgrades are on.

**Choice (product owner, 2026-10-07): OVHcloud VPS.** Two offers on the
table: 2 vCores / 4 GB / 40 GB NVMe / 500 Mbps for €45 a year, or 4 vCores /
8 GB / 75 GB NVMe / 1 Gbps for €86 a year, both with unlimited traffic and a
daily backup of the previous 24 hours. **Recommended: the 2 vCores / 4 GB one**
(about €3.75 a month): one backend container plus Caddy fits with room to
spare, 4 GB covers a large Room PDF, and the backend keeps no data on disk.
The 8 GB one only pays off if the server will also host something else (for
example staging, or other projects). Before ordering, check that the price is
not a first-year promotion with a higher renewal, that the datacenter is in the
EU (close to the Supabase region), and pick x86, which keeps the image
identical to CI and staging. OVH's included daily backup covers what §7 calls
optional.

## 3. Prerequisite: an API domain

Today the frontend calls `https://exlibri-prod-docker.onrender.com` directly.
A "DNS switch" needs a hostname we control, so the first step, **independent of
the VPS**, is:

1. Choose a domain (open question: does the product owner already own one, e.g.
   for the "Ex Libris" rename?). Use a subdomain such as `api.<domain>`.
2. Add it to the **current Render production service** as a custom domain
   (Render issues the certificate) and point the DNS record at Render.
3. Set `VITE_API_BASE_URL` on Vercel (Production) to `https://api.<domain>`
   and redeploy. CORS needs no change: it checks the frontend's origin, not
   the API's hostname.
4. Set the record's **TTL to 300 s** (or 60 s) at least a day before the
   cutover, so a switch or a rollback propagates in minutes.

From then on the backend's location is a DNS detail: the cutover and any
rollback are a record change, with no Vercel rebuild. Cloudflare DNS (free) is a
good home for the zone: fast propagation, an API, and optional proxying later.

*Without a domain* the switch still works, through Vercel: change
`VITE_API_BASE_URL` and redeploy; rollback is Vercel's "Instant Rollback" to the
previous production deployment (seconds, no rebuild). Slightly slower and it
ties the backend switch to a frontend deploy, so the domain is preferred.

## 4. VPS setup

One-time, by hand (or as a short `cloud-init` file kept outside the repo).

- **Image**: Debian 12 or Ubuntu 24.04 LTS. Add the product owner's SSH key at
  creation; no password login.
- **Users and SSH**: the image's own non-root `debian` user, in the `docker`
  group, with key-only login (`PermitRootLogin no`, `PasswordAuthentication no`
  in `/etc/ssh/sshd_config.d/99-hardening.conf`). The deploy workflow logs in
  as the same user with a key of its own (§6), so it can be revoked alone.
- **Firewall**: the provider's network firewall (OVH "Edge Network Firewall", outside the machine) *and* `ufw`
  inside: allow 22 (ideally only from the product owner's IP, or keep 22 open
  with key-only auth and `fail2ban`), 80 and 443; deny everything else. The
  backend's port 10000 is **never** exposed: only the reverse proxy reaches it
  over the Docker network. Note Docker bypasses `ufw` for published ports, so
  the backend container must not use `ports:` at all.
- **Updates**: `unattended-upgrades` for security updates with automatic
  reboot at a quiet hour (e.g. 04:00); the containers restart on boot
  (`restart: unless-stopped`).
- **Docker**: Docker Engine + Compose plugin from Docker's apt repository
  (OVH's "Debian 12 - Docker" image ships them). Log rotation is set per
  service in `deploy/compose.yaml` (10 MB × 5 files), so logs can't fill the
  disk.
- **Reverse proxy with HTTPS**: **Caddy** (automatic Let's Encrypt
  certificates and renewal, a five-line config, `deploy/Caddyfile`) in front
  of the backend. The names it serves come from `API_HOSTS`, so the cutover
  (§9) changes a line on the server, not the repository. Traefik works too but needs more configuration for one service. The
  certificate is issued when DNS points at the VPS; for the parallel run (§9),
  where DNS still points at Render, use a second name (`api-vps.<domain>`) so
  Caddy can get a certificate and the VPS can be tested end to end. Keep that
  name in `API_HOSTS` and in DNS for good: the deploy's health gate uses it
  (§5).
- **Request size and timeouts**: Caddy sets no request-body limit by default,
  so uploads behave as on Render, and long Room PDF renders run as background
  jobs, so no special timeout is needed.

The server's files live in `/opt/exlibris`:

| File | Where it comes from |
|---|---|
| `compose.yaml`, `Caddyfile`, `deploy.sh` | `deploy/` in the repository, copied by every deploy (§5); never edited on the server |
| `backend.env` | written once by hand, `chmod 600` (§6) |
| `.env` | non-secret settings for compose: `API_HOSTS` (by hand, §9) and `BACKEND_TAG` (written by `deploy.sh`) |

The `caddy_data` volume holds the certificates; losing it only means Caddy
asks for new ones.

## 5. Deploy pipeline

Keep the existing flow: feature PRs → `staging` (Render staging deploys after
CI) → release PR `staging` → `main`. Only what happens on `main` changes.

1. **Registry**: GitHub Container Registry (`ghcr.io`), free for this use and
   authenticated with the workflow's own `GITHUB_TOKEN` (`packages: write`).
   Keep the package private; the VPS pulls with a read-only token.
2. **Build once, in CI**: `.github/workflows/deploy-prod.yml` runs as a
   `workflow_run` after `CI` succeeds on a push to `main`, or by hand (Actions
   → Run workflow, with an optional commit or branch) to redeploy or roll back.
   It builds `backend/Dockerfile` like the `Backend image` job and pushes it as
   `ghcr.io/sdrogo/ttrpg-campaign-notes-backend:<commit SHA>`, so any deployed
   version is traceable and re-deployable. It is **off** until the repository
   variable `VPS_DEPLOY_ENABLED` is `true`, and, like every `workflow_run` and
   `workflow_dispatch` workflow, it only exists once it is on `main`.
3. **Deploy**: the workflow copies `deploy/compose.yaml`, `deploy/Caddyfile` and
   `deploy/deploy.sh` to `/opt/exlibris` over SSH and runs
   `deploy.sh <sha>`, which pins the tag in `.env`, pulls, recreates the
   containers, reloads Caddy and waits (up to 2 minutes) for the backend's own
   healthcheck. Then the workflow calls `https://api-vps.exlibris.world/health`
   from outside, through Caddy and HTTPS. The gate must **not** poll
   `api.exlibris.world`: before the cutover and after a DNS rollback that name
   points at Render, so it would pass while the VPS is broken. Only after both
   checks does the image also get the `prod` tag, which is what `compose.yaml`
   runs when no tag is pinned. Rollback: run the workflow by hand on an older
   commit, or on the server `bash deploy.sh "$(cat .backend_tag.previous)"`.
   *Alternative without SSH from CI*: a pull-based updater on the VPS
   (Watchtower watching the `prod` tag). Simpler, but deploys become invisible
   to CI and harder to roll back; the push-based job is preferred.
4. **Migrations stay by hand**, as today: applied to the production database
   with the product owner's go-ahead **before** the release PR is merged
   (`code-standards.md` → Branches and Pull Requests). The deploy job does not
   run Alembic.
5. **Turn off Render's auto-deploy** on the production service once the VPS
   serves traffic, so a merge to `main` deploys to one place only.
6. **Staging is unchanged**: Render keeps deploying `staging` from its own
   build. (Optionally, later, the staging deploy could reuse the CI-built image
   from GHCR via Render's "existing image" service type, so staging and prod
   run byte-identical images. Not needed for this migration.)
7. **Multi-arch**: only if an ARM VPS is chosen: build with `docker buildx
   --platform linux/arm64` (or both) in the deploy workflow, and run the
   `Backend image` smoke test on that platform once.

Downtime per deploy: `up -d` stops the old container and starts the new one,
a few seconds of 502 from Caddy. Acceptable at this scale; zero-downtime
(two containers behind Caddy, health-gated) is possible later but would run
two PDF sweepers at once (§1).

## 6. Secrets

- **Runtime settings** (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`,
  `STORAGE_BUCKET`, `CORS_ORIGINS`; no `CORS_ORIGIN_REGEX`, which only staging
  sets) live in
  `/opt/exlibris/backend.env` on the VPS, `chmod 600`, owner `debian`, copied
  once by hand from the Render production dashboard. They are **never** in the
  repo, in the image (`.dockerignore` already keeps `.env*` out, and CI checks
  it) or in GitHub secrets. Keep a copy in the product owner's password manager:
  it is the only thing needed to rebuild the server.
- **GitHub Actions secrets** (repository → Environments → `vps-production`, a name of its own because Vercel's deployments already use `production`; with
  `main` as the only allowed branch): `VPS_HOST`, `VPS_USER` (`debian`),
  `VPS_SSH_KEY` (the private half of a key made only for the workflow, its
  public half in `~/.ssh/authorized_keys` on the VPS), `VPS_KNOWN_HOSTS`
  (`ssh-keyscan -t ed25519 <host>`, checked against the server's own
  fingerprint: pin the host key, no `StrictHostKeyChecking=no`). Plus the
  repository **variable** `VPS_DEPLOY_ENABLED=true` to turn the workflow on.
  No Supabase secret is needed in GitHub.
- **Registry pull credential on the VPS**: a fine-grained / classic token with
  only `read:packages`, stored by `docker login ghcr.io` for the `debian` user.
- **Local env files are untouched**: `backend/.env` keeps production values on
  the product owner's machine, as documented in `architecture.md` → Local env
  files; nothing in this plan reads or repoints it.
- Rotate `SUPABASE_SECRET_KEY` after the old Render service is deleted only if
  there is any doubt about who had dashboard access; otherwise not needed.

## 7. Backups

- **Database, Auth and Storage**: unchanged, Supabase's responsibility (and
  its backup plan). Nothing in this migration changes what can be lost.
- **The VPS**: holds only `compose.yaml`, `Caddyfile`, `backend.env` and the
  Caddy certificates. Back up the first three (the env file in the password
  manager, the other two in the repo under `deploy/` once approved).
  Rebuilding from scratch is then: new server → §4 → copy files → run the
  deploy workflow. OVH's included daily backup, or a snapshot after setup,
  are a cheap extra but not required.

## 8. Monitoring

- **Uptime**: point the existing external monitor (the one that pings `/health`
  today, GET or HEAD) at `https://api.<domain>/health`. On an always-on VPS it
  no longer has to keep the instance awake, only alert: check every 1–5 min,
  alert by email/push after 2 failures. UptimeRobot, Better Stack or
  Healthchecks.io free tiers all fit.
- **Certificate expiry**: covered by the HTTPS uptime check failing; most
  monitors also warn on a certificate close to expiry.
- **Logs**: `docker compose logs -f backend` on the server; rotation as in §4.
  Optional later: ship them to Better Stack or Grafana Cloud's free tier.
- **Resources**: a disk and memory alert (the OVH control panel's graphs, or a tiny
  agent like Netdata / Beszel) so a full disk or a PDF memory spike is noticed.
- **Deploy failures**: the deploy workflow fails visibly in GitHub Actions
  (and emails the repo owner) when `/health` doesn't come back.

## 9. Cutover plan

Both run in parallel; the switch is DNS; rollback is DNS.

1. **Domain on Render first** (§3): `api.<domain>` → Render production,
   Vercel production uses it, TTL lowered to 300 s. Live for a few days with no
   other change, so any problem here is not confused with the VPS.
2. **Build the VPS** (§4) with a second name, `api-vps.<domain>` → VPS. Copy
   the production env vars. Deploy the image currently on `main`: the workflow
   exists once this plan's files reach `main` with a release; with the
   variable and secrets set, that release deploys it, or run it by hand (§5).
3. **Test the VPS in isolation**: `curl https://api-vps.<domain>/health`;
   then a Vercel **Preview** deploy with `VITE_API_BASE_URL=https://api-vps.<domain>`
   (production sets no `CORS_ORIGIN_REGEX`, so add that Preview's exact URL to
   `CORS_ORIGINS` in the VPS `backend.env` for the test, run
   `docker compose up -d backend`, and remove it afterwards): sign in, open a Room,
   edit a Document, upload an image, run search, generate a Room PDF and
   download it. It is the real production database, so test in a throwaway
   Room. Remember a VPS start fails any Room PDF in flight on Render (§1); do
   it at a quiet time.
4. **Switch**: replace the `api` CNAME (→ Render) with an A record
   `57.129.179.240` and an AAAA record `2001:41d0:801:2000::509a`, then on
   the server set
   `API_HOSTS=api.exlibris.world, api-vps.exlibris.world` in
   `/opt/exlibris/.env` and run `docker compose up -d caddy`. Caddy gets the
   certificate once DNS resolves to the VPS, so expect a few minutes of TLS
   errors for clients that already see the new record; do it at a quiet time.
   Remove `api.exlibris.world` from the Render service's custom domains
   only at step 7, since a rollback needs it. Watch the monitor, the backend
   logs and a real sign-in for an hour.
5. **Parallel period, about a week**: Render production stays deployed and
   idle (still receiving deploys from `main` until step 6, so it never lags).
   Both point at the same database; only the PDF-sweep caveat (§1) applies
   when either restarts.
6. **Then** turn off Render's production auto-deploy, enable the VPS deploy
   workflow on `main` (if not already), and repoint the uptime monitor.
7. **Retire Render production** after two quiet weeks: suspend the service
   first (keeps it restorable), delete it later. Update
   `architecture.md` → Environments, the `Dockerfile` header comment and
   `progress-tracker.md`.

**Rollback**, at any point before step 7: set `api.<domain>` back to the
Render CNAME (minutes, with the low TTL). Render must still be on the same code version as
the VPS, which step 5 guarantees. After step 7 the rollback is "un-suspend the
Render service, then switch DNS". A rollback never touches the database, since
both backends use the same one and migrations are applied separately.

## 10. Frontend on exlibris.world

Independent of the backend move, the production frontend can leave
`ttrpg-campaign-notes-eight.vercel.app` for the domain:

1. **Vercel** → project → Settings → Domains: add `exlibris.world` and
   `www.exlibris.world`, with `www` redirecting to the apex. Vercel shows the
   records to create.
2. **DNS** (Hostinger): replace the `@` A record (`2.57.91.91`, Hostinger's
   parking page) and the `www` CNAME (→ `exlibris.world`) with the values
   Vercel shows. Vercel issues the certificates.
3. **CORS**: add `https://exlibris.world` to `CORS_ORIGINS` on the Render
   production service and in the VPS's `backend.env` (then
   `docker compose up -d backend` there). Keep the `vercel.app` origin until
   nobody uses it. `www` needs no entry, since it only redirects.
4. **Supabase Auth** (production project → Authentication → URL
   Configuration): Site URL `https://exlibris.world`, and add
   `https://exlibris.world/**` to the Redirect URLs, keeping the `vercel.app`
   entry. The login redirects to `window.location.origin`
   (`pages/HomePage.tsx`), so a missing entry sends users to the Site URL
   instead of back to the app. OAuth providers (Google, Discord, GitHub) need no
   change: their callback is Supabase's, not ours.
5. Order: 3 and 4 before 2, so the first visit on the new domain already works.

## 11. Open questions for the product owner

1. **Domain**: answered, `exlibris.world` on Hostinger (2026-10-08).
2. **Render plan today**: Free (with the keep-alive cron) or paid? It decides
   whether the VPS saves money or mainly buys RAM and no cold starts.
3. **Provider**: answered, OVHcloud VPS-1, 2 vCores / 4 GB (2026-10-08).
4. **Who can SSH**: only the product owner, or should CI be the only way
   anything changes on the server (no manual edits)?
5. **Deploy files in the repo**: answered, `deploy/` and
   `.github/workflows/deploy-prod.yml` (2026-10-08).

# Production backend: Render → VPS migration plan

Written 2026-10-07 at the product owner's request. **Status: proposal, nothing
done yet.** Scope: only the **production backend** moves. Staging stays on
Render, the database (and Auth and Storage) stays on Supabase, the frontend
stays on Vercel. This document is a plan, not a record of the live setup;
`architecture.md` → Environments stays the source of truth until the cutover
happens, and is updated then.

## 1. Where we are today

| | Production | Staging |
|---|---|---|
| Backend | Render Docker web service `exlibri-prod-docker.onrender.com` (created 2026-10-05; the old native service is retired once the switch is checked, see `architecture.md` → Environments) | Render Docker web service `ttrpg-campaign-notes-2.onrender.com` |
| Deploys | Render auto-deploys on push to `main` | Render deploys `staging` once CI passes |
| Frontend → backend | `VITE_API_BASE_URL` on Vercel points at the `*.onrender.com` URL, **no custom domain** | same, Preview variable scoped to `staging` |
| Settings | Render dashboard env vars (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `STORAGE_BUCKET`, `CORS_ORIGINS`, `CORS_ORIGIN_REGEX`) | same, pointing at the staging Supabase project |
| Uptime | An external cron/monitor pings `/health` (GET and HEAD, PR #88) to keep the instance awake and alert when it is down | none (left to sleep) |

What the backend needs at run time, all already in the image
(`backend/Dockerfile`): Python 3.12, Pango and friends for WeasyPrint, one
port (`$PORT`, default 10000), outbound HTTPS to Supabase (Postgres through the
**Session Pooler**, which is IPv4-reachable, plus the Storage and Auth APIs).
It stores **nothing on local disk** that must survive: PDFs go to Supabase
Storage, so the VPS holds no data to back up except its own configuration.

Two run-time properties that matter for this plan:

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
| Netcup / OVH / Scaleway entry VPS | ~€3–7 | 1–2 vCPU / 2–4 GB | EU, similar class |
| DigitalOcean / Linode basic droplet | ~$6–12 | 1 vCPU / 1–2 GB | Pricier per GB, simpler UI |
| Backups add-on (Hetzner: +20% of the server) | ~€1 | | Optional, the server holds no data (§7) |

**Reading it**: against Render **Free** the VPS costs a few euros a month more
and buys an always-on instance with 8× the RAM and no cold starts. Against the
Render tier that would actually fit the PDF (Standard, $25), the VPS is about
5× cheaper. The real cost is the product owner's time: OS updates, TLS, deploys
and monitoring become ours (§4–§8), about an hour or two to set up and a few
minutes a month after that if unattended upgrades are on.

**Recommendation**: a Hetzner cost-optimized x86 instance (2 vCPU / 4 GB) in an
EU location (Falkenstein, Nuremberg or Helsinki) close to the Supabase region;
fall back to a regular-performance or ARM instance if cost-optimized isn't
available. x86 keeps the image identical to CI and staging.

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
- **Users and SSH**: a non-root `deploy` user in the `docker` group;
  `PermitRootLogin no`, `PasswordAuthentication no` in `sshd_config`.
- **Firewall**: Hetzner Cloud Firewall (outside the machine) *and* `ufw`
  inside: allow 22 (ideally only from the product owner's IP, or keep 22 open
  with key-only auth and `fail2ban`), 80 and 443; deny everything else. The
  backend's port 10000 is **never** exposed: only the reverse proxy reaches it
  over the Docker network. Note Docker bypasses `ufw` for published ports, so
  the backend container must not use `ports:` at all.
- **Updates**: `unattended-upgrades` for security updates with automatic
  reboot at a quiet hour (e.g. 04:00); the containers restart on boot
  (`restart: unless-stopped`).
- **Docker**: Docker Engine + Compose plugin from Docker's apt repository.
  Log rotation in `/etc/docker/daemon.json`
  (`"log-driver": "json-file", "log-opts": {"max-size": "10m", "max-file": "5"}`)
  so logs can't fill the disk.
- **Reverse proxy with HTTPS**: **Caddy** (automatic Let's Encrypt
  certificates and renewal, a five-line config) in front of the backend:

  ```caddyfile
  api.<domain> {
      encode gzip
      reverse_proxy backend:10000
  }
  ```

  Traefik works too but needs more configuration for one service. The
  certificate is issued when DNS points at the VPS; for the parallel run (§9),
  where DNS still points at Render, use a second name (`api-vps.<domain>`) so
  Caddy can get a certificate and the VPS can be tested end to end. Keep that
  name in the Caddyfile (`api.<domain>, api-vps.<domain> { … }`) and in DNS for
  good: the deploy's health gate uses it (§5).
- **Request size and timeouts**: Caddy sets no request-body limit by default,
  so uploads behave as on Render, and long Room PDF renders run as background
  jobs, so no special timeout is needed.

`/opt/exlibri/compose.yaml` (on the server, not in the repo, or in the repo
under `deploy/` once the plan is approved):

```yaml
services:
  backend:
    image: ghcr.io/sdrogo/ttrpg-campaign-notes-backend:${BACKEND_TAG}
    env_file: /opt/exlibri/backend.env   # chmod 600, owned by deploy
    environment:
      PORT: "10000"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:10000/health')"]
      interval: 30s
      timeout: 5s
      retries: 3
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    restart: unless-stopped
volumes:
  caddy_data:
```

`caddy_data` holds the certificates; losing it only means Caddy asks for new
ones.

## 5. Deploy pipeline

Keep the existing flow: feature PRs → `staging` (Render staging deploys after
CI) → release PR `staging` → `main`. Only what happens on `main` changes.

1. **Registry**: GitHub Container Registry (`ghcr.io`), free for this use and
   authenticated with the workflow's own `GITHUB_TOKEN` (`packages: write`).
   Keep the package private; the VPS pulls with a read-only token.
2. **Build once, in CI**: a new `deploy-prod` workflow on push to `main`,
   which waits for the CI jobs (or runs as `workflow_run` after `CI`
   succeeds on `main`). It builds `backend/Dockerfile` exactly like the
   `Backend image` job, tags it with the commit SHA (and `prod`), and pushes it.
   The image is the one CI already smoke-tested in shape; the tag is the commit,
   so any deployed version is traceable and re-deployable.
3. **Deploy**: the same workflow SSHes into the VPS (a dedicated deploy key,
   restricted to the `deploy` user) and runs
   `BACKEND_TAG=<sha> docker compose pull backend && docker compose up -d backend`,
   then, over the same SSH session, waits until the new container reports
   `healthy` (`docker compose ps backend`, driven by the healthcheck in §4) and
   `curl -fsS https://api-vps.<domain>/health` returns 200 (fail the workflow,
   and alert, if not within ~60 s). The gate must **not** poll
   `api.<domain>`: before the cutover and after a DNS rollback that name points
   at Render, so it would pass while the VPS is broken. `api-vps.<domain>`
   keeps pointing at the VPS permanently for this reason. The previous SHA is
   written to a file on the server so a rollback is one command
   (`BACKEND_TAG=<previous> docker compose up -d backend`), or a manual re-run
   of the workflow on an older commit.
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
  `STORAGE_BUCKET`, `CORS_ORIGINS`, `CORS_ORIGIN_REGEX`) live in
  `/opt/exlibri/backend.env` on the VPS, `chmod 600`, owner `deploy`, copied
  once by hand from the Render production dashboard. They are **never** in the
  repo, in the image (`.dockerignore` already keeps `.env*` out, and CI checks
  it) or in GitHub secrets. Keep a copy in the product owner's password manager:
  it is the only thing needed to rebuild the server.
- **GitHub Actions secrets** (repository → Environments → `production`, with
  `main` as the only allowed branch): `VPS_HOST`, `VPS_SSH_KEY` (the deploy
  key's private half), `VPS_KNOWN_HOSTS` (pin the host key, no
  `StrictHostKeyChecking=no`). No Supabase secret is needed in GitHub.
- **Registry pull credential on the VPS**: a fine-grained / classic token with
  only `read:packages`, stored by `docker login ghcr.io` for the `deploy` user.
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
  deploy workflow. Hetzner's server backups (+20%) or a snapshot after setup
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
- **Resources**: a disk and memory alert (Hetzner's console graphs, or a tiny
  agent like Netdata / Beszel) so a full disk or a PDF memory spike is noticed.
- **Deploy failures**: the deploy workflow fails visibly in GitHub Actions
  (and emails the repo owner) when `/health` doesn't come back.

## 9. Cutover plan

Both run in parallel; the switch is DNS; rollback is DNS.

1. **Domain on Render first** (§3): `api.<domain>` → Render production,
   Vercel production uses it, TTL lowered to 300 s. Live for a few days with no
   other change, so any problem here is not confused with the VPS.
2. **Build the VPS** (§4) with a second name, `api-vps.<domain>` → VPS. Copy
   the production env vars. Deploy the image currently on `main` (workflow run
   by hand, §5).
3. **Test the VPS in isolation**: `curl https://api-vps.<domain>/health`;
   then a Vercel **Preview** deploy with `VITE_API_BASE_URL=https://api-vps.<domain>`
   (its origin already matches `CORS_ORIGIN_REGEX`): sign in, open a Room,
   edit a Document, upload an image, run search, generate a Room PDF and
   download it. It is the real production database, so test in a throwaway
   Room. Remember a VPS start fails any Room PDF in flight on Render (§1); do
   it at a quiet time.
4. **Switch**: change `api.<domain>` to the VPS's IP, and add `api.<domain>`
   to the Caddyfile (Caddy gets the certificate as soon as DNS resolves to it;
   for a certificate ready before the switch, use Caddy's DNS-01 challenge with
   the DNS provider's API token). Watch the monitor, the backend logs and a
   real sign-in for an hour.
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

**Rollback**, at any point before step 7: set `api.<domain>` back to Render
(minutes, with the low TTL). Render must still be on the same code version as
the VPS, which step 5 guarantees. After step 7 the rollback is "un-suspend the
Render service, then switch DNS". A rollback never touches the database, since
both backends use the same one and migrations are applied separately.

## 10. Open questions for the product owner

1. **Domain**: is there one already (Ex Libris)? Which DNS provider?
2. **Render plan today**: Free (with the keep-alive cron) or paid? It decides
   whether the VPS saves money or mainly buys RAM and no cold starts.
3. **Provider**: Hetzner x86 cost-optimized as recommended, or another?
4. **Who can SSH**: only the product owner, or should CI be the only way
   anything changes on the server (no manual edits)?
5. **Deploy files in the repo**: add `deploy/compose.yaml`, `deploy/Caddyfile`
   and the deploy workflow in a follow-up PR once this plan is approved?

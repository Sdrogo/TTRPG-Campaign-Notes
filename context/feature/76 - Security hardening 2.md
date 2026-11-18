# 76 - Security hardening 2

Status: **ticket, to confirm** (2026-11-18). Docs only; no code yet.

## Goals

- Product owner's request (2026-11-18): after the security overview
  ("Ex Libris: panoramica sicurezza", Claude Doc of 2026-11-18), build its
  three most useful fixes in one ticket.
- G1. **Pinned builds**: what runs in production is exactly what was
  reviewed and audited. Today the image and CI resolve dependencies at build
  time, so any new release of any library reaches production unreviewed.
- G2. **Caddy access log**: a trail of what reached the servers (site, API,
  files host), for incidents, without storing full client IPs or secrets.
- G3. **Backups production can't delete**: a compromised production server
  (or deploy key) must not be able to wipe the backup history.

## What the overview found (2026-11-18)

- `backend/Dockerfile:35` runs `pip install .`; `backend/pyproject.toml`
  only sets floors (`fastapi>=0.115`, ...). `backend/uv.lock` (72 packages,
  with hashes) is used nowhere: CI installs `pip install -e ".[dev]"`
  (`ci.yml`, Backend and Coverage jobs), and the "Backend dependency audit"
  audits a fresh `pip install .`, not what the image holds.
- Base images by tag only: `python:3.12-slim-bookworm` (Dockerfile) and
  `caddy:2` (`deploy/compose.yaml`). Postgres is pinned by digest; every
  GitHub Action is pinned by SHA. No `.github/dependabot.yml`: Dependabot
  only opens security PRs, never routine bumps of the pins.
- `deploy/Caddyfile` has no `log` directive (ticket 75 chose "no Caddy
  access log" so that no client IP is stored; the backend's own line covers
  API requests only).
- `deploy/backup-target-setup.sh` gives production's key `--read --write`
  on `exlibris-backups` on staging, and `deploy/backup.sh` prunes it from
  production (`rclone purge`). Garage has no object lock and its `write`
  permission includes delete, so production can erase every backup.

## Decisions (proposed defaults, to confirm)

### Pinned builds (G1)

1. **The image installs from the lock.** A build stage exports
   `uv.lock` to a hashed requirements file
   (`uv export --frozen --no-dev --no-emit-project`), and the image runs
   `pip install --require-hashes -r requirements.txt`, then
   `pip install --no-deps .` for our own package. `uv` comes from its
   official image, pinned by digest, in the build stage only: the final
   image is unchanged (no uv inside).
2. **CI installs from the lock too**: the same export with `--extra dev`,
   installed with `--require-hashes`. A new step `uv lock --check` fails
   the PR when `pyproject.toml` and `uv.lock` disagree, so a dependency
   change always comes with its lock.
3. **The audit checks what ships**: `pip-audit -r` on the exported runtime
   requirements (`--no-deps`, hashes kept), instead of a fresh install.
4. **Base images by digest**: `python:3.12-slim-bookworm@sha256:...` and
   `caddy:2.<x.y>@sha256:...` (the digest of today's tag). The other
   compose images keep their exact versions (`garage v2.5.0`, `rclone
   1.71.0`, ...) and also get digests.
5. **`.github/dependabot.yml`**, weekly, PRs into `staging`
   (`target-branch`), one grouped PR per ecosystem: `uv` (`/backend`),
   `npm` (`/frontend`), `docker` (`/backend`), `docker-compose`
   (`/deploy`), `github-actions` (`/`). Security alerts keep their own
   immediate PRs, as today.
6. Local development is unchanged (`uv sync`, or `pip install -e ".[dev]"`
   still works). Adding a dependency now means `uv add` / `uv lock` and
   committing `uv.lock` (`code-standards.md` gets one line).

### Caddy access log (G2)

7. **One JSON access log per site** (frontend, API, files) to stdout, so
   Dozzle shows it and Docker's rotation (20 MB x 10) bounds it, as for
   every container. No log file on disk.
8. **No full IPs**: `ip_mask` keeps `/24` for IPv4 and `/48` for IPv6
   (enough to see a scanner's network, not a person). No `Authorization`
   or `Cookie` header is logged (Caddy already redacts both by default;
   kept explicit).
9. **No secrets in URLs**: on the files host the signed-link query
   (`X-Amz-Signature`, `X-Amz-Credential`, ...) is deleted; on the API the
   OAuth callback's `code` and `state` are deleted and the invitation and
   friend codes in paths are replaced with `***`.
10. **Health checks skipped** (`/health`, `/health/ready`,
    `/health/backup`), as the backend already does, so the uptime
    monitors don't bury the rest.
11. **Privacy notice**: one sentence in the 12 languages (server logs with
    truncated IP addresses, kept a few weeks). `context/architecture.md`
    → Monitoring (ticket 75) gets a "Caddy access log" bullet with these
    rules, and ticket 75's "No Caddy access log" (its "As built" and
    "Where we are" sections) is marked as superseded by this ticket.

### Backups production can't delete (G3)

12. **Two buckets on staging.** Production keeps pushing its nightly,
    encrypted backup to `exlibris-backups` as today (its key needs
    `write`, which in Garage includes delete). A new nightly job **on
    staging**, `backup-vault.sh`, then copies each new day into a second
    bucket, `exlibris-backups-vault`, with a staging-only key that can
    read the first bucket and write the second. Production has no key for
    the vault.
13. **Retention moves to the vault**: the vault keeps today's rule (7
    days, 4 Sundays, 6 first-of-month). Production prunes its own bucket
    to the **3 newest days**, enough for `--copy-dest` (unchanged files are
    copied inside the server, not over the network).
14. **Still encrypted, staging never holds the password**: the vault job
    copies the encrypted objects as they are (plain `rclone copy` between
    the two buckets, server side), so a compromised staging can delete the
    vault but not read it. Losing everything now needs both servers.
15. **Restore reads the vault**: `backup.sh check|fetch|restore-files`
    gain a way to read from `exlibris-backups-vault` (a second
    `backup.env`-style file with a read-only vault key, made by
    `backup-target-setup.sh vault-reader`), and `restore-runbook.md` says
    which to use. The plain bucket keeps working for the newest 3 days.
16. **Monitored**: `backup-vault.sh` writes `status/backup-last-ok` on
    staging, and staging's backend sets `BACKUP_STATUS_FILE`, so
    `https://api-staging.exlibris.world/health/backup` reports the vault's age; one
    more Uptime Kuma monitor ("Backup vault"), same 26 h threshold.
17. **Rollout order**: deploy the scripts, run `backup-target-setup.sh
    vault` on staging, run `backup-vault.sh` once by hand (it copies every
    day already there), install its cron at 05:00 server time (after
    production's 03:30 run), check the monitor is green, and only then
    turn on the 3-day prune on production (`BACKUP_KEEP_DAYS=3` in
    `backup.env`; unset keeps today's rule, so nothing is lost if the
    order slips).

## Units

| Unit | What | Estimate (Claude) | Product owner |
| --- | --- | --- | --- |
| 76_1 | Pinned builds: Dockerfile, CI, audit, digests, `dependabot.yml`, docs | ~40 min | Merge; check the first Dependabot PRs |
| 76_2 | Caddy access log with filters, privacy notice line (12 languages), docs | ~30 min | Glance at Dozzle after the deploy |
| 76_3 | Backup vault: `backup-vault.sh`, setup script changes, prune setting, restore, runbook, monitor | ~1 h | ~20 min on the servers (guide in `/mnt/project-files/vps/`) |

One PR into `staging` for all three, no migration, no app code change
outside the Dockerfile.

## Tests

- 76_1: CI green with the lock install; `uv lock --check` fails on a
  hand-made mismatch (checked once, not committed); the image builds and
  `pip list` inside it matches `uv.lock`; the deploy's outside health check
  passes on staging.
- 76_2: `caddy validate` (already in CI) on the new Caddyfile; on staging,
  a request to each host shows one JSON line in Dozzle, with a masked IP,
  no `X-Amz-Signature`, no `code=` on a sign-in callback, no line for
  `/health`.
- 76_3: `bash -n` / `shellcheck` on the scripts (as for the existing
  ones); on staging, `backup-vault.sh` copies the existing days and a second
  run copies nothing; production's key gets `403` on the vault bucket
  (checked by hand with rclone); `backup.sh check` restores from the vault;
  the new monitor is green.

## Risks

- Two Garage behaviours this design relies on are taken from its
  documentation, not yet tried here: a bucket's `write` permission also
  allows deleting, and a server-side copy works from one bucket to another
  with a key that can read the first and write the second. 76_3 checks both
  on staging first; if the copy is refused, the vault job copies through
  rclone without server-side copy (same result, more traffic inside the
  server).

- A lock installed with hashes fails on a package with no wheel for the
  image's platform: CI builds the image, so it shows up before deploy.
- Dependabot PRs add review work: grouped, weekly, so at most ~5 PRs a week.
- Vault size: one full copy of the files per kept day (today ~100 MB a
  day). Garage stores identical blocks once, so the real growth is smaller;
  Beszel's 80% disk alert covers the rest.
- If the vault job stops, production still keeps 3 days and the monitor
  alerts within 26 h.

## Questions for the product owner

1. Keep `/24` (IPv4) and `/48` (IPv6) as the masks, or drop IPs from the
   log entirely? Default: mask.
2. Vault retention as today (7 days, 4 Sundays, 6 months)? Default: yes.
3. Dependabot PRs every week, or monthly? Default: weekly.

## Out of scope

- GitHub Team / enforced branch rules (product owner, 2026-11-18: out of
  scope for now).
- An off-site third copy (e.g. a weekly download to the product owner's
  computer): possible later on top of the vault.
- Per-user storage quota, shorter signed links, a data breach procedure:
  other points of the overview, later.

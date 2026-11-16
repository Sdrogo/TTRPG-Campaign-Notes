# 73 - Leave Vercel and Supabase

Status: **plan, to confirm**. No code until the product owner answers the
questions at the end (rule: ticket and docs first).

## Goals

- Product owner's request (2026-11-15): "è da un po' che sto pensando a poter
  migrare via sia da Vercel che da Supabase. Non mi piace affatto l'idea di
  essere dipendente da una subscription e non credo che entrambi scalino come
  serve a noi (in particolare Supabase mi sembra molto costoso)". Then: "potremmo
  pensare anche di migrare ad un diverso servizio per l'accesso? Oppure
  scrivendolo noi a mano su BE, possiamo migrare tutti gli utenti esistenti in
  modo automatico?"
- End state: the whole production stack (frontend, API, database, sign-in,
  files) runs on hardware the product owner rents by the year (the OVHcloud
  VPS) plus, at most, pay-per-use object storage behind the standard S3 API.
  No platform subscription, nothing that pauses or caps the app when it grows.
- Every existing user keeps their account, Rooms and files without doing
  anything except signing in once more.
- `requirements.md` is not touched. Nothing user-visible changes except the
  one-time sign-in.

## Where we are (checked 2026-11-15)

| Piece | Today | Plan / cost today |
|---|---|---|
| Frontend | Vercel, `exlibris.world` (+ `www`), Preview per branch for staging | **Hobby**, €0. Hobby is for non-commercial use and has **no DPA** (spec 31) |
| API | OVH VPS-1 (2 vCore, 4 GB, 40 GB NVMe, Erith UK), Docker + Caddy | ~€45.72 + VAT a year, daily VPS backup included |
| Database | Supabase Postgres 17.6, Frankfurt, via the Session Pooler (15 clients) | **Free** org plan, 2 projects (prod + staging) |
| Sign-in | Supabase Auth, OAuth only (Google, Discord, GitHub), ES256 JWT checked by the backend against Supabase's JWKS | same |
| Files | Supabase Storage, private bucket `document-images`, backend-only REST, signed links | same |
| Staging API | Render free Docker service (sleeps when idle) | €0 |

Production size today: **46 MB** database, **21 users** (identities: 17
Google, 4 Discord, 2 GitHub; 2 users have two providers linked; every user has
an email), **698 files / 98 MB** in Storage. Realtime is not used. No Room
content stores a Supabase URL (checked: Document, version, Note, Thread and
Section texts), only object paths, so files can move without rewriting
content.

What the Free plan means today, beyond cost: no downloadable daily backups,
500 MB database and 1 GB Storage caps, 50 MB per-object cap (the Room PDF
already has to squeeze under it, spec 23b), and a project that sees no
traffic for a week is paused. The next step up is Supabase Pro (US$25 a month
per org, plus compute) and Vercel Pro (US$20 a month per member), so about
€45 a month to stay on both once the app outgrows the free tiers or needs the
Vercel DPA.

### Where the code touches each service

- **Supabase Auth**: `frontend/src/lib/supabaseClient.ts`, `hooks/useSession.ts`
  (session, refresh), `components/SignInButtons.tsx` (`signInWithOAuth`),
  `hooks/useAccount.ts` (`signOut`), `lib/authProviders.ts`, `lib/apiClient.ts`
  (Bearer token, also for the live streams, which use `fetch`);
  `backend/app/auth/jwt.py` (JWKS, issuer, audience `authenticated`),
  `backend/app/auth/dependencies.py` (`sub`, `email`, `user_metadata` for the
  first profile), `backend/app/db/auth_admin.py` (account deletion).
- **Supabase Storage**: only `backend/app/db/storage.py` (upload, remove,
  download, signed links, `own_object_path` for the import's own links).
- **Supabase Postgres**: `DATABASE_URL` only; plain SQLAlchemy + Alembic. The
  Supabase-only bits are the `anon`/`authenticated` lockdown migrations and the
  old `auth.users` references the CI shim recreates.
- **Vercel**: `vercel.json` (SPA rewrite, CSP and security headers), the
  `VITE_*` variables set in its dashboard, Preview deploys for staging.

## The pieces

### 1. Frontend: Caddy on the VPS (recommended)

The SPA is static files. Caddy, already on the VPS, serves `frontend/dist` for
`exlibris.world` and `www.exlibris.world` with the SPA fallback
(`try_files {path} /index.html`), long cache for `/assets/*` (hashed names),
no cache for `index.html`, and the headers now in `vercel.json` (CSP, nosniff,
DENY, Referrer, Permissions), moved into the Caddyfile. `deploy-prod.yml`
builds the frontend with the production `VITE_*` values (GitHub environment
variables, none secret) and copies `dist/` next to the compose file, swapping
it atomically (new folder, then rename) so a visitor never gets half a build.

Loses: Vercel's CDN (the bundle is ~315 kB entry, gzip/zstd from Caddy, fine
for a European audience), and **per-branch Preview URLs** (staging becomes one
fixed URL, see 5). The DPA gap disappears: OVH is the only host.

### 2. Database: Postgres 17 in Docker on the VPS (recommended)

`postgres:17.6` (production's version, the same image CI pins) as a compose
service on the internal network, no published port, data in a named volume.
The backend connects as an app role that owns the tables (not a superuser);
the 15-client pooler limit goes away (keep the 5 + 2 pool, it is enough).
Moving the database to the box the API runs on also removes ~15 ms of round
trip per query (Erith ↔ Frankfurt today).

It goes on the new production VPS (Strasbourg, 5).

Rejected: a managed Postgres (OVH Public Cloud, Neon, others): a subscription
again, and €15+ a month for less than this box gives.

**Backups become entirely ours** (an unmanaged VPS: the host does not back up its data; OVH general conditions §6), so they ship
with this step, not after it:

- nightly `pg_dump -Fc` from a small cron container, encrypted (`age`) and
  copied off the VPS to the staging VPS in another datacenter (5) and to the
  object storage of 3, kept 7 daily, 4 weekly, 6 monthly;
- the files themselves live in the object storage, which keeps its own copies;
  a weekly sync of the bucket into a second bucket/region covers deletion by
  mistake;
- OVH's included daily VPS backup stays on as a second, coarse layer;
- a restore runbook in `context/`, tried once on staging before the cutover,
  then every few months; the `/health` cron also checks the dump's age (a
  `/health/backup` reading the last success time, or the backup job pinging a
  dead-man's-switch monitor).

### 3. Files: S3-compatible object storage (recommended)

`storage.py` keeps its functions (upload, remove, download, signed links) and
speaks the S3 API instead (presigned GET links replace Supabase's signed
links; same short lifetime, same cache). Recommended provider: **OVHcloud
Object Storage** (S3 API, pay per GB, same contract and DPA as the VPS, EU
regions). Any S3 provider (Scaleway, Backblaze B2, Cloudflare R2, Hetzner)
works with the same code and only different settings, so there is no lock-in.

Alternative: files on the VPS disk, served by the backend with HMAC-signed
links. Zero extra cost, but the 40 GB disk then holds database, files and
nothing to back them up to, and a lost VPS loses the files. Not recommended.

The per-object cap becomes ours to set, so the Room PDF no longer needs to fit
50 MB (spec 23b's `MAX_EXPORT_BYTES` can be raised later, not in this ticket).
`own_object_path` learns the new link shape and keeps accepting the old
Supabase one, so an export made before the move still imports its images
(they are re-fetched only while the old link is valid; afterwards the import
reports them as missing, as it does for any expired link today).

### 4. Sign-in: compared, with automatic user migration

**Can existing users move automatically? Yes, with every option below.**
Sign-in is OAuth only, so there are no passwords to carry over. What
identifies a person is the pair (provider, provider's user id), which
Supabase keeps in `auth.identities` (`provider`, `provider_id`, `user_id`),
and our `users.id` is already that same `user_id`. Copying those 23 rows
into the new system, keyed to the same user ids, is all the migration needs:
the next time someone signs in with Google, Discord or GitHub, the provider
returns the same id, it maps to the same user, and every Room, membership and
file is there. The only thing a user notices is being signed out once.

| | A. Our own, in the FastAPI backend | B. Supabase Auth self-hosted (GoTrue) | C. Self-hosted identity server (Keycloak, Authentik, Zitadel) | D. Another managed service (Auth0, Clerk, WorkOS, Firebase) |
|---|---|---|---|---|
| Subscription | none | none | none | yes (free tier, then per user) |
| New moving parts | none (a library, Authlib) | one container, Supabase's `auth` schema and roles | one or two containers (+ Redis for Authentik) | an external US service |
| RAM on a 4 GB VPS | 0 | ~50 MB | 300 MB to 1 GB+ | 0 |
| User migration | copy `auth.identities` (SQL) | copy the `auth` schema as is (pg_dump); sessions even survive | import via its admin API, per user | bulk import API |
| Frontend change | replace supabase-js with ~100 lines | none (supabase-js keeps working) | OIDC client | its SDK |
| Who owns the security | us (standard OAuth code flow with PKCE, a mature library) | Supabase's code, but we run and upgrade it | the project | the vendor |
| Main risk | it is our code; needs careful review and tests | run standalone it is thinly documented and tied to Supabase's schema migrations | heavy for 21 users, a whole admin console to run | the dependency we are trying to leave |

**Recommendation: A.** For three OAuth providers and no passwords, the
backend needs three things it can do with Authlib: the OAuth code flow
(with `state` and PKCE) for each provider, a table that maps provider
identities to users, and its own short tokens. It removes a component rather
than adding one, and it fixes the open PKCE item from spec 72 (tokens in the
URL fragment) as a side effect. B is the fallback if the product owner
prefers zero frontend change over zero extra component.

How A would work (details go to the build units):

- **Routes**: `GET /auth/{provider}/start?return_to=` → redirect to the
  provider; `GET /auth/{provider}/callback` → verify `state` + PKCE, read the
  provider's user id, email (and whether it is verified), name and avatar,
  find or create the user, set the session cookie, redirect back to the SPA;
  `POST /auth/refresh` → new access token; `POST /auth/logout`.
- **Tokens**: an access token (ES256 JWT, 15 minutes, `sub` = user id, signed
  with a key in `backend.env`, kept in memory by the SPA, sent as `Bearer`
  exactly as today, so every route and `get_current_user` stay as they are) and
  a refresh token (random, stored hashed in `auth_sessions`, rotated on each use,
  30 days, in an `HttpOnly; Secure; SameSite=Lax` cookie on the API host).
  `exlibris.world` and `api.exlibris.world` are the same site, so the cookie
  works without third-party-cookie problems.
- **Tables** (one migration): `auth_identities` (provider, provider_user_id,
  user_id, email, created_at; unique on provider + provider_user_id) and
  `auth_sessions` (hashed refresh token, user_id, expiry, user agent, revoked).
  The same migration copies Supabase's `auth.identities` into
  `auth_identities` when that schema exists (it does on both Supabase
  databases; CI's shim gains an empty `auth.identities`). Both tables go into
  `erase_personal_rows` and the export (spec 31).
- **Account linking**: Supabase links a new provider to an existing account
  when the verified email matches. Proposed: keep that behaviour (only when the
  provider says the email is verified), so nobody gets a duplicate account by
  signing in with a different button.
- **First profile**: name and picture come from the provider profile, like
  `user_metadata` today.
- **Account deletion**: deletes the identities and sessions rows instead of
  calling Supabase's admin API (`auth_admin.py` goes away).
- **Frontend**: a small `lib/auth.ts` replaces supabase-js: sign-in is a
  link to `/auth/{provider}/start`, the session is "call `/auth/refresh` at
  start and before expiry", `apiClient` retries once after a 401 with a fresh
  token, sign-out calls `/auth/logout`. `@supabase/supabase-js` leaves the
  bundle.
- **Product owner's part**: in the Google, Discord and GitHub developer
  consoles, add the new redirect URIs
  (`https://api.exlibris.world/auth/{provider}/callback`, and the staging ones)
  and put the client ids/secrets in `backend.env`. Today these apps point at
  Supabase's callback; the old URI stays until the cutover is done.
- Rate limit on `/auth/*` (spec 72 style) and the security checklist of spec
  72 rerun on the new routes.

### 5. Two VPS: the current one becomes staging, a bigger one runs production

The product owner's choice (2026-11-15): "usare la macchina 1 più leggera per
staging e la macchina 2 più pompata per PROD". OVH's current range, as shared:
VPS-1 2 vCore / 4 GB / 40 GB €4.49 a month (the one in use), VPS-2 4 / 8 / 75
€7.21, VPS-3 6 / 12 / 100 €10.40, VPS-4 8 / 24 / 200 €19.96 (prices "from").

- **Production: OVH VPS-2 "2027", Strasbourg (SBG, France)** (4 vCore, 8 GB,
  75 GB NVMe, automatic daily VPS backup "Standard", Debian 13), ordered by
  the product owner on 2026-11-16 (host `vps-ff31641c.vps.ovh.net`). It runs
  frontend, API and Postgres, with Docker from Docker's own repository.
  History (2026-11-15/16): an OVH VPS-3 was the first choice (a large increase
  in users is expected once public), but OVH had no VPS in stock in any
  region; Hetzner was too expensive (CPX32 4/8 at €30.49); Leaseweb serves
  businesses only; then a VPS-2 freed up. Same provider, contract and DPA as
  the current VPS; data stays in the EU. VPS-3 later is an in-place upgrade
  when OVH has stock. The panel shows **manual renewal**: switch it to
  automatic so production cannot lapse.
- **What limits growth before the hardware does**: the backend runs one
  uvicorn process, and three things assume it (the rate limits of spec 72,
  the image search throttle, the Room PDF semaphore and its startup sweeper,
  the live-stream fan-out of specs 46_2/52). With 6 vCores the API should run
  several workers, which means moving those counters and the event fan-out
  into Postgres (or a small Redis). That is a separate ticket, to do before or
  soon after going public; this migration only makes it possible. Postgres
  gets settings sized for the box (e.g. `shared_buffers` ~2–3 GB), with the
  backend's pool raised to match the workers.
- **Staging: the current VPS-1** (Erith), once production has left it:
  frontend, backend, Postgres and its own bucket, deployed on every green push
  to `staging` as `staging.exlibris.world` and `api-staging.exlibris.world`.
  A runaway staging job can no longer touch production.
- **Off-site backups**: being in another datacenter (same provider, so the object storage copy stays required too), the staging VPS also
  receives an encrypted copy of production's nightly dump (pulled over SSH),
  besides the object storage copy; it is where a restore is rehearsed and,
  if production dies, the box that can be promoted (runbook in step 5 of the order of work).
- The production move to the new VPS is the same zero-downtime switch done on
  2026-10-08 (new box serves the same image, DNS switch, old box kept for
  rollback), so it costs no extra downtime; it happens before the database
  moves, so Postgres lands directly on its final box.

Render, the Supabase staging project and the Vercel Preview all go away.

## Order of work

Each step is shippable on its own and, from step 2 on, is tried on staging first. Production
keeps running between steps.

| # | Step | Claude build time | Downtime in production | Product owner's part |
|---|---|---|---|---|
| 1 | New production VPS (OVH VPS-2, Strasbourg): same setup as today's (Docker, Caddy, deploy workflow pointed at it), plus the frontend served by Caddy (`vercel.json` headers move to the Caddyfile); API and frontend switched to it | ~1.5 h | none (DNS switch, TTL 300; old box and Vercel keep serving meanwhile) | order and harden the new VPS (same steps as 2026-10-08), GitHub secrets, DNS switch; delete the Vercel project after a quiet week |
| 2 | Current VPS-1 turned into staging (frontend, backend, Postgres, deploy on `staging`); still using the staging Supabase Auth and Storage | ~1 h | none | DNS records for the two staging names; staging `backend.env`; then Render staging can go |
| 3 | Sign-in in the backend (option A) | ~3–4 h incl. tests | none; every user is signed out once | OAuth consoles: new redirect URIs, client secrets in both `backend.env`; run the migration on staging, then prod |
| 4 | Files to object storage, plus the copy script (lists Supabase objects, copies each, checks size; safe to re-run, only copies what is missing) | ~1.5 h | none: copy, deploy, copy again for anything uploaded meanwhile | create the buckets and keys at OVH |
| 5 | Database to the VPS, plus nightly encrypted off-site backups and the restore runbook | ~1.5 h | **~15–30 min** maintenance (API answers 503 while `pg_dump` / `pg_restore` of ~46 MB runs) | run the dump/restore at a quiet hour with the runbook |
| 6 | Clean-up: remove Supabase settings and code paths, the CI shim's Supabase roles where no migration needs them, docs (`architecture.md`, privacy notice: processors and data location), tracker | ~1 h | none | delete the Supabase projects and Render service after ~4 weeks, keeping a final dump |

Total: about **9–10 hours of Claude build time**, spread over several
sessions because each step waits for staging checks and the product owner's
manual steps. Steps 3 and 4 can swap; step 5 goes last so that, until then,
rolling back any step is just reverting a deploy.

**Rollback per step**: 1, DNS back to the current VPS (API) and Vercel
(frontend), both left running until the switch has held for a week; 2,
nothing to roll back in production (staging only); 3, redeploy the previous image
and frontend (Supabase Auth is untouched until step 6); 4, settings back to
Supabase Storage (objects are copied, never moved, until step 6); 5, point
`DATABASE_URL` back at Supabase, losing only what was written since the move,
so the decision to stay is taken within the maintenance window after a smoke
test.

## Costs after the move

| Item | Monthly |
|---|---|
| OVH VPS-2 Strasbourg, production | €7.21 |
| VPS-1, staging (already paid) | €4.49 |
| Object storage, OVH Multi Zone Standard (files) + Infrequent Access (backups): ~€0.014 / ~€0.0095 per GiB a month, traffic and API requests free (OVH price list, checked 2026-11-16) | a few cents today; ~€0.70 at 50 GB |
| **Total** | **~€12**, against ~€45 to stay on Vercel Pro + Supabase Pro |

The VPS is the next ceiling: at some point (hundreds of active users, large
Room PDFs) VPS-3 or VPS-4 is an in-place upgrade away, not a migration; several API workers come first (5).

## Risks

- **Backups and restores are ours.** Biggest new responsibility; mitigated
  by step 5 shipping the off-site backup, the age check and a tried restore
  in the same PR as the move.
- **One box for everything.** If the VPS is down, the whole app is down
  (today only the API). OVH's VPS SLA plus a restore runbook that rebuilds on a
  fresh VPS from the off-site backup in under an hour.
- **Our own sign-in code.** Mitigated by a maintained library (Authlib),
  PKCE + `state`, hashed rotating refresh tokens, rate limits, tests for every
  failure path, and a security review before the production switch.
- **OAuth console mistakes** (wrong redirect URI) block sign-in for that
  provider only; the switch is done at a quiet hour with the product owner at
  the consoles, and the old Supabase sign-in stays deployable until step 6.
- **No more Preview per branch.** Only the one staging URL; acceptable since
  PRs already merge into `staging` to be tried.
- **Data location**: with production on an EU VPS, data stays in the EU
  (the API leaves Erith UK). Backup copies on the staging VPS sit in the UK,
  which has an EU adequacy decision. The privacy notice and the GDPR dossier
  list where data lives and who processes it, so both are updated in step 6
  (fewer processors: Supabase and Vercel leave the list).
- **Disk**: production's 75 GB (staging's 40 GB) holds the database and Docker images; files and backups are
  off the disk, so it is not a near-term limit. The `/health` cron can alert on
  free space.

## Questions for the product owner

1. **Sign-in**: A (our own, in the backend), recommended, or B (self-hosted
   Supabase Auth, no frontend change)?
2. **Files**: OVH Object Storage (recommended), another S3 provider, or the VPS
   disk?
3. **Production VPS**: decided and ordered, OVH VPS-2 in Strasbourg, Debian 13 (2026-11-16). (Decided: current VPS-1 becomes
   staging, a bigger one runs production.)
4. **Account linking by verified email** across providers, like Supabase
   does today (recommended), or one account per provider identity?
5. **Everyone signed out once** at the sign-in switch: fine with a short
   notice on the landing page, or no notice?
6. **Backup retention**: 7 daily, 4 weekly, 6 monthly, encrypted, on the
   staging VPS (OVH, Erith) and in the object storage (recommended)? Where should the decryption key be kept besides
   the VPS (it must not live only there)?
7. **Order**: as above (new production VPS with the frontend, staging on the
   current VPS, sign-in, files, database), or the database earlier?
8. **Decommissioning**: delete the Supabase projects, Render and Vercel about
   4 weeks after the last step, keeping a final dump (recommended)?

## Out of scope

- Raising the Room PDF size cap (possible after step 4, separate ticket).
- New sign-in providers or email/password sign-in.
- Multi-server or high-availability setups.
- Several API workers (shared rate limits, live-stream fan-out): separate
  ticket, see 5.
- Any change to `requirements.md`.

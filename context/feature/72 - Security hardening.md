# 72 - Security hardening

## Goals

- Product owner's request (2026-11-14), while assessing how far the app is
  from a 1.0: "quello che mi interessa di più in realtà è [...] la verifica
  degli header di sicurezza ed, in generale, qualsiasi tipo di check di
  sicurezza". Then: "procedi con la stesura di questo ticket Security
  hardening".
- Close the gaps found by the security check of 2026-11-14 (below) before
  calling the app 1.0. The code itself held up; the gaps are in the HTTP
  configuration of the two public hosts and in a few defaults.
- No migration. `requirements.md` is not touched. Nothing changes for users
  except a 413 or 429 when a request is far beyond normal use.

## What the check found (2026-11-14)

How it was checked: a passive external scan of `https://exlibris.world` and
`https://api.exlibris.world/health` (Assurly: loads the public pages and
scripts like a visitor, no login), a read of the code and the deploy files,
`npm audit --omit=dev`, `pip-audit`, and the Supabase security advisor on
the production project.

**Gaps (this ticket)**

| # | Where | Finding |
|---|---|---|
| G1 | Frontend (Vercel) | No `Content-Security-Policy`, no `X-Content-Type-Options`, no `X-Frame-Options` / `frame-ancestors`, no `Referrer-Policy`, no `Permissions-Policy`. `frontend/vercel.json` only holds the SPA rewrite. The Supabase session lives in `localStorage` (supabase-js default), so a CSP is the second line of defence if an XSS ever got through. |
| G2 | API (Caddy) | No `Strict-Transport-Security`, no `X-Content-Type-Options`, no CSP / `frame-ancestors`; Caddy announces itself in `Server`. `deploy/Caddyfile` sets no header. |
| G3 | API (Caddy) | No cap on the request body. The routes cap what they read (`file.read(MAX + 1)`), but Starlette has already parsed the whole multipart body (spooled to disk) by then, so a member can send gigabytes to any upload route. |
| G4 | API | `/docs`, `/redoc` and `/openapi.json` are public in production (FastAPI's default): the full map of the 215 routes for anyone. Not a hole by itself. |
| G5 | API | Only the image search is rate limited (spec 29: 30 a minute per user). Uploads, imports, PDF exports, Room duplication and invitations have no limit. |
| G6 | Repo | `SECURITY.md` is still GitHub's template (made-up versions 5.1.x / 4.0.x, no contact). |
| G7 | CI | Dependency audits only run through Dependabot; CI does not fail on a known vulnerable dependency. |

**Already sound (no change)**: every one of the 215 API routes requires a
valid token (ES256, audience `authenticated`, the project's issuer); the
remote-image fetch is SSRF-guarded (public addresses only, connection
pinned to the checked address against DNS rebinding, 3 redirects at most,
size cap while streaming); vault zips are capped on entries, total size and
compression ratio; a PDF Attachment is accepted by its `%PDF-` header;
Markdown shows raw HTML as text and only links `http`, `https` and `mailto`
(spec 48 Decision 3); invitation and Friend codes are 72-bit random;
`npm audit` (production dependencies) and `pip-audit` report nothing; no
secret in the git history; the image runs as a non-root user and the
backend is only reachable through Caddy; the Supabase advisor on production
only reports "leaked password protection" (irrelevant: social sign-in only).

## Decisions (proposed defaults, to confirm)

### Frontend headers (G1)

1. **Headers set in `frontend/vercel.json`** under `headers`, source
   `/(.*)`, so they reach every page, asset and the SPA fallback, on
   production and on the staging Preview alike (one file serves both).
2. **The CSP**, one policy for both environments:

   ```
   default-src 'self';
   script-src 'self';
   style-src 'self' 'unsafe-inline';
   img-src 'self' data: blob: https:;
   font-src 'self' data:;
   connect-src 'self' https://api.exlibris.world https://ttrpg-campaign-notes-2.onrender.com
               https://mlksmacrcjurfuxtwdjw.supabase.co wss://mlksmacrcjurfuxtwdjw.supabase.co
               https://zyrgrmaxqkegnosapjbo.supabase.co wss://zyrgrmaxqkegnosapjbo.supabase.co;
   media-src 'self' blob:;
   worker-src 'self' blob:;
   object-src 'none';
   frame-src 'none';
   base-uri 'self';
   form-action 'self';
   frame-ancestors 'none';
   upgrade-insecure-requests
   ```

   Why each exception:
   - `style-src 'unsafe-inline'`: Mantine writes `style` attributes and the
     emoji-mart picker injects styles; a nonce is not possible on a static
     Vercel site. Scripts stay strict (`'self'` only, no inline, no eval):
     that is the part that stops an injected script.
   - `img-src https:`: images come from Supabase signed links, Openverse
     thumbnails (spec 29) and the sign-in providers' profile pictures
     (Google, Discord, GitHub, X); listing every CDN would break on the
     next host change, and an image cannot run code.
   - `connect-src`: the two backends (production on the VPS, staging on
     Render) and the two Supabase projects (Auth and the signed-link
     `fetch` of a PDF Attachment, `openPdf`). If the staging Preview is
     ever pointed at another API host, it has to be added here.
   - `blob:` for media and workers: the Room export and the PDF viewer use
     `blob:` URLs (`saveBlob`, `openPdf`).
3. **Report-only first.** Unit 72_1 ships the policy as
   `Content-Security-Policy-Report-Only`. The product owner does the usual
   browser walk-through on the staging Preview with the console open; any
   `[Report Only]` violation is added to the policy or fixed. Unit 72_3
   switches the same policy to `Content-Security-Policy`, still on staging,
   for one more walk-through. Both happen before the release to `main`. No
   report endpoint is set up (there is no collector, and the console is
   enough for one tester).
4. **The other frontend headers**, enforced from 72_1 (they cannot break
   the app):
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY` (old browsers; `frame-ancestors` covers new ones)
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
   - HSTS is already sent by Vercel on its domains; nothing to add.

### API headers and body cap (G2, G3)

5. **Headers set in `deploy/Caddyfile`** for every response, the live
   streams included:
   - `Strict-Transport-Security: max-age=31536000` (one year; no
     `includeSubDomains` and no `preload`, so the apex and other
     subdomains keep their own policy, and nothing is hard to undo)
   - `X-Content-Type-Options: nosniff`
   - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
     (the API only answers JSON, SSE and files: nothing to load or frame)
   - `Referrer-Policy: no-referrer`
   - `-Server` (drops the header naming Caddy)
6. **Body cap in Caddy** (`request_body max_size`): **110 MB** on the
   import routes (`/rooms/*/imports*`: a vault is up to 100 MB plus the
   multipart overhead, spec 65), **25 MB** everywhere else (the largest
   other upload is an image at 20 MB, `MAX_INPUT_BYTES`). Over the cap,
   Caddy answers 413 before the backend sees the body. In normal use the
   routes' own, smaller caps answer first with their translated message,
   so only a request far beyond any limit meets Caddy's.
   **Caddy's 413 must carry CORS headers** (review of PR #325): the backend's
   CORS middleware never runs on it, and without
   `Access-Control-Allow-Origin` the browser reports a network error, not a
   413. A `handle_errors 413` block answers a small JSON body and copies the
   request's `Origin` into `Access-Control-Allow-Origin` (with
   `Access-Control-Allow-Credentials: true` and `Vary: Origin`) only when it
   is one of the production origins (`https://exlibris.world`,
   `https://www.exlibris.world`). The frontend's API client
   (`lib/apiClient.ts`) maps a 413 that has no translated `detail` to a new
   key `errors.requestTooLarge` ("This file is too large to upload"), in
   every locale. Matchers are ordered so the import routes' 110 MB block is
   evaluated before the 25 MB catch-all (Caddy sorts `request_body` by
   matcher specificity only inside one `route`, so both live in a `route`
   block written in that order).
7. **Staging is not covered by 5 and 6**: it runs on Render without Caddy.
   Render terminates TLS itself. Accepted: staging holds no real users.

### API docs (G4)

8. **A setting `api_docs_enabled`** (env `API_DOCS_ENABLED`, default
   `false`): when false, FastAPI is built with `docs_url`, `redoc_url` and
   `openapi_url` set to `None`, so those paths answer 404. `.env.example`
   sets it to `true` so local development keeps `/docs`. Production and
   staging need no change (the default is off).

### Rate limiting (G5)

9. **The spec 29 `Throttle` becomes a shared helper** (`app/domain/throttle.py`):
   the same in-memory sliding window per user, exact while each
   environment runs one uvicorn process (`architecture.md` → Image search;
   if that ever changes, the counters move to Postgres, as already noted
   there). The image search keeps its own 30/min and its own error key.
10. **Limits, per user** (each generous for a Master preparing a session,
    far below a script):

    | Group | Routes | Limit |
    |---|---|---|
    | Uploads | Document images (file and URL), PDF Attachments, Room image, avatar, map backgrounds and map import | 60 / minute |
    | Imports | `POST /rooms/{id}/imports` and `/imports/preview` | 10 / 10 minutes |
    | Exports | Room PDF (`POST .../export/pdf`), JSON / Markdown Room export, Document PDF | 10 / 10 minutes |
    | Room duplication | `POST /rooms/{id}/duplicate` | 5 / 10 minutes |
    | Invitations | creating an invitation link or a direct invitation | 30 / hour |
    | Every other write | any other `POST`, `PUT`, `PATCH`, `DELETE` | 300 / minute |

    Reads (`GET`) and the live streams are not limited. A user over a
    limit gets **429** with `errors.rateLimited` ("Too many requests: wait
    a moment and try again"), translated in all 12 backend and frontend
    locales, and a `Retry-After` header with the seconds until the window
    frees a slot. The frontend shows the message as it does other errors.
11. **The general write limit is one FastAPI dependency** on the routers,
    not a middleware, so it runs after authentication and counts by user
    id, not IP. The group limits are dependencies on their routes. A
    request refused by a group limit is not counted in the general one.

### Security policy and CI (G6, G7)

12. **`SECURITY.md` rewritten**: supported version = the latest release on
    `main` (the app is continuously deployed, there are no maintained
    branches); report privately through **GitHub's private vulnerability
    reporting** (the product owner turns it on in the repository's
    Settings → Security), with the controller's e-mail from the privacy
    notice as the fallback; acknowledgement within 7 days; no bounty.
13. **A `security` job in CI**: `pip-audit` on the backend's installed
    dependencies and `npm audit --omit=dev --audit-level=high` on the
    frontend. It fails the build on a known vulnerability, like the
    existing gates. A finding with no fix released yet can be ignored by
    id in the job, with a comment saying why and until when.
14. **Caddyfile check in CI**: the same job runs
    `caddy validate --config deploy/Caddyfile` (in the `caddy:2` image), so
    a typo cannot reach the VPS deploy.

### Out of scope

- Supabase "leaked password protection": no password sign-in exists.
- Moving the session out of `localStorage` into cookies: a large change in
  how supabase-js and the API authenticate, not needed once the CSP holds.
- A Web Application Firewall, fail2ban rules for the API, or IP-based
  limits: the VPS already runs ufw and fail2ban for SSH; the per-user
  limits cover abuse by signed-in users, and unauthenticated requests are
  rejected at the token check.
- Penetration testing by a third party.

## Units

- **72_1, Headers** (frontend + Caddy, no backend code): Decisions 1-7 with
  the CSP report-only, Decision 14 (`caddy validate` in CI). Released to
  staging; the API headers only reach production with the next release.
- **72_2, Backend**: Decisions 8-11 (docs off, throttle helper, limits,
  `errors.rateLimited` in every locale), Decisions 12-13 (`SECURITY.md`,
  dependency audit job).
- **72_3, Enforce the CSP**: after the product owner's walk-through of
  72_1, the policy (with any fixes) moves from `-Report-Only` to the
  enforcing header.

## Tests

- **Frontend**: a test that reads `vercel.json` and checks the header set
  (each name present, the CSP has no `'unsafe-eval'` and `script-src` is
  `'self'` only), so a later edit can't silently drop them.
- **Backend**:
  - `api_docs_enabled=False` → `/docs`, `/redoc`, `/openapi.json` 404;
    `True` → 200.
  - The throttle helper: window sliding, refused calls not counted, idle
    keys forgotten (moved from the image search tests).
  - Each group limit: the call after the limit answers 429 with
    `errors.rateLimited` and a `Retry-After`; another user is not affected;
    a `GET` is never limited.
  - The general write limit counts by user, and a View As request (always
    read-only, spec 22b) is never counted.
  - Coverage stays at 100% (the existing exact gates).
- **CI**: `caddy validate` passes on the Caddyfile; the audit job passes on
  the current lock files.
- **By hand (product owner)**: on the staging Preview, the usual
  walk-through with the console open (72_1, then 72_3), including sign-in
  with each provider, an image upload, a PDF Attachment opened in the
  viewer, the emoji picker, an Openverse search, a map, Session 0 live
  updates and a Room export. On production after the release:
  `curl -I https://exlibris.world` and `curl -I https://api.exlibris.world/health`
  show the headers, and the external scan is run again.

## Answered (product owner, 2026-11-14)

The product owner left the five questions to Claude ("non sono abbastanza
esperto di security per rispondere"), so the proposed defaults stand:

1. CSP **report-only on staging first**, then enforced (Decision 3).
2. Rate limits **as in Decision 10**; they can be raised later from one
   place (`app/domain/throttle.py`) if real use hits them.
3. HSTS **one year, no `includeSubDomains`, no `preload`** (Decision 5).
4. `SECURITY.md`: **GitHub private vulnerability reporting plus the
   controller's e-mail** as fallback (Decision 12). The product owner turns
   on private reporting in Settings → Security.
5. `/docs` **off on staging too** (Decision 8: default off everywhere;
   local development turns it on in `.env`).

The questions as they were asked:

1. **CSP rollout**: report-only on staging first, then enforce (Decision 3),
   or enforce directly on staging, since staging is the test bed anyway?
   Proposed: report-only first.
2. **Rate limits** (Decision 10): are the numbers right for how you and
   your players use the app? In particular 60 uploads a minute (a Master
   dropping a folder of images) and 10 imports in 10 minutes.
3. **HSTS** (Decision 5): one year without `includeSubDomains` / `preload`
   is the cautious choice. Want `includeSubDomains` too (every subdomain of
   exlibris.world must then be HTTPS forever)?
4. **SECURITY.md contact** (Decision 12): GitHub private reporting plus your
   e-mail as fallback, or GitHub only?
5. **API docs** (Decision 8): off on staging too, or keep `/docs` on
   staging for convenience?

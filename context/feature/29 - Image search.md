## Goals

- Product owner's request (2026-10-08): find an image for a Document **without leaving the app**. Searching Pinterest itself was the first idea, but Pinterest's API offers no public search across all pins (only your own boards, after Pinterest approves the app), and scraping the site breaks its terms. The product owner chose a search over **free image libraries** instead.
- Picking a result adds it to the Document like "Da URL" does today: same pipeline, same limits, same people.

## Decisions (proposed 2026-10-08, confirm in the PR)

1. **Source**: [Openverse](https://openverse.org) (WordPress.org's open search over Creative Commons and public domain images, including Wikimedia Commons and Flickr). It works without an API key (anonymous rate limits) and with a free registered client for higher limits. It holds the kind of material a campaign needs (paintings, maps, illustrations, old engravings) better than photo-only libraries. Unsplash and Pexels stay possible later as further sources behind the same endpoint.
2. **Who and where**: exactly who adds images today. In edit mode the Document's "Immagini" row (info panel, next to "File") gains a third action, **"Cerca"**, next to "Carica immagini" and "Da URL". No new permission.
3. **Picker**: a modal with a search field and a grid of thumbnails (20 per page, "Altri risultati" for the next page). Each result shows its creator and license on hover. Clicking a result adds it right away (one image per click; the modal stays open so several can be added, each counting toward `MAX_IMAGES_PER_DOCUMENT`). Search only, no browsing of categories.
4. **Adding**: the existing `POST .../images/from-url` with the result's full image URL. The image goes through the same pipeline (content check, EXIF stripped, WebP, resized), so nothing new is stored or trusted. A result whose host refuses the download fails like any bad URL today.
5. **Credit**: shown in the picker (creator, license, link to the source page). **Not stored** with the image in this spec: Documents are private to a Room, not published. Keeping the credit on the image (a caption, an exported PDF's credits page) is a follow-up if wanted.
6. **Safety and privacy**: only results Openverse marks as not mature (`mature=false`). The search query goes to Openverse through our backend, so Openverse never sees who searched. The **thumbnails** are a trade-off: the browser loads them from Openverse's own thumbnail endpoint (`api.openverse.org/v1/images/{id}/thumb/`, which Openverse serves itself, so Flickr, Wikimedia and the other upstream hosts are not contacted). Openverse therefore sees the viewer's IP and user agent for those requests, but not the query or the account. Relaying the thumbnails through our backend would hide that too, at the cost of about 20 image requests per search on the VPS. Proposed: accept the trade-off; confirm in the PR. The app has no Content Security Policy today; if one is added, `img-src` must allow `api.openverse.org`.

## Design

### Backend (29_1)

- `GET /image-search?q=&page=` for any signed-in user: proxies Openverse `GET /v1/images/` (`q`, `page`, `page_size=20`, `mature=false`) with `httpx`, a short timeout, and returns `{results: [{id, thumbnail_url, url, width, height, title, creator, license, license_url, source_url}], page, has_more}`. 422 for an empty or over-long `q`; 502 `errors.imageSearch.unavailable` when Openverse fails or throttles.
- Optional `OPENVERSE_CLIENT_ID` / `OPENVERSE_CLIENT_SECRET`: when set, the backend gets and caches an OAuth token for higher limits; unset, it calls anonymously. Documented in `architecture.md` and the env examples (all environments).
- A small per-user throttle (e.g. 30 searches a minute) so one tab can't spend the server's shared quota.
- Tests with Openverse mocked: results mapped, mature filter sent, paging, empty query 422, upstream error 502, token used when configured, throttle.

### Frontend (29_2)

- `ImageSearchModal` (search field, thumbnail grid, credit on hover, "Altri risultati", loading and empty states, an error line on 502) and `useImageSearch` (TanStack Query, keyed by query and page).
- `AddDocumentImages` gets the "Cerca" action; picking a result calls the same import mutation as "Da URL", with a per-result loading state and the usual error toast.
- Thumbnails load straight from Openverse's thumbnail endpoint (Decision 6), never from the upstream hosts; the backend returns that URL as `thumbnail_url`.
- New strings in `it.json` and `en.json`.

## Implementation

- **29_1** backend, **29_2** frontend, into `staging`. No migration.
- Update `architecture.md` (external services, env vars) and `progress-tracker.md`.

## Definition of Done

- An Owner in edit mode searches, sees thumbnails with credits, and adds one or more results to the Document; a non-Owner never sees "Cerca".
- Openverse being down or throttled shows a clear error and leaves upload and "Da URL" working.
- Backend `pytest` (100% coverage), `ruff`, `mypy`; frontend `npm run build`, `npm run lint`, `npm test`.

# 45 - Landing page and Demo

## Goals

- Product owner's request (2026-10-25): "Adesso creiamo una Landing page,
  che sarà quella visualizzata all'apertura del sito. Ci sarà una
  descrizione del progetto ed una modalità Demo/tutorial che mostra e
  spiega le diverse funzioni." (Let's create a landing page, shown when the
  site opens, with a description of the project and a Demo/tutorial mode
  that shows and explains the different features.)
- Today `/` for a visitor without a session is a bare sign-in screen (logo,
  app name, one button per provider, privacy link). It says nothing about
  what Ex Libris is. It becomes a **landing page**: what Ex Libris is, what
  it does, sign-in, and a way into a **Demo**.
- The **Demo** lets anyone try the real app without an account: a sample
  campaign Room opened in the real pages, with a **guided tour** that walks
  through the main features and explains each one.
- `requirements.md` is unchanged (protected; the landing page and Demo have
  no `FR-`). `project-overview.md` gains the feature.

## Decisions

Defaults picked on 2026-10-25 from the request, **to confirm in the PR**
before any code is written.

### Landing page (45_1)

1. **Who sees it**: a visitor **without a session** opening `/`. A signed-in
   user opening `/` still lands on their Rooms, as today, since the landing
   page would only be a step in their way. The same page is also reachable
   by anyone at **`/welcome`**, linked from the Account page ("About Ex
   Libris"), so a signed-in user can open the Demo or share the page.
2. **Pending links keep working**: an invite link (`/invite/:code`) or a
   friend link opened without a session still goes through its own page
   and sign-in, unchanged; the landing page is only `/` and `/welcome`.
3. **Sections, top to bottom** (one page, scrolls, no separate routes):
   - **Hero**: logo, "Ex Libris", a one-line tagline ("The shared notebook
     of your campaign"), a short paragraph, and two actions: **Try the
     demo** (accent, primary) and **Sign in** (scrolls to the sign-in
     block, or opens it in a modal on a phone; see 4).
   - **Features**: six cards, each an icon, a title and two lines, in a
     3-column grid on desktop, 2 on tablet, 1 on a phone: Rooms and roles
     (Master and Players), Documents and Notes with mentions, Visibility
     and Reveal (what each player knows), Comments and threads, Maps
     (relationship and geographic), Export (PDF manual, JSON, Markdown).
     Each card has a **"See it in the demo"** link that starts the Demo at
     that feature's tour step.
   - **How it works**: three numbered steps (Create a Room, Invite your
     players, Write the campaign together).
   - **Sign in**: the provider buttons as today (Google first and filled,
     D-07), the privacy link.
   - **Footer**: privacy notice link, language selector, GitHub link to
     the repository.
4. **Header**: no `AppHeader` (it needs a session); a light top bar with
   the logo and app name on the left, the language selector and a "Sign
   in" button on the right, so a visitor can switch language before
   reading.
5. **No screenshots in round one**: the feature cards use icons, since the
   Demo is the live picture. Screenshots or a short looping video can come
   later.
6. **Languages**: every string of the landing page and the tour in all 12
   UI languages (the 10 beta ones drafted by Claude, as in spec 34).
7. **SEO**: `index.html`'s title and English meta description already
   describe the app; add Open Graph tags (title, description, logo
   preview image) so a shared link shows a card. No server-side rendering.

### Demo (45_2)

8. **What the Demo is**: the **real app pages** (Room, Documents list,
   Document, maps, mention map, search) running against a **sample Room
   that lives in the browser**, not on the backend. No account, no sign-in,
   **no request to the backend and no write to any database**. Picked over
   a guided tour inside the visitor's real account (needs sign-in first and
   would write sample data into their Rooms) and over a shared demo Room on
   the backend (needs anonymous access, a reset job, and a way to stop
   visitors defacing it).
9. **How it works**: entering the Demo turns on a demo flag (kept in
   `sessionStorage`, so a refresh stays in the Demo and a new tab does not).
   While it is on, `useSession` returns a fake demo session and
   `apiClient.request` answers from an **in-browser demo backend**
   (`lib/demo/`) instead of `fetch`: the same JSON shapes as the real API,
   built from a fixed sample Room. The demo code is a lazy chunk, loaded
   only when the Demo starts, so the normal app bundle does not grow.
10. **Writes are kept in memory**: creating or editing a Document, a Note
    or a Comment, moving a map card, revealing content and the like work
    and are kept in browser memory until the visitor leaves the Demo or
    closes the tab; nothing is saved. Features that need a real server
    (image upload and image search, PDF and file exports, JSON import,
    invitations, friends, Room duplication, account settings) show a
    "Not available in the demo: sign in to use it" notice instead.
    **Alternative to confirm**: a read-only Demo (every write shows the
    notice), smaller to build and maintain; see Open choices.
11. **The sample Room**: a short fantasy campaign ("The Lost Lighthouse"):
    about 12 Documents across the default Main Tags (NPC, PC, Place, Event,
    Artifact) with images bundled in `public/demo/`, a few Notes (one
    flagged as a Relational link, spec 41), Comments with a reply and a
    reaction, mentions between Documents, one Master-only Document and one
    Selective Note, a free relationship map and a small geographic map. Written in **English and Italian**; the Italian version
    is used when the UI is in Italian, English for every other language
    (user content is never translated, but a demo in a language the
    visitor can't read would not teach anything).
12. **Master and Player**: the visitor starts as the **Master** (sees
    everything). A switch in the demo banner ("View as: Master / Player")
    swaps to a sample Player, so the visitor sees content disappear, which
    is what Visibility and Reveal are about. It reuses spec 22b's view-as
    mechanism: the demo backend reads the same `X-View-As` header and
    filters with the same rules (Room, Master-only, Private, Selective).
13. **Demo banner**: on every page while the Demo is on, a slim bar under
    the header: "You're exploring the demo: nothing is saved", the View-as
    switch, **Restart tour**, **Exit demo** (back to the landing page,
    clearing the flag and the in-memory changes) and **Sign up** (back to
    the landing page's sign-in block). The header's account avatar shows
    the demo user; the Account page shows a notice instead of settings.
14. **Signed-in users**: starting the Demo while signed in does not sign
    them out; the demo flag simply wins while it is on, and Exit returns
    them to their Rooms.

### Tour (45_3)

15. **What the tour is**: a sequence of about 12 steps, each a small card
    pointing at a part of the real page (a highlighted element with the
    rest dimmed), with a title, two or three lines of explanation, **Back /
    Next**, a step counter ("4 of 12") and **Skip**. Steps can move to
    another page (Next opens the Document, the map, etc.).
16. **Steps, in order**: 1 the Room and its Main Tags, 2 the Room Index
    tab (spec 44), 3 a Document card, 4 a Document page (description,
    images, Owners), 5 Notes and mentions ("Mentioned in"), 6 Comments and
    replies, 7 Visibility of a post, 8 View as Player (flips the switch),
    9 Reveal, 10 search, 11 the relationship map, 12 the geographic map,
    then a last card: "That's Ex Libris" with **Sign in to create your
    Room** and **Keep exploring**.
17. **Starts on its own** the first time the Demo opens; can be skipped at
    any step and restarted from the banner. A "See it in the demo" link on
    a landing feature card opens the Demo at that step.
18. **No library**: the highlight and card are built with Mantine
    (`Popover`/`Overlay`) and `data-tour` attributes on the target
    elements, rather than adding a tour dependency; on a phone the card
    docks to the bottom of the screen instead of pointing.

### Not in scope

19. A marketing site separate from the app, pricing, a blog, analytics or
    cookie banners (no tracking is added), screenshots/video (see 5), a
    tour inside a real Room for signed-in users, and saving demo changes
    into a real Room after signing in.

## Open choices for the product owner

- **A. Demo interactivity**: in-memory writes (default, 10) or read-only.
  In-memory writes let the visitor actually try writing a Note or moving a
  map card; read-only is about half the demo backend.
- **B. Signed-in users at `/`**: straight to their Rooms (default, 1), or
  the landing page for everyone with an "Open my Rooms" button.
- **C. Sample content languages**: English and Italian (default, 11), or
  English only.

## Design (frontend only, no backend change, no migration)

- **Routes** (`App.tsx`): `HomePage` renders `<LandingPage />` instead of
  the sign-in screen when there is no session; new lazy route `/welcome`
  renders it for everyone; `/demo` (optionally `/demo?step=N`) turns the
  demo flag on and opens the sample Room's Documents page,
  `/rooms/demo/documents`, so every real page and link works unchanged.
- **`pages/LandingPage.tsx`** and `components/landing/` (hero, feature
  grid, steps, sign-in block, footer); the sign-in buttons move from
  `HomePage` into a shared `SignInButtons` component.
- **`lib/demo/`** (lazy chunk): `demoMode.ts` (flag on/off in
  `sessionStorage`, read synchronously by `apiClient` and `useSession`),
  `demoData.en.ts` / `demoData.it.ts` (the sample Room), `demoBackend.ts`
  (a small router: method + path pattern -> handler over an in-memory
  copy of the sample data, returning the same shapes as the API types in
  `src/types/`; unknown or server-only routes throw an `ApiError(501)`
  that `notifyError` shows as the "Not available in the demo" notice),
  `demoVisibility.ts` (the view-as filter, mirroring the backend's
  visibility rules for the sample data only).
- **`apiClient.request`**: when the demo flag is on, hand the call to
  `demoBackend` and wrap its answer in a `Response`, so `apiFetch`,
  `apiDownload` and every hook stay untouched. The react-query cache is
  cleared on entering and leaving the Demo, so demo data never mixes with
  a real Room's.
- **`useSession`**: returns a fixed demo `Session` while the flag is on;
  the real Supabase session is left alone.
- **`components/demo/DemoBanner.tsx`** (rendered by `PageLayout` and
  `HomePage` while the flag is on) and **`components/demo/DemoTour.tsx`**
  (steps in `lib/demo/tourSteps.ts`: target `data-tour` id, route, i18n
  keys); `data-tour` attributes added to the targets in the existing
  components.
- **The 5 s map refresh** (spec 43) and any polling read the in-memory
  data, so they keep working with no network.
- **i18n**: new `landing.*`, `demo.*` and `tour.*` keys in all 12 locale
  files; `context/i18n-glossary.md` gains "demo" and "tour".
- **Docs**: `project-overview.md` (Features, Scope), `architecture.md`
  (Demo mode: in-browser backend, no network, flag), `ui-context.md`
  (landing page, demo banner, tour), `progress-tracker.md`.

## Build order

One unit at a time, each its own PR into `staging`:

1. **45_1 Landing page**: page, `/welcome`, sign-in moved, Open Graph tags,
   12 languages. "Try the demo" hidden until 45_2 ships.
2. **45_2 Demo**: demo flag, in-browser backend, sample Room (en/it),
   banner, view-as, not-available notices.
3. **45_3 Tour**: steps, highlight card, deep links from the landing page.

## Tests

- `LandingPage.test.tsx`: shows without a session, not with one at `/`;
  `/welcome` shows it with a session; the sign-in buttons call
  `signInWithOAuth` with the right provider; "Try the demo" goes to
  `/demo`; an invite link without a session still reaches its page.
- `demoBackend.test.ts`: every GET a demo page makes returns the sample
  data in the API's shape; a write changes the in-memory copy and the
  next read sees it; a server-only route throws the not-available error;
  `fetch` is never called while the flag is on.
- `demoVisibility.test.ts`: as the Player, the Master-only Document and
  the Selective Note are absent from the list, search and mention map.
- `DemoBanner.test.tsx` / `DemoTour.test.tsx`: Exit clears the flag and the
  cache; the tour starts on first entry, Next/Back/Skip work, a step on
  another page navigates there, `?step=N` starts at that step.
- Screenshots at desktop and phone width: landing page, a demo page with
  the banner, a tour step.

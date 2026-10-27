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
before any code is written. The product owner answered on 2026-10-25: the
Demo is **read-only**, the landing page is shown **to everyone** (signed-in
users included), and the header gets back a **burger menu** for quick
navigation between the landing page, the Rooms page and each Room.

### Landing page (45_1)

1. **Who sees it** (product owner, 2026-10-25: "Vede comunque la landing.
   Da lì c'è la possibilità di navigare nelle Room"): **everyone** opening
   `/`, signed in or not. The Rooms list moves from `/` to its own route,
   **`/rooms`**. For a signed-in user the landing page's sign-in actions
   are replaced by **Open my Rooms** (to `/rooms`), and the header is the
   normal `AppHeader` with the burger (see 2a).
2. **Pending links and sign-in keep working**: an invite link
   (`/invite/:code`) or a friend link opened without a session still goes
   through its own page and sign-in, unchanged. Sign-in still returns to
   the site's origin (no change to Supabase's Redirect URLs); a
   `sessionStorage` marker set when a sign-in button is pressed (like the
   pending invite) sends the user on to `/rooms` right after signing in,
   after the pending invite and friend link checks, so signing in from the
   landing page lands on the Rooms, while opening the site later shows the
   landing page. Every link and back arrow that today means "my Rooms"
   (header back from a Room, invite and friend pages, Room deletion, the
   Room setup page) points to `/rooms`; the header's app name points to
   `/`.
2a. **Burger menu, quick navigation** (product owner, 2026-10-25: "il
   Burger menù consente una quick navigation tra la landing, la Room Page
   ed una sottolista con tutte le diverse Room di cui facciamo parte"): a
   burger button **back in the header's left column, before the back
   arrow**, on every signed-in page (landing page included). It opens a
   Mantine `Menu` (`bottom-start`) with:
   - **Home** -> the landing page (`/`);
   - **My Rooms** -> the Rooms page (`/rooms`);
   - a **Rooms** sub-list with every Room the user is a member of
     (`GET /rooms`, the same list the Rooms page shows, archived Rooms
     left out), alphabetical, each with its small Room image and name,
     linking to the Room's Documents page; the current Room is checked.
     The Rooms are listed inline under a "Rooms" label in the same menu,
     scrolling inside it when long, on desktop as on a phone (product
     owner, 2026-10-25: no side sub-menu). With no Room, the list shows "No Rooms yet".
   - The Rooms list is fetched when the menu first opens. The burger is
     not shown without a session (the landing page's own top bar, 4) and
     does not replace spec 44's Room Index tab, which stays the index of
     the current Room's sections.
3. **Sections, top to bottom** (one page, scrolls, no separate routes):
   - **Hero**: logo, "Ex Libris", a one-line tagline ("The shared notebook
     of your campaign"), a short paragraph, and two actions: **Try the
     demo** (accent, primary) and **Sign in** (scrolls to the sign-in
     block; see 4).
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
   - **Footer**: privacy notice link (the language selector is in the top
     bar; no GitHub link, the repository is not a public page).
4. **Header**: without a session, no `AppHeader` (it needs one); a light
   top bar with the logo and app name on the left, the language selector
   and a "Sign in" button on the right, so a visitor can switch language
   before reading. With a session, the normal `AppHeader` (burger, app
   name, language, avatar).
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
10. **Read-only** (product owner, 2026-10-25): the demo backend answers
    reads only. Every write (create, edit, delete, reveal, move a map card,
    upload, export, import, invite, account settings) is refused with a
    "The demo is read-only: sign in to create your own Room" notice, and
    nothing changes. The buttons stay where they are, so the visitor sees
    what the app can do; the notice comes when an action is sent. Map
    pages open in their reading mode, and the 5 s map refresh (spec 43)
    keeps reading the same sample data. The View-as switch (12) is a read
    and works.
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
    the header: "You're exploring the demo (read-only)", the View-as
    switch, **Restart tour**, **Exit demo** (back to the landing page,
    clearing the flag) and **Sign up** (back to
    the landing page's sign-in block). The header's account avatar shows
    the demo user; the Account page shows a notice instead of settings.
    The burger (2a) lists only the sample Room while the Demo is on.
14. **Signed-in users**: starting the Demo while signed in does not sign
    them out; the demo flag simply wins while it is on, and Exit returns
    them to their Rooms.

### Demo as built (45_2, 2026-10-25)

What changed from the plan above while building it:

- **Sample Room**: 11 Documents, 5 Notes (two Relational links, one
  Master-only, one Selective), 4 Comments (a reply, reactions, one
  Master-only), 7 Tags, a free map and a geographic map, all in one file
  (`lib/demo/demoData.ts`, English and Italian side by side). **No
  images** yet: the cards and maps read well without them, and bundled
  pictures can come later.
- **Players**: two sample Players, Marco (plays Brann, owns a Private
  Document) and Giulia (plays Seren, has a Selective Note). The Master is
  "Morgan". The banner's switch is a SegmentedControl Master / Marco /
  Giulia.
- **Entering, leaving and switching are full page loads** (`/demo`,
  Exit, Sign in, and the View-as switch), instead of clearing the
  react-query cache: an open page's queries stay bound to the cache they
  started in, so a switch in place kept showing the previous viewer's
  data. A reload starts clean and costs nothing in the Demo.
- **The banner** is rendered by `AppHeader` (so every page with the top
  bar has it, the landing page included), in place of spec 22b's preview
  banner. It has Exit demo and Sign in; Restart tour comes with 45_3. A
  change of UI language reloads the sample data in the new language.
- **The backend** (`lib/demo/demoBackend.ts`) holds the visibility filter
  too (no separate `demoVisibility.ts`). Unknown GET routes answer 404,
  as the API does (the hooks already treat a 404 linked map as "none").
  Opening a Document sends `POST .../read`, which is answered (nothing
  stored) so no error shows. Every other write answers 403 with the
  localized read-only notice, which the forms and `notifyError` show.
- **Mention maps** (spec 36) are live in the Demo: every Document tied to
  others has a depth-1 map, built from its description and Relational
  links.
- **Account page**: shows "In the demo there is no account" with a way
  back to the Rooms.

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
    9 Reveal (explained on the button, since the Demo is read-only), 10
    search, 11 the relationship map, 12 the geographic map,
    then a last card: "That's Ex Libris" with **Sign in to create your
    Room** and **Keep exploring**.
17. **Starts on its own** the first time the Demo opens; can be skipped at
    any step and restarted from the banner. A "See it in the demo" link on
    a landing feature card opens the Demo at that step.
18. **No library**: the highlight and card are built with Mantine
    (`Popover`/`Overlay`) and `data-tour` attributes on the target
    elements, rather than adding a tour dependency; on a phone the card
    docks to the bottom of the screen instead of pointing.

### Tour as built (45_3, 2026-10-25)

- **13 cards**: 1 the Room (title row), 2 the Room Index tab, 3 a
  Document card, 4 a Document page (Ilsa Varn: name, badges, actions), 5
  its description and Notes ("Notes and mentions"), 6 its mention map, 7
  the Comments (The Night of the Dark Lamp), 8 Visibility and Reveal (The
  Drowned Prophet, Master only: the badge and the ⋮ actions, since Reveal
  is in that menu and the Demo is read-only), 9 the banner's View-as
  switch, 10 search, 11 the free board, 12 the geographic map, 13 "That's
  Ex Libris" with **Sign in to create your Room** and **Keep exploring**.
  "Mentioned in" is not a step: it is closed by default, and the mention
  map shows the same links.
- **State**: the open step lives in `sessionStorage`
  (`exlibris.demo.tour`, `lib/demo/tour.ts`), so it survives the Demo's
  full page loads and ends with the tab. `/demo` opens the tour at step 1,
  `/demo?step=<id>` at that step (the landing cards link `room`,
  `document`, `visibility`, `comments`, `freeMap`; Export has no step).
  Next/Back open the step's page in place, or with a full page load when
  leaving a Player's preview. Skip, Escape and Keep exploring close it;
  **Restart tour** in the banner opens it at step 1.
- **Highlight**: targets carry `data-tour` attributes; the tour lights the
  first visible one (the search button has a phone twin) with a box whose
  huge shadow dims the rest, follows it while the page loads, scrolls or
  resizes, and scrolls it into view once per step. The page stays usable
  underneath. The card sits under the element, else over it, else docked
  at the bottom of the screen; always docked on a phone; centered when the
  step has no element or the visitor is on another page.

### Not in scope

19. A marketing site separate from the app, pricing, a blog, analytics or
    cookie banners (no tracking is added), screenshots/video (see 5), a
    tour inside a real Room for signed-in users, and writing in the Demo
    (product owner, 2026-10-25: read-only).

## Open choices for the product owner

- ~~A. Demo interactivity~~: read-only (product owner, 2026-10-25).
- ~~B. Signed-in users at `/`~~: the landing page for everyone, Rooms at
  `/rooms`, plus the burger (product owner, 2026-10-25).
- ~~C. Sample content languages~~: English and Italian (product owner,
  2026-10-25).

## Design (frontend only, no backend change, no migration)

- **Routes** (`App.tsx`): `/` renders `<LandingPage />` for everyone
  (`HomePage` keeps the pending invite / friend link / just-signed-in
  redirects); new route `/rooms` renders `RoomsPage` behind the session
  check that `HomePage` does today; every "my Rooms" link moves to
  `/rooms` (2); `/demo` (optionally `/demo?step=N`) turns the
  demo flag on and opens the sample Room's Documents page,
  `/rooms/demo/documents`, so every real page and link works unchanged.
- **`pages/LandingPage.tsx`** and `components/landing/` (hero, feature
  grid, steps, sign-in block, footer); the sign-in buttons move from
  `HomePage` into a shared `SignInButtons` component, which also sets the
  just-signed-in marker (`lib/pendingInvite.ts` style).
- **`components/QuickNavMenu.tsx`**: the burger and its `Menu` (Home, My
  Rooms, the Rooms list from `useMyRooms`, enabled on first open, inline
  under a label), rendered by `AppHeader` in the
  left column before the back arrow whenever there is a session.
- **`lib/demo/`** (lazy chunk): `demoMode.ts` (flag on/off in
  `sessionStorage`, read synchronously by `apiClient` and `useSession`),
  `demoData.en.ts` / `demoData.it.ts` (the sample Room), `demoBackend.ts`
  (a small router: `GET` + path pattern -> handler over the sample data,
  returning the same shapes as the API types in `src/types/`; any other
  method, or an unknown route, throws an `ApiError(403)` whose message is
  the localized "The demo is read-only" notice, shown by `notifyError`),
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
- **The 5 s map refresh** (spec 43) and any polling read the sample data,
  so they keep working with no network.
- **i18n**: new `landing.*`, `demo.*` and `tour.*` keys in all 12 locale
  files; `context/i18n-glossary.md` gains "demo" and "tour".
- **Docs**: `project-overview.md` (Features, Scope), `architecture.md`
  (Demo mode: in-browser backend, no network, flag), `ui-context.md`
  (landing page, demo banner, tour), `progress-tracker.md`.

## Build order

One unit at a time, each its own PR into `staging`:

1. **45_1 Landing page and quick navigation**: page at `/`, Rooms moved to
   `/rooms`, sign-in moved, burger menu, Open Graph tags, 12 languages.
   "Try the demo" hidden until 45_2 ships.
2. **45_2 Demo**: demo flag, in-browser backend, sample Room (en/it),
   banner, view-as, not-available notices.
3. **45_3 Tour**: steps, highlight card, deep links from the landing page.

## Tests

- `HomePage.test.tsx` (the landing page through `/`): shows at `/` with and without a session; with
  one it offers Open my Rooms instead of sign-in; the sign-in buttons call
  `signInWithOAuth` with the right provider and set the marker; right
  after sign-in `/` goes on to `/rooms`, later visits stay on the landing
  page; a pending invite still wins; "Try the demo" goes to `/demo`.
- `QuickNavMenu.test.tsx`: Home and My Rooms link to `/` and `/rooms`;
  the Rooms sub-list shows each Room alphabetically, links to it, checks
  the current one, says "No Rooms yet" when empty; nothing is fetched
  before the first open; no burger without a session.
- `layout.test.tsx` / page tests: back from a Room and the other "my Rooms"
  links go to `/rooms`.
- `demoBackend.test.ts`: every GET a demo page makes returns the sample
  data in the API's shape; any write throws the read-only error and
  changes nothing; `fetch` is never called while the flag is on.
- `demoVisibility.test.ts`: as the Player, the Master-only Document and
  the Selective Note are absent from the list, search and mention map.
- `DemoBanner.test.tsx` / `DemoTour.test.tsx`: Exit clears the flag and the
  cache; the tour starts on first entry, Next/Back/Skip work, a step on
  another page navigates there, `?step=N` starts at that step.
- Screenshots at desktop and phone width: landing page, a demo page with
  the banner, a tour step.

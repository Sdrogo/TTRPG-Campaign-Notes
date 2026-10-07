# UI Context

## Theme

Dark only, no light mode. Gothic/vampiric technical workspace: a
near-black backdrop with a cold purple undertone, layered surfaces
that read like parchment under candlelight gone digital, and a
single vivid red accent for anything interactive. The mood is
closer to a grimoire or a vampire's study than a generic dark IDE
theme — restrained ornamentation (thin borders, subtle glow on
accent elements), never gaudy or neon.

## Colors

Tokens are defined as CSS custom properties and also registered as
Mantine theme colors (Mantine expects a 10-shade array per color
name; the table below gives the single value each token resolves
to for this app — see the Component Library section for how the
Mantine theme is built from these).

| Role              | CSS Variable        | Value     |
| ------------------ | -------------------- | --------- |
| Page background     | `--bg-base`          | `#0d0a0f` |
| Surface (panels/cards) | `--bg-surface`     | `#17121c` |
| Raised surface (modals/popovers) | `--bg-raised` | `#1f1826` |
| Primary text        | `--text-primary`     | `#e8e3ea` |
| Muted text           | `--text-muted`       | `#9b8ba3` |
| Primary accent       | `--accent-primary`   | `#ea3333` |
| Accent hover/active  | `--accent-strong`    | `#f75555` |
| Border               | `--border-default`   | `#2a2230` |
| Error                | `--state-error`      | `#dc2626` |
| Success              | `--state-success`    | `#4f9c6c` |
| Warning (Reveal / destructive‑adjacent actions) | `--state-warning` | `#c2820a` |

Notes:
- `--accent-primary` is reserved for interactive elements (links,
  primary buttons, active tab, focus ring) — never used decoratively
  on large surfaces.
- `--state-error` is reserved for errors and destructive actions
  (delete Document, remove member), separate from the red accent.
- All components use these tokens — no hardcoded hex values in
  component code. **One exception: country flags** (the language
  selector, spec 09) keep their official colors. They're content, not
  theme, so they are SVG files in `src/assets/flags/`, not components.

## Typography

| Role              | Font              | Variable       |
| ------------------ | ----------------- | -------------- |
| Headings / display  | EB Garamond       | `--font-display` |
| UI text / body      | Inter             | `--font-sans`  |
| Code / IDs / mono   | JetBrains Mono    | `--font-mono`  |

EB Garamond is used for Room names, Document titles and page
headings only, to carry the gothic tone without hurting readability
of dense content (Thread posts, Glossary entries, forms all use
Inter). `--font-mono` shows up rarely in this app — mainly for
technical identifiers if ever surfaced to an Administrator.

**Heading levels follow the page outline, not the look** (2026-10-03,
Andrea's accessibility audit: "heading levels should only increase by
one"). Every page has one `h1` (the Room's Documents, the Document's name,
My Rooms, the setup, the invite and friend-link results), sections are
`h2` and what sits in them `h3`; `Title`'s `fz` keeps the size each one
had before (e.g. the Room title is `order={1} fz="h2"`, a group heading
`order={2} fz="h5"`). `DocumentCard` takes `headingOrder` (2 by default,
3 inside a group); Note titles are `h2`. The app name in the top bar stays
an `h3`, which axe allows (only skipping *down* a level is an error).

## Accessibility landmarks and targets

- **One `main` per page** (2026-10-03, same audit): `PageLayout`'s body
  `Container`, the Rooms list (`RoomsPage`), the sign-in screen, the
  invite and friend-link pages and `PageState`'s full-screen messages
  render as `main`; the top bar is the `header` (banner).
- **Tap targets at least 24px** (WCAG 2.5.8): the Tag links in `TagList`
  get 4px of vertical padding taken back by an equal negative margin, so
  the line looks the same while the link is 24px tall, and wrapped rows are
  8px apart so two rows' hit areas don't overlap.

## Border Radius

| Context           | Class / token       |
| ----------------- | --------------------|
| Inline / small UI  | `rounded-sm` (4px)  |
| Cards / panels     | `rounded-md` (6px)  |
| Modals / overlays  | `rounded-lg` (8px)  |

The theme favors slightly sharper corners than a typical SaaS
dark-mode default — it reads more "ledger/grimoire" than "app."
Nothing above 8px radius; no pill-shaped buttons.

**One exception: user avatars are always circles** (`radius="50%"`,
built into `UserAvatar`, spec `05 - Account Page`). A circle reads as
"a person" at a glance, which is the convention users expect.

## Component Library

**Mantine** (v7+) is the component library, used directly rather
than restyled from scratch — it ships its own theming system, so
the tokens above are wired into a single `theme` object (colors,
fonts, radius, `primaryColor: 'accent'` mapped to the accent shades)
passed to `MantineProvider`, instead of hand-written CSS custom
properties everywhere. Components live under `components/` in the
frontend, built as thin wrappers around Mantine primitives where the
app needs app-specific behavior (e.g. a `VisibilityBadge`, a
`RoleTag`, a `DocumentCard`) — do not fork or reimplement a Mantine
component that already does the job.

Icons: **Phosphor Icons** (`@phosphor-icons/react`), `duotone` or
`regular` weight for standalone/emphasis icons (Room icon, empty
states), `regular` for inline UI icons. Do not mix Phosphor with any
other icon set.

## Layout Patterns

- **App shell**: persistent top navbar (Room name + role badge for
  the current user + account menu) over a two/three-column body,
  using Mantine's `AppShell`. **Built so far** (2026-09-22): the
  `AppHeader` component — app name (links to the Rooms list) **always at
  the exact center** (2026-10-03, Andrea: it shifted between pages): the
  header is a 3-column grid (`1fr minmax(0, auto) 1fr` in `.app-header`), so
  whatever sits on either side never moves it. **On the left, the back arrow
  then the Glossary burger** (same date): the back button is an icon-only
  `ActionIcon` (`ArrowLeftIcon`), its destination's name kept as
  `aria-label`/`title`; the current user's circular avatar on the right
  (`AccountButton`, 36px, thin `--border-default` ring that turns
  `--accent-primary` on hover/focus and while on `/account`). It is
  rendered by `HomePage` and by `PageLayout`, so every signed-in page
  has it. **It stays pinned to the top while the page scrolls**
  (2026-10-03, Andrea: in a long Room it scrolled out of view):
  `.app-header` in `index.css` makes it `position: sticky` with the page
  background and `z-index: 100` (above cards, below Mantine overlays), and
  `html { scroll-padding-top: 72px }` keeps scrolled-to targets out from
  under it. **It slides away while scrolling down and comes back as soon
  as the scroll turns up** (2026-10-03, Andrea: more room on a phone):
  Mantine's `useHeadroom` (`fixedAt` 80px, so it never moves near the top
  of the page) sets `data-hidden` on the header, and `.app-header[data-hidden]`
  translates it up by its own height over 200ms (no transition with
  `prefers-reduced-motion`); `:focus-within` brings it back while keyboard
  focus is inside it. **The page's scrollbar never shifts the centered
  title** (2026-10-03, Andrea: pages that scroll were narrower):
  `scrollbar-gutter: stable` on `html` always keeps its gutter, the bar is
  thin and transparent, and `useScrollbarReveal` (called once by `App`, so
  on every page) sets `data-scrolling` on `html` to show it,
  semi-transparent, while the page scrolls or the pointer is at the right
  edge. An open modal's scroll
  lock drops its compensating body padding, since the gutter already
  stays. The account avatar is the only way to the Account page and
  to sign out. **Just before the avatar** (spec 09) is the
  `LanguageSelector`: the current language's flag (24×16, `sm` radius,
  thin `--border-default` edge) inside a 4px padded button whose
  transparent ring turns `--accent-primary` on hover/focus and while its
  menu is open. It opens a Mantine `Menu` (`bottom-end`): one item per
  language with a 20px flag and the language's **own** name ("Italiano",
  "English"), so it can be found whatever language the UI is in, and a
  check mark on the current one. Its tooltip ("Change language") is hidden while the menu is open, so it doesn't cover the
  first item. **Pending count** (spec 18_2): the avatar sits in a Mantine
  `Indicator` (accent, 18px) counting friend requests received plus Room
  invitations from Friends, hidden at zero; the link's label becomes
  "Il tuo account: N da vedere".
- **Sign-in screen** (`HomePage`, signed out; spec 08): centered book
  icon, title, "Sign in to continue.", then one full-width button per
  provider in `AUTH_PROVIDERS` order, in a column capped at 320px. Google
  is the only `filled` (accent) button, since it's the preferred login
  (D-07); the others are `default`. Each has the provider's Phosphor
  logo.
- **Page cards** (`PageCard`): the main card(s) of a page — Document,
  Comments, Account sections — are full width inside `PageLayout`'s
  symmetric, screen-growing margins, so they're centered horizontally
  and stretch with the screen (spec `02 - redifine Document UI`), with
  padding growing `md` → `lg` → `xl`. Use `PageCard` rather than
  repeating the `Card` props.
- **Account page** (`/account`, `pages/AccountPage.tsx`): page title +
  one-line subtitle, then titled `PageCard`s (`AccountSection`),
  centered and full width like the Document page (changed 2026-09-22;
  it was a 720px left-aligned column). "Profilo": `AvatarEditor` (200px
  avatar centered, with "Carica foto", "Da URL" popover, "Rimuovi" in a
  centered row under it and the format hint below — each applies
  immediately; changed 2026-10-07) and `ProfileForm` (Nome visualizzato, Pronomi,
  Descrizione with a character counter; "Annulla modifiche" / "Salva
  profilo" enabled only when the form is dirty, success toast on
  save). From `md` up the avatar is a left column (4/12)
  beside the form, so fields don't stretch across the whole card; below
  `md` they stack with a divider. "Accesso": the account email,
  read-only, with a generic envelope and provider-neutral description
  (and a placeholder when the account shared no email), with the sign-out row ("Esci", outline, not red — signing
  out isn't destructive) beside it from `md` up, below it on phones.
- **Showing a user**: always `UserAvatar user={…}` (photo, or initials
  of their display name/email) plus `userDisplayName` — never an email
  directly. The members table adds pronouns and a 2-line-clamped
  description under the name; Owner badges carry a 16px avatar.
- **Showing a Character** (spec 17_2): `CharacterAvatar` (the Document's
  leading image or its initials) is a **rounded square** (`md` radius),
  never a circle, so it can't be mistaken for a person. A Comment written
  in character leads with it and the Character's name (accent link to the
  Document), then "interpretato da {author}" in small dimmed text with a
  16px `UserAvatar`. "Interpretato da" on the detail page is the first row
  of the info panel, above the Owners (see Document detail); the Document card adds a "Played by" line
  with a 20px avatar above the Owners line.
- **Room view**: left sidebar for navigation (Tags, Glossary, Members),
  center column for the Document list or an open Document, right
  panel (collapsible) for the Document's Thread when a Document is
  open — so reading a Document and following its discussion never
  requires a full page navigation.
- **Document detail**: description at the top, Tags and Owner(s)
  directly under the title, Details rendered as a distinct,
  visually lighter list of titled entries above the general Comment
  thread (Details and Comments are both Posts, but Details are
  visually promoted so they read like structured facts, not chat).
  **Images sit beside the text on big screens** (2026-09-25, spec 10,
  mirroring `DocumentCard`'s side-by-side layout): `DocumentImageGallery`
  sits on the right at 45% width from `lg`; below `lg` it stacks, image
  block (and the info panel under it) last. **From `lg` the image floats and the text wraps around it**
  (2026-10-03, Andrea: the space under the image was too empty): once the
  description and Notes are past the image they take the full width. The
  `.document-body*` classes in `index.css` do it; since a flex box beside a
  float shrinks as a whole instead of wrapping, the description, Note list
  and Note blocks become `display: block` from `lg`, their gaps turned into
  margins. The
  gallery gained the same orientation-aware framing as `DocumentCardImages`
  (spec 07.1, shared via `lib/images.ts::imageFrameSize`), so a portrait
  image isn't stretched into the fixed-height box's full width. Its
  delete/favorite controls and the fullscreen viewer are unchanged.
  **Info panel** (2026-10-03, Andrea chose option A of a mockup: the
  Played by, Owner and PDF sections were heavy, always-open forms at the
  bottom of the page): a bordered `Paper` under the gallery, in the same
  `.document-body-aside` box, holds one `InfoRow` per item
  (`DocumentInfoRow.tsx`: a 104px dimmed label, then its value). Played by
  and the Owners are `PersonChip`s (outline pill, 16px avatar, an ✕ to
  remove for whoever may), and adding opens a small `AddPopover` from a
  dashed "+" instead of a form always on screen (its `Select` keeps the
  combobox out of a portal, or picking an option would close the popover).
  Under a `Divider` the PDFs follow as compact rows (accent PDF icon, name,
  size with the date as tooltip, open/download/delete icons) with a subtle
  "Carica PDF" button; with no PDFs the row is hidden for a reader and
  shows only the button to an Owner. **Without images** the panel takes the
  image's place on the right, narrower (`data-narrow`: 340px from `lg`), so
  the information is always in the same spot and the text wraps beside it.
  **Deleting the Document** (2026-09-25, spec 10) is an Owner-only action
  offered in edit mode: an outlined red "Elimina Documento" button next to
  Save/Cancel opens a centered `Modal` (unlike a gallery image's small
  Popover — deleting the whole Document is heavier: its Comments and images
  go with it) naming what's lost, with `Annulla` / a red `Elimina` to
  confirm. On success the page navigates back to the Documents list, since
  the Document it was showing no longer exists.
- **Thread / Posts**: nested replies indent up to the FR-T2 depth
  limit, then flatten with a "continue thread" link; each post shows
  a compact visibility indicator (see `VisibilityBadge` above).
- **Comments** (built 2026-09-21, `components/comments/`): a separate
  card *below* the Document card on the detail page (the right-panel
  layout above is not built yet). Social-media style: `UserAvatar`
  (initials, accent light) + a **full-width** bubble (it stretches to
  the row even for a one-word Comment) on `--bg-raised` with
  `--border-default` and `md` radius holding the author's name, a
  `VisibilityBadge` (size `xs`, omitted for "Room") and the text; under
  it a muted meta line (relative time, "Edited", text actions
  "Edit"/"Delete" that turn `--accent-strong` on hover). Reactions (spec
  19c) sit between the bubble and the meta line as round `compact-xs`
  chips, "emoji count", `light` when the viewer reacted and `default`
  otherwise; their tooltip (hover, focus or long press) lists who
  reacted. A subtle 16px `Smiley` icon button in the meta line opens
  emoji-mart's picker (dark theme, search with skin tones, no preview)
  in a popover with no padding; it's gone once a Comment has 20
  different emoji, and a deleted placeholder shows neither. Pin and
  resolve (spec 19c) are more text actions in the meta line ("Fissa"/"Togli
  dai fissati", "Segna come risolto"/"Riapri"), shown only when the
  backend's `canPin`/`canResolve` allow them. Pinned Comments sit first in
  a section of their own, headed by a small filled accent `PushPin` and an
  uppercase dimmed "Commenti fissati" label, with a `Divider` before the
  rest; each carries a `light` accent `xs` "Fissato" badge with a pin icon.
  A resolved branch shows its top-level Comment with a `light` gray `xs`
  "Risolto" badge (a `CheckCircle` in `--state-success`, tooltip naming who
  resolved it and when) and starts with its replies collapsed. Promotion
  (spec 19c) is a "Promuovi" text action opening a `Menu` ("Nella
  descrizione", "In un nuovo Documento"), shown when `canPromote` allows
  it; a promoted Comment carries a `light` accent `xs` "Promosso" badge
  (`ArrowFatLineUp`, tooltip saying where and when), a link to the new
  Document when the viewer sees it. Promoting into the description opens
  the Document's editor, scrolled into view, with an accent `light` `Alert`
  explaining the appended text; into a new Document opens a centered modal
  with the creation form and the Comment's images as checkboxes with 40px
  thumbnails. A promotion that would show the text to more people asks
  first in a centered modal naming them, its confirm button orange
  ("Promuovi comunque"). Attached
  images show inside the bubble as 120px square thumbnails
  (`ImageThumbnailGrid`, `sm` radius) that open the shared fullscreen
  `ImageViewerModal`. Sort/filter controls (`CommentToolbar`) sit above
  the list; the **composer is at the bottom**, below the list (changed
  2026-09-21, spec `04 - Refactor of Comments`). The composer attaches
  images through two subtle icon buttons (`ImageAttachButtons`: file
  picker, URL popover) and previews them as removable 72px thumbnails
  before posting. Deletion confirms in a small popover, like image
  deletion, and warns when the Comment's images will go too.
- **Mentions** (built 2026-09-22, `components/mentions/`, specs
  `06 - Quick navigation` and `06_1 - Quick navigation refnment`):
  wherever a user writes free text (Document description, Comment body)
  use `MentionTextarea` instead of Mantine's `Textarea`. Typing `#` at
  the start of a word opens a list below the field (flips above when
  there's no room), as wide as the field, on the Popover surface: up to 8
  of the Room's Documents **and Tags**, filtered as you type (case- and
  accent-insensitive). A Document row has a 16px `FileText` icon, its
  name and its Tags (`#Tag`, muted); a Tag row has a `Tag` icon, its name
  and "Tag · N Documenti". Arrows move the highlight
  (`--mantine-color-accent-light` background, wraps around), Enter/Tab or
  a click inserts `#Name `, Esc closes; Ctrl/Cmd+Enter still submits a
  Comment. No open/close animation, like Mantine's Combobox.
  **When nothing matches** and the viewer may create something, the list
  is replaced by a create row: "No results for “name”. Create
  it as:", a two-button switch (Document / Tag — `light` = chosen,
  `default` = other; only shown when both are allowed) and a "Create …"
  button (`light`, `filled` when the row is highlighted). A plain Enter
  never creates: the row is reached with ↓, then ←/→ switch the kind and
  Enter creates (a hint line says so). The switch is plain buttons, not a
  `SegmentedControl`, whose radio inputs would take the focus and close
  the popup.
  Wherever that text is shown, use `MentionText`: mentions become links
  in `--accent-primary` (the whole `#Name`, underline on hover) — a
  Document mention opens the Document, a Tag mention opens the Documents
  list filtered by that Tag. Inside something that is already a link
  (`DocumentCard`) pass `linked={false}`: same color, no link. Both need
  a `DocumentMentionsProvider roomId={…} currentUserId={…}` above them
  (the Document page and the Documents list have one); without it they
  behave as a plain textarea / plain text.
  **`@` members** (2026-10-02, spec 19c, Comments only): pass `members`
  to `MentionTextarea` and `MentionText`. Typing `@` at the start of a
  word opens the same list with the Room's members ("Membri da
  menzionare"): an 18px avatar and the shown name, no detail line, never
  a create row. Picking one shows `@Name ` in the field and stores
  `@[Name](user:<uuid>)`; the field never shows the token syntax, and
  editing inside a mentioned name turns it back into plain text. In the
  rendered body a member's mention is `@` + their current name in
  `--accent-primary`, weight 600, not a link; a mention of someone who has
  left the Room is plain text with the name as written.
  **Tokens and "Mentioned in"** (2026-10-03, spec 20): a picked or
  created Document or Tag still shows as `#Name ` in the field but is
  stored with its id, so `MentionText` shows the target's current name;
  a hidden or deleted target is plain text with the name as written.
  `Backlinks` ("Menzionato in") is a `PageCard` with a caret toggle, the
  title (`h3` size, display font) and a gray `light` count badge, starting
  expanded and absent while empty. Per source Document: its name as an
  `--accent-primary` link, weight 600; under it, one entry per place with
  a 2px `--border-default` left rule: an `xs` dimmed link saying where
  ("Nella descrizione", "Nella nota «…»", "In un commento di …", the last
  one jumping to the Comment) and the `sm` excerpt. On the Document page it
  sits between the Document card and the Comments; on the Documents list,
  when exactly one Tag is filtered, above the Documents.
- **Document card** (`DocumentCard`, restructured 2026-09-23, spec
  `07 - Document visualizazion refactor_beckend`; image panel restyled
  2026-10-03): three stacked blocks. The *Title block* is the Document name
  (display font) with its `VisibilityBadge` on the same row (spec 19b's
  unread count, a red pill, just before it; the "not yet read" dot sits
  *inside* the badge, before its label, via `VisibilityBadge`'s
  `leftSection`, Andrea's mockup of 2026-10-03), and the Tags on a line of
  their own below (`TagList`). Under it the
  description, then the Played by and Owner lines, each on a line of its
  own; a Document without a description says "No description.", clamped to
  2 lines without images.
  **With images** the card changes shape (prototype from Andrea,
  2026-10-03): the images fill the card's **right half edge to edge and full
  height** (absolutely positioned, `objectFit: cover` anchored at the top so
  a portrait's face survives the crop), and their left edge fades into the
  card's background (a `linear-gradient` from `--mantine-color-dark-6`, the
  Card surface, to transparent over the first 35%). The badges move out of
  the title row and sit over the image at the top right; the text column
  takes the left half, the description grows (5 clamped lines) so the
  Played by and Owner lines close the card at the bottom, and the card is at
  least 220px tall (260px from `sm`). **The image panel is never wider than
  it is tall** (2026-10-03, Andrea's feedback on wide screens): with images
  the card is a flex row and an empty, `aria-hidden` square sits under the
  panel (`aspectRatio: 1`), so a wide card grows taller instead of cropping
  its image to a strip. This replaces spec 07.1's uncropped,
  orientation-framed images on the card; the detail page gallery still
  frames by orientation (`imageFrameSize`).
  The images are `DocumentCardImages`: one image alone, several in the same
  carousel as the detail page, read-only, favorite first. Dragging is off
  and the arrows stay visible rather than appearing on hover, since a touch
  screen has no hover.
  **The card's link covers the card instead of wrapping it** — an absolutely
  positioned `Link` as the last child, at `zIndex: 1`. An `<a>` may not
  contain the carousel's buttons, so those come back on top at `zIndex: 2`
  (`controls`/`indicators` in the Carousel's `styles`). Clicking anywhere
  else, images included, opens the Document.
  **Every Tag in the Title block's `TagList` is itself a link** (2026-09-25,
  spec 10), to the Documents list filtered by it (`documentsWithTagsHref`,
  the same target a `#Tag` mention leads to) — `TagList` takes an optional
  `roomId`, passed by `DocumentCard` and, since 2026-10-03 (Andrea's
  request), by the Document detail page too. Needs the same
  `zIndex: 2` treatment as the carousel controls above, since it sits above
  the card's overlay link too.
- **Room card image** (`RoomCard`, 2026-10-07, spec 26): a Room with an
  image shows it on the card's right half through `DocumentCardImages`,
  cropped and fading into the card like a Document card's, with the card at
  least 160px (180px from `sm`) tall. The setup, invite and menu buttons sit
  on a `--bg-base` backing so they stay readable on a light image.
- **Documents list Tag filter** (`TagFilter`, 2026-09-22): a searchable,
  clearable `MultiSelect` with a `Funnel` icon above the grid (max 480px
  from `sm` up), options shown as `#Tag`. It is bound to the URL
  (`?tag=…`, repeatable, Tags combine with AND), which is where a Tag
  mention leads. No match: "No Documents with this Tag." plus a
  "Show all" button. **Always one line** (2026-09-30, spec
  `11_1 - UI UX Refinment`): the first two selected Tags show as pills
  (`MAX_DISPLAYED_TAGS`) and the rest collapse into a "+N" pill; the pill row
  is `nowrap` with hidden overflow, so the control keeps its height. Mantine
  9's `MultiSelect` has no `maxDisplayedValues` (only `TreeSelect` does), so
  it's done with `renderPill`; the filter still holds every selected Tag.
- **Grouping and sorting** (2026-09-25, spec `10 - UX Refinment`): next to
  `TagFilter`, two more `Select`s — "Group by" (Main Tag /
  none) and "Sort by" (Name A-Z / Z-A) — also URL-bound (`?groupBy=`,
  `?sort=`, both hidden with the filter when the Room has no Documents).
  Grouped by Main item (the Tags and Tag combinations an Administrator chose
  on the Room setup page, in the order they gave them — specs 11, 11_2) is
  the default: each group gets its own
  `Title` (`#TagName`, `#A + #B` for a combination, or "No Main Tag" for Documents carrying
  none) above its own grid of cards; a Document with several Main Tags
  appears under each one. "No grouping" collapses back to the
  single flat grid spec 07 already had.
  **Page title and controls** (2026-10-03, Andrea): the `h1` is just the
  Room's name (no "Documents —"); the row of filters and settings under it
  **starts collapsed** (the caret beside the title opens it), except when the
  page opens already filtered by `?tag=`, where it starts open so the active
  filter shows. **Creating a Document** is a round floating "+" at the bottom
  right (`Affix`, 56px filled `ActionIcon`, `aria-label` "Create Document"),
  with a 64px spacer under the list so it never covers the last cards.
  **The Room's actions sit at the end of the title row** (same day, Andrea):
  `RoomTitleActions` shows the Room card's actions — setup and invite for
  an Administrator, leave for everyone — folded into a "⋮" (`aria-expanded`)
  that unfolds them inline to its left when clicked, and folds them back on a
  second click. Leaving from there takes the user back to their Rooms
  (`LeaveRoomModal`'s `onLeft`).
  **The card grid** is `.documents-grid` in `index.css` (2026-10-03): 1, 2
  and 3 columns from `base`, `sm` and `lg` like the Rooms list, then 4 from
  1920px, 5 from 2560px and 6 from 3200px, so a card stays a sensible size
  on a very wide monitor.
  **Each group collapses independently** (2026-09-26): its `Title` wraps a
  clickable row (a `CaretDownIcon`/`CaretRightIcon` at 16px, then the
  label) that toggles a Mantine `Collapse` around that group's grid —
  `aria-expanded` on the button reflects the state. Every group starts
  expanded; collapsing one doesn't affect the others, and the state isn't
  persisted (a reload starts fresh).
- **Glossary Index** (`GlossaryIndexDrawer`, 2026-09-25, spec 10; Main items
  2026-10-01, spec 11_3): a left-anchored Mantine `Drawer`, toggled by a
  `Burger` on the left of `AppHeader`, after the back arrow — shown
  only on a Room-scoped page (`PageLayout`'s `roomId` prop). It opens with
  "Tag principali": the Room's Main items — single Tags and Tag combinations
  (`#A + #B`) — **in exactly the order the Documents page groups by**; both
  read the same `useMainItems` list through `resolveMainItems`, so they can't
  diverge, and saving on the Room setup page updates the index without a
  reload. Then the other Tags by category (alphabetical), uncategorized under
  "Altri Tag". A Tag that is a single Main item is listed only under
  "Tag principali". Each entry links to the Documents list filtered by its
  Tag, or by all the Tags of a combination — the same destination a `#Tag`
  mention leads to, and the same Documents its group holds. Not the Glossary
  entity from `requirements.md` (FR-N3/FR-N4, terms with their own
  definitions) — that remains unbuilt; this is a navigational index over
  Tags, a deliberate scope decision for this spec.
- **Room search** (`components/search/`, 2026-10-05, spec 21): on every
  Room page the top bar's right side starts with the search: from `md` a
  `default` Button "Cerca" with a `Kbd` showing `Ctrl K` (`⌘ K` on Apple
  devices), below `md` a magnifier `ActionIcon`. It opens a `Modal` ("Cerca
  nella Stanza", full screen below `sm`) with the query field, a row of
  `Chip`s for the kind (Tutto, Documenti, Note, Commenti, Tag) and a Tag
  `MultiSelect`. Results are grouped under small uppercase dimmed labels,
  each with its kind's Phosphor icon, the title in `sm` semibold, where it
  sits ("in <Documento>", "Commento su <Documento>") and a two-line `xs`
  excerpt; matched words are `<mark>`s in `--accent-strong` semibold on no
  background (`.search-match`). The active result (arrows or hover) has the
  accent's light background, like a mention suggestion. A Note or Comment
  reached through its anchor fades from that same light background
  (`.anchor-flash`, instant with reduced motion).
- **Favorite image** (`DocumentImageGallery`, 2026-09-23, spec 07): an Owner
  picks the image that leads the Document — and so its card — with a heart
  `ActionIcon` at the **bottom right of the image itself**, opposite the
  delete button at the top right. Filled and `--accent-primary` when it's the
  favorite, `regular` weight otherwise; the current favorite's button is
  disabled (`aria-pressed`), so the heart reads as a state, not just a
  button. Unlike deleting, it asks for no confirmation — picking a different
  image undoes it — and it is not gated on edit mode, only on being an Owner.
- **Modals**: centered overlay with backdrop blur, used for Room
  creation, invitations, and the Reveal confirmation (Reveal is
  destructive/irreversible in effect, so it always confirms in a
  modal, styled with `--state-warning`, never the default accent).
- **Empty states**: illustrated with a single large Phosphor
  duotone icon in `--text-muted`, not a stock illustration.

## Language

The UI is in **Italian and English** (spec 09; see `architecture.md` →
UI Language). The browser locale picks the language (English for
anything that isn't Italian), and the flag selector in the top bar
overrides it for good. Terminology is the spec's in both languages:
Room/Stanza, Document/Documento, Tag, Owner, Master, Player,
Comment/Commento (English/Italian). UI strings quoted in this file are the
English ones; the Italian text is in `it.json` under the same keys. Roles
and "Owner" stay English in Italian too, as
before. The sign-in screen has no top bar, so a signed-out visitor
sees the browser's language.

## Icons

**Phosphor Icons**, `regular` weight for inline/UI icons at 16px
(`size={16}`), `bold` weight for standalone action icons at 20px
(`size={20}`), `duotone` weight reserved for empty states and
onboarding at 32px+. Icon color always follows `--text-muted` at
rest and `--accent-primary` on hover/active — never a hardcoded
color per icon.

## Room setup page (spec 11)

`/rooms/:roomId/setup` (`RoomSetupPage`, 2026-09-30), opened from the
"Impostazioni" button on a `RoomCard`. The button, and the page, are for
Administrators of that Room only; anyone else who reaches the URL gets a
full-page "Solo un Amministratore…" message with a way back (the backend
enforces the same on every write). It has two sections under a `Title`
order 2, each with an order-3 `Title`:

- **Membri** (`setup/MemberManagement`): the table that used to be the
  members page — avatar, name, pronouns, bio, role `Select`, Administrator
  `Switch`, Remove/Leave. Every control is offered, since the page is
  Administrator-only.
- **Tag** (`setup/TagsSection`, spec 25c, 2026-10-07; it replaced the
  separate "Tag principali" editor, its combination adder and "Salva ordine",
  and the boxed Tag list): one section, two bordered `Paper` parts side by
  side from `lg` (Grouping 5/12, All Tags 7/12), stacked below. Each part has
  an `h3` (`fz="h5"`), a gray count `Badge` and a one-line dimmed description.
  - **Raggruppamento** (`GroupingEditor`): the Main items as a `CompactList`
    `ol` (position, `#A` or `#A + #B`, up / down / remove `ActionIcon`s
    `sm`), at most 640px wide so the actions stay near the names. **Every
    change saves at once** (no "Salva ordine", no toast): `useSetMainItems`
    updates the cache optimistically, runs the saves one at a time (mutation
    `scope`) and on failure puts the list back and shows the error. Items hold
    Tag ids and resolve names from the Tags, so a rename shows at once.
    Reordering is buttons, not drag and drop. One field adds an item
    (`GroupAdder`): a searchable `MultiSelect` + "Aggiungi"; one Tag is a Main
    Tag, two or more a combination (spec 11_2); a set already listed (any
    order) disables "Aggiungi" with the reason in red under the field.
  - **Tutti i Tag** (`AllTagsList`, `TagRow`): a "Filtra i Tag" field (accent
    and case insensitive, like the mention popup) and a "Nuovo Tag" field
    (Enter or its "+", a refused name shown as the field's error), then every
    Tag alphabetically in a `CompactList` laid out in columns of at least
    240px: `#Name`, the category dimmed, a `Stack` icon (tooltip "Nel
    raggruppamento") when the Grouping uses it, then Rename (pencil) and
    Delete (trash). Rename turns the row into a prefilled, selected
    `TextInput` (Enter or check saves, Esc or X cancels, a 409/422 shows
    under the field), one row at a time. Delete keeps spec 13's confirmation
    `Modal`.

**`CompactList`** (`components/CompactList.tsx`, spec 25 Decision 3, built
with 25c): one bordered `md` box with thin `--border-default` dividers between
~36px rows (`CompactListItem`: leading, label, actions right after the label
or, with `actionsAtEnd`, at the row's end); `columnWidth` lays the rows out in
a grid of as many columns as fit. Rows highlight `--bg-raised` on hover.

## Friends (spec 18_2)

- **Account page**: "Inviti alle Stanze" (only while some wait) comes
  right after the page title, "Amici" after "Profilo". Each person is a
  `FriendRow`: `md` avatar, name, pronouns or a detail line, the email only
  when the backend sends it, buttons on the right (wrapping under on
  narrow screens). Accept is `filled` `xs`, Decline and Cancel are
  `subtle` gray, Remove is `subtle` red and confirms in a small popover.
  The friend link is a read-only `TextInput` with a copy `ActionIcon`
  and a `default` "Rigenera" button.
- **Setup member table**: under a member's details, a `compact-xs`
  `light` "Aggiungi agli amici" button, or a `xs` `light` badge (accent for
  "Amico", gray for a pending request).
- **Invite modal**: `Tabs` "Link" | "Amici" (Phosphor icons); the Friends
  tab has a searchable Friend `Select`, the role `Select` and "Invia invito".
- **Friend link page** (`/friends/add/:code`): full-page and centered like
  the invite page, with buttons to the Account page and the Rooms list.

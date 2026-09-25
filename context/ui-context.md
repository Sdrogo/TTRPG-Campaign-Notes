# UI Context

## Theme

Dark only, no light mode. Gothic/vampiric technical workspace: a
near-black backdrop with a cold purple undertone, layered surfaces
that read like parchment under candlelight gone digital, and a
single vivid violet accent for anything interactive. The mood is
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
| Primary accent       | `--accent-primary`   | `#9333ea` |
| Accent hover/active  | `--accent-strong`    | `#a855f7` |
| Border               | `--border-default`   | `#2a2230` |
| Error                | `--state-error`      | `#dc2626` |
| Success              | `--state-success`    | `#4f9c6c` |
| Warning (Reveal / destructive‑adjacent actions) | `--state-warning` | `#c2820a` |

Notes:
- `--accent-primary` is reserved for interactive elements (links,
  primary buttons, active tab, focus ring) — never used decoratively
  on large surfaces.
- `--state-error` doubles as the "blood red" the theme calls for; do
  not introduce a second red. It is also used for destructive
  actions (delete Document, remove member).
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
fonts, radius, `primaryColor: 'violet'` mapped to the accent shades)
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
  `AppHeader` component — app name on the left (links to the Rooms
  list), the current user's circular avatar on the right
  (`AccountButton`, 36px, thin `--border-default` ring that turns
  `--accent-primary` on hover/focus and while on `/account`). It is
  rendered by `HomePage` and by `PageLayout`, so every signed-in page
  has it. The account avatar is the only way to the Account page and
  to sign out. **Just before the avatar** (spec 09) is the
  `LanguageSelector`: the current language's flag (24×16, `sm` radius,
  thin `--border-default` edge) inside a 4px padded button whose
  transparent ring turns `--accent-primary` on hover/focus and while its
  menu is open. It opens a Mantine `Menu` (`bottom-end`): one item per
  language with a 20px flag and the language's **own** name ("Italiano",
  "English"), so it can be found whatever language the UI is in, and a
  check mark on the current one. Its tooltip ("Cambia lingua" / "Change
  language") is hidden while the menu is open, so it doesn't cover the
  first item.
- **Sign-in screen** (`HomePage`, signed out; spec 08): centered book
  icon, title, "Accedi per continuare.", then one full-width button per
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
  it was a 720px left-aligned column). "Profilo": `AvatarEditor` (112px
  avatar; "Carica foto", "Da URL" popover, "Rimuovi" — each applies
  immediately) and `ProfileForm` (Nome visualizzato, Pronomi,
  Descrizione with a character counter; "Annulla modifiche" / "Salva
  profilo" enabled only when the form is dirty, success toast on
  save). From `md` up the avatar is a left column (4/12, 3/12 at `lg`)
  beside the form, so fields don't stretch across the whole card; below
  `md` they stack with a divider. "Accesso": the account email,
  read-only, with a generic envelope and provider-neutral description
  (and a placeholder when the account shared no email), with the sign-out row ("Esci", outline, not red — signing
  out isn't destructive) beside it from `md` up, below it on phones.
- **Showing a user**: always `UserAvatar user={…}` (photo, or initials
  of their display name/email) plus `userDisplayName` — never an email
  directly. The members table adds pronouns and a 2-line-clamped
  description under the name; Owner badges carry a 16px avatar.
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
  mirroring `DocumentCard`'s side-by-side layout): a `Flex` with
  `direction={{ base: 'column', lg: 'row' }}` puts the description/edit
  form on the left and `DocumentImageGallery` on the right at ~45% width
  from `lg`; below `lg` it stacks, image block last, as before. The
  gallery gained the same orientation-aware framing as `DocumentCardImages`
  (spec 07.1, shared via `lib/images.ts::imageFrameSize`), so a portrait
  image isn't stretched into the fixed-height box's full width. Its
  delete/favorite controls and the fullscreen viewer are unchanged.
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
  `VisibilityBadge` (size `xs`, omitted for "Stanza") and the text; under
  it a muted meta line (relative time, "Modificato", text actions
  "Modifica"/"Elimina" that turn `--accent-strong` on hover). Attached
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
  is replaced by a create row: "Nessun risultato per «name». Crealo
  come:", a two-button switch (Documento / Tag — `light` = chosen,
  `default` = other; only shown when both are allowed) and a "Crea …"
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
- **Document card** (`DocumentCard`, restructured 2026-09-23, spec
  `07 - Document visualizazion refactor_beckend`): three stacked blocks. The
  *Title block* is the Document name (display font) with its
  `VisibilityBadge` on the same row, and the Tags on a line of their own
  below (`TagList`). Under it, description and images sit side by side: the
  description on the left, the image block on the right at **half the card's
  width** (`flex: 0 0 50%`), lifted to 5 clamped lines when there are images
  so the two columns balance; with no images the description takes the whole
  row, and a Document without one says "Nessuna descrizione.". The Owner line
  closes the card on a line of its own.
  The images are `DocumentCardImages`: the same carousel as the detail page
  but read-only and short (at most 160px, 200px from `sm`), favorite first.
  **Each image keeps its own aspect ratio** (spec 07.1): once it has loaded,
  its natural size decides its frame (`imageOrientation` in `lib/images.ts`)
  — a landscape (or square) image fills the column's width, a portrait one
  the full height, centered — with `objectFit: contain`, so nothing is
  cropped. Before load it holds a full-size `--bg-base` placeholder. Slides
  of one carousel are framed independently. Dragging is off and the arrows stay visible rather than
  appearing on hover, since a touch screen has no hover.
  **The card's link covers the card instead of wrapping it** — an absolutely
  positioned `Link` as the last child, at `zIndex: 1`. An `<a>` may not
  contain the carousel's buttons, so those come back on top at `zIndex: 2`
  (`controls`/`indicators` in the Carousel's `styles`). Clicking anywhere
  else, images included, opens the Document.
  **Every Tag in the Title block's `TagList` is itself a link** (2026-09-25,
  spec 10), to the Documents list filtered by it (`documentsWithTagsHref`,
  the same target a `#Tag` mention leads to) — `TagList` takes an optional
  `roomId` that only `DocumentCard` passes (the Document detail page's
  `TagList` stays plain, per the spec's own scope). Needs the same
  `zIndex: 2` treatment as the carousel controls above, since it sits above
  the card's overlay link too.
- **Documents list Tag filter** (`TagFilter`, 2026-09-22): a searchable,
  clearable `MultiSelect` with a `Funnel` icon above the grid (max 480px
  from `sm` up), options shown as `#Tag`. It is bound to the URL
  (`?tag=…`, repeatable, Tags combine with AND), which is where a Tag
  mention leads. No match: "Nessun Documento con questo Tag." plus a
  "Mostra tutti" button.
- **Grouping and sorting** (2026-09-25, spec `10 - UX Refinment`): next to
  `TagFilter`, two more `Select`s — "Raggruppa per" (Tag principale /
  nessuno) and "Ordina per" (Nome A-Z / Z-A) — also URL-bound (`?groupBy=`,
  `?sort=`, both hidden with the filter when the Room has no Documents).
  Grouped by Main Tag (a Tag whose category is `"Type"` — the category the
  seeded default Tags share) is the default: each group gets its own
  `Title` (`#TagName`, or "Senza Tag principale" for Documents carrying
  none) above its own `SimpleGrid`; a Document with several Main Tags
  appears under each one. "Nessun raggruppamento" collapses back to the
  single flat grid spec 07 already had.
- **Glossary Index** (`GlossaryIndexDrawer`, 2026-09-25, spec 10): a
  left-anchored Mantine `Drawer`, toggled by a `Burger` on the right of
  `AppHeader` (next to the account avatar) — shown only on a Room-scoped
  page (`PageLayout`'s `roomId` prop). Lists every Tag in the Room, grouped
  by category exactly like the grouping control above (Main Tags first
  under "Tag principali", then other categories by name, then uncategorized
  under "Altri Tag"), each one linking to the Documents list filtered by
  it — the same destination a `#Tag` mention already leads to. Not the
  Glossary entity from `requirements.md` (FR-N3/FR-N4, terms with their own
  definitions) — that remains unbuilt; this is a navigational index over
  Tags, a deliberate scope decision for this spec.
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
Comment/Commento. Roles and "Owner" stay English in Italian too, as
before. The sign-in screen has no top bar, so a signed-out visitor
sees the browser's language.

## Icons

**Phosphor Icons**, `regular` weight for inline/UI icons at 16px
(`size={16}`), `bold` weight for standalone action icons at 20px
(`size={20}`), `duotone` weight reserved for empty states and
onboarding at 32px+. Icon color always follows `--text-muted` at
rest and `--accent-primary` on hover/active — never a hardcoded
color per icon.

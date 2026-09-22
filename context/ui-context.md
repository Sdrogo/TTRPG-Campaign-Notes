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
  component code.

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
  to sign out.
- **Account page** (`/account`, `pages/AccountPage.tsx`): standard
  settings layout — page title + one-line subtitle, then a narrow
  column (max 720px, left-aligned under the back link) of titled cards
  (`AccountSection`). "Profilo": `AvatarEditor` (112px avatar;
  "Carica foto", "Da URL" popover, "Rimuovi" — each applies
  immediately) above `ProfileForm` (Nome visualizzato, Pronomi,
  Descrizione with a character counter; "Annulla modifiche" / "Salva
  profilo" enabled only when the form is dirty, success toast on
  save). "Accesso": the Google email, read-only, and a sign-out row
  ("Esci", outline, not red — signing out isn't destructive).
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
- **Modals**: centered overlay with backdrop blur, used for Room
  creation, invitations, and the Reveal confirmation (Reveal is
  destructive/irreversible in effect, so it always confirms in a
  modal, styled with `--state-warning`, never the default accent).
- **Empty states**: illustrated with a single large Phosphor
  duotone icon in `--text-muted`, not a stock illustration.

## Icons

**Phosphor Icons**, `regular` weight for inline/UI icons at 16px
(`size={16}`), `bold` weight for standalone action icons at 20px
(`size={20}`), `duotone` weight reserved for empty states and
onboarding at 32px+. Icon color always follows `--text-muted` at
rest and `--accent-primary` on hover/active — never a hardcoded
color per icon.

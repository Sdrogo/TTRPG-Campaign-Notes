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
  using Mantine's `AppShell`.
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

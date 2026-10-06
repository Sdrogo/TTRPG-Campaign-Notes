## Goals

- Product owner's request (2026-10-06): "a more compact, less dispersive design overall". Seen on a 3440px screen (Account and Room setup screenshots of 2026-10-06): rows and fields stretch across the whole width, actions end up far from what they act on ("Remove" two thousand pixels right of the member's name), and every list item is a tall boxed row.
- This ticket sets the **density rules once**, in the theme and in the shared layout components, and applies them to every page. Feature 25 continues with **25b** (Account page cards) and **25c** (Room setup Tags section and Tag rename), which build on these rules; do them in that order (feature by feature).
- Frontend only. No new dependency, no change to colors, fonts or the radius scale (`ui-context.md`).

## Decisions (proposed, confirm in the PR)

1. **Smaller default control size on dense pages.** Inputs, Selects and Buttons default to Mantine `sm` (today `md` for most fields); `xs` for buttons inside a list row. The Document page's reading text keeps its size: compactness is about chrome, not content.
2. **Tighter vertical rhythm.** The page stack (`PageLayout`) goes from `md` to `sm` between blocks; a section's title and its one-line description stay `gap={2}`; a section's content `sm`. `PageCard` padding becomes `sm` → `md` → `lg` (today `md` → `lg` → `xl`).
3. **Lists are rows, not boxes.** A list of simple items (Tags, Main items, members, friends, PDFs) is one bordered container with thin dividers between rows (Mantine `Table` or a `Stack` with `Divider`s), each row about 36px tall, instead of one bordered `Paper` per item with its own padding. One shared component for it (below).
4. **Actions stay next to what they act on.** A row's actions sit right after its content on narrow rows, and a row never grows wider than its content needs: on wide screens a list is laid out in **columns** (CSS grid, `repeat(auto-fill, minmax(320px, 1fr))` or similar) rather than one full-width column. A table sizes its columns to their content and leaves the spare width at the end, not between the name and its button.
5. **Forms don't stretch.** A text field is never wider than about 640px (`maw`), except the free-text ones that are the page's content (Document description, Notes, Comments). Wide screens use the spare width for a second column of sections, not for longer fields (see 25b).
6. **The product owner's earlier width decisions stand**: pages stay full width inside `PageLayout`'s margins (spec 02, Account page 2026-09-22); this ticket uses the width with columns instead of capping the page.

## Design

- **Theme** (`frontend/src/theme/theme.ts`): set `components` defaults for `TextInput`, `Textarea`, `Select`, `MultiSelect`, `Button`, `ActionIcon`, `SegmentedControl`, `Switch` and `Table` (`size: 'sm'`, `Table` `verticalSpacing: 'xs'`). Check every place that passes an explicit `size` still looks intended; the floating "+" (56px) and the header's 36px avatar are deliberate and stay.
- **Layout**: `PageLayout` stack `gap="sm"`, `py="sm"`; `PageCard` padding as in Decision 2.
- **`CompactList`** (new, `components/CompactList.tsx`): a bordered `md`-radius container rendering `items` as rows separated by `--border-default` dividers, with an optional `columns` mode (Decision 4) for wide screens. Each row: leading content (avatar, icon or position), main text (truncated with a tooltip, never wrapping into three lines), trailing actions (`Group gap={4}`, `xs`/`sm` sizes). Keyboard order and accessible names unchanged; `ul`/`ol` semantics kept (`component` prop).
- **Apply it** where lists are boxed today: the Room setup's members table (column widths, actions next to the toggle), the Main items and Tag lists (25c replaces them anyway: only make sure they don't break), Friends and Room invitations (25b), the Document page's PDF rows and the visibility history table. Rooms page and Document cards are already card grids: only the gaps change.
- **Section headings** inside a page (`h2` at `fz="h3"`) drop to `fz="h4"` on the setup and Account pages, so a section title no longer reads as a page title.
- **`ui-context.md`**: add a "Density" section with the rules above (control sizes, rhythm, lists as rows, columns on wide screens, field max width) and update the entries this changes (Page cards, Room setup page).

## Implementation

- **25_1** frontend, one PR into `staging`, branch from `origin/staging`.
- Snapshot-free tests: where a test asserts a size or a `Paper` per row, update it to the new structure; add tests for `CompactList` (renders rows, `ol` keeps order, actions have accessible names, columns mode).
- Look at it at 375px, 1280px and 3440px wide (headless screenshots of the Account, Room setup, Rooms, Documents and Document pages before and after, attached to the PR).

## Definition of Done

- On a 3440px screen, no row on the Account or Room setup page has its action more than one column's width away from its label, and no form field is wider than about 640px.
- On a phone (375px) nothing is cut or overlaps; tap targets stay at least 24px (WCAG 2.5.8, `ui-context.md`).
- The Documents and Document pages look the same apart from the tighter spacing.
- `npm run build`, `npm run lint`, `npm test` pass at 100% coverage; `ui-context.md` and `progress-tracker.md` updated.

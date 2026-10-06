## Goals

- Product owner's request (2026-10-06): the Account page "with more compact cards". On a wide screen today every card is full width: the Profile card is mostly empty space (a 112px avatar column, then three fields stretched across the page and the Save buttons at the far right), the friend link field is one line across 3000px, and each friend's "Remove" sits at the opposite edge from their name.
- Builds on spec 25's density rules (control sizes, `CompactList`, field max width). Frontend only, no backend change.

## Decisions (proposed, confirm in the PR)

1. **Cards in columns, not one full-width stack.** From `lg` up the page is a two-column grid of cards; from very wide screens (`2xl`, about 2000px) three. Below `lg` one column, as today. The page itself stays full width (the 2026-09-22 decision); the columns use that width.
2. **Order** (left to right, top to bottom): pending Room invitations and Reveals first and full width while they exist (they ask for an action), then **Profile**, **Friends**, **Sign-in**. Profile and Sign-in share the first column on two columns, Friends takes the second (it is the one that grows).
3. **Profile card, compact**: the avatar (80px, was 112px) beside its three actions as icon buttons with tooltips ("Upload photo", "From URL", "Remove"), the format hint in one `xs` line under them; then the fields in one column: display name and pronouns **side by side** (2:1), description below (3 rows, autosize up to 6). "Discard changes" / "Save profile" sit right under the description, aligned right of the form, not of the card.
4. **Sign-in card**: one row: the envelope icon and the email as text (not a read-only input), then "Sign out" (outline, gray, as today). The explanation lines become a single dimmed line.
5. **Friends card**: the friend link as a compact row (link text truncated in the middle, copy and regenerate as icon buttons with tooltips); each group (requests received, Friends, requests sent) as a `CompactList` with a small uppercase dimmed label and a count, the row's actions right after the name. More than 8 Friends: the list shows 8 and a "Show all (N)" toggle.
6. Nothing is removed: every action and text available today stays reachable, with the same accessible names.

## Design

- `pages/AccountPage.tsx`: replace the single `Stack` of sections with a responsive grid (`SimpleGrid cols={{ base: 1, lg: 2, '2xl': 3 }}`, or CSS grid with named areas if the column assignment of Decision 2 needs it). Mantine's breakpoints stop at `xl` (88em) and `theme.ts` defines none, so add `breakpoints: { '2xl': '125em' }` (2000px) to the theme and record it in `ui-context.md`.
- `AccountSection`: title `fz="h4"`, description one `xs` dimmed line, content `gap="sm"`; uses `PageCard` (spec 25 padding). Cards in the same row don't need equal height (`align-items: start`).
- `AvatarEditor`: icon-button variant (sizes per spec 25), avatar 80px; the "From URL" popover unchanged.
- `ProfileForm`: name and pronouns in a `Grid` (8/4 from `sm`, stacked below), description `Textarea autosize minRows={3} maxRows={6}`, character counter on the same line as the buttons (left), buttons right. Field width capped as spec 25 says.
- `FriendLinkField`: one row (`Group wrap="nowrap"`): link icon, the URL in `--font-mono` `xs`, middle-truncated with the full link in a tooltip and in the copy button's accessible name, copy and regenerate `ActionIcon`s.
- `FriendsSection`, `RoomInvitationsSection`, `RevealsSection`: rows through `CompactList`; `FriendRow` keeps its avatar (`sm`, was `md`), name and detail line.
- Sign-in card: `Group justify="space-between"`, email as `Text` with the icon; no-email placeholder as dimmed text.
- i18n: new tooltip and label strings ("Show all ({{count}})", the short sign-in line) in `it.json` and `en.json`; drop keys nothing uses any more (`locales.test.ts` guards parity).
- `ui-context.md` → Account page: rewrite the entry for the new layout.

## Implementation

- **25b_1** frontend, one PR into `staging`, after spec 25 is merged.
- Tests: the Profile form still saves, discards and counts characters; avatar actions keep their accessible names; the friend link copy and regenerate still work; "Show all" appears from 9 Friends and expands; the invitations and Reveals cards still appear only while non-empty. Update the existing Account tests for the new structure.
- Headless screenshots at 375px, 1280px and 3440px attached to the PR.

## Definition of Done

- At 1920px and wider the Account page fits Profile, Friends and Sign-in in the first screen for a user with up to 8 Friends, with no row wider than its column.
- On a phone the page reads top to bottom in the order of Decision 2, nothing cut.
- Every action that existed still works and keeps its accessible name.
- `npm run build`, `npm run lint`, `npm test` pass at 100% coverage; `ui-context.md` and `progress-tracker.md` updated.

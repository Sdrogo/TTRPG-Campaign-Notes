# 57d - UI consistency alignment

## Goals

- Product owner's request (2026-11-05): tickets 57/57b/57c could be worked
  on later, but the stage of each was not remembered and they might need
  aligning to the latest changes.
- Status check: **57, 57b and 57c were all built and merged** (PR #285,
  2026-11-02) and are in production; the only open item was the product
  owner's review. Nothing in them needs to be redone. This ticket only
  closes the gaps that the later work (Clocks, Room landing Sections,
  Clock block picker) left against the 57 decisions.
- **Not** in scope: map pages' toolbars, the landing page's editorial
  layout, the Session 0 boards' compact header, new features. No backend
  change, no migration.

## Audit against the current `staging` (2026-11-05)

Still valid and holding:

- Decisions 1-4 (Index padding, phone member blocks, wrapping heading
  actions, floating Create Document), 5 (dark scale), 6 (`danger`: no
  `color="red"` button is left), 7, 8 (`PageHeading` on My Rooms, Room home,
  Documents, Maps, Clocks, Section, setup, Session 0, Account), 9, 10, 11
  (`EmptyState` also on the Clocks page), 13-15.

Drifted, to fix here:

1. **Cancel buttons (Decision 12)**: 16 Cancel / "keep editing" buttons are
   still `variant="default"`, while the rest are `subtle` grey. Files (under
   `frontend/src/`):
   `components/sessionZero/BoardColumns.tsx` (2),
   `components/sessionZero/ModuleChain.tsx` (2),
   `components/sessionZero/PollModule.tsx`,
   `components/sessionZero/QuestionsModule.tsx`,
   `components/sessionZero/SessionZeroHeader.tsx`,
   `components/clocks/ClockDialog.tsx`,
   `components/clocks/ClockGroupDialog.tsx`,
   `components/clocks/ClockRulesDialog.tsx`,
   `components/clocks/MarkDialog.tsx`,
   `pages/RoomClocksPage.tsx` (2),
   `components/maps/CardColorDialog.tsx`,
   `components/maps/MentionMapModal.tsx`,
   `pages/RelationshipMapPage.tsx` (a delete-confirmation modal footer).
2. **Section headings (Decision 12)**: `fz="h4"` on a section title in
   `pages/RoomClocksPage.tsx:264` and in the Clock group band,
   `components/clocks/ClockGroupBand.tsx:60`; every other page's sections are
   `fz="h3"`.
3. **In-page loader (Decision 10)**: a bare `<Loader size="sm" />` in the
   page flow in `components/account/FriendsSection.tsx`. The accept-invite and
   add-friend pages already sit in a centered full-height stack, and the
   Session 0 DDI document loader is inside a module card: both stay.

Obsolete / dropped:

- Nothing in 57/57b/57c is obsolete. The "Documents page title" test and the
  Demo screenshots of `ui-audit/after/` predate the Clocks page, so the
  Clocks page has no before/after shots (not taken by this ticket, see
  Decision 4).

## Decisions

1. All Cancel and "keep editing" buttons listed in item 1 are `subtle` grey
   (`color="gray"`).
2. The two Clock headings above use `fz="h3"` like the other
   pages' sections.
3. `FriendsSection` uses `SectionLoader`.
4. Before/after screenshots of the Clocks page are not part of this build (a
   button variant and a heading size); take them only if the product owner
   asks.

## Design

Frontend only: the files listed above, plus their tests where a test pins
the variant or the loader. No new component.

## Tests

No new test: the existing suite (2782 tests) pins none of these variants and
stays green; `tsc` and `oxlint` are clean.

## Estimate

About 30 minutes of Claude build time.

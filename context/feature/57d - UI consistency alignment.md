# 57d - UI consistency alignment

## Goals

- Product owner's request (2026-11-05): tickets 57/57b/57c could be worked
  on later, but she did not remember where they stood and they might need
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

1. **Cancel buttons (Decision 12)**: about 14 Cancel / "keep editing" buttons
   are still `variant="default"` (Session 0: `ModuleChain`, `BoardColumns`,
   `SessionZeroHeader`, `PollModule`, `QuestionsModule`; and the new Clock
   dialogs: `ClockDialog`, `ClockGroupDialog`, `MarkDialog`,
   `ClockRulesDialog`), while 34 elsewhere are `subtle` grey.
2. **Section headings (Decision 12)**: the Clocks page's sections are
   `order={2} fz="h4"` (`pages/RoomClocksPage.tsx`) and the Clock group
   band `fz="h4"`; every other page's sections are `fz="h3"`.
3. **In-page loaders (Decision 10)**: `AcceptInvitePage` and `AddFriendPage`
   still render a bare `<Loader />` in the flow; `DdiModule`,
   `FriendsSection` too. Block-level loaders inside Sections (small, in
   a card) stay as they are.

Obsolete / dropped:

- Nothing in 57/57b/57c is obsolete. The "Documents page title" test and the
  Demo screenshots of `ui-audit/after/` predate the Clocks page, so the
  Clocks page has no before/after shots yet (added by this ticket).

## Decisions

1. All Cancel and "keep editing" buttons are `subtle` grey (`color="gray"`),
   in Session 0 and in the Clock dialogs.
2. The Clocks page and the Clock group band use `fz="h3"` like the other
   pages' sections.
3. `AcceptInvitePage`, `AddFriendPage`, `DdiModule` and `FriendsSection` use
   `SectionLoader` (centered) instead of a bare `Loader`.
4. Clocks page: before/after screenshots (desktop 1440px, phone 390px) in
   `ui-audit/after/`.

## Design

Frontend only: the files listed above, plus their tests where a test pins
the variant or the loader. No new component.

## Tests

- Existing tests stay green at 100% coverage; add one that a Clock dialog's
  Cancel is subtle grey if none pins it.
- Visual check on the Demo, desktop and phone.

## Estimate

About 30-40 minutes of Claude build time, including tests and screenshots.

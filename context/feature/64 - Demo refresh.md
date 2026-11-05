# 64 - Demo refresh

## Goals

- Product owner's request (2026-11-05): the Demo "rispecchia solo una piccola
  parte delle feature ed è anche abbastanza outdated" (shows only a small
  part of the features and is quite outdated).
- Spec 45 built the Demo and its 13-step tour on 2026-10-25, when the app had
  Rooms, Documents, Notes, comments, visibility, search and two kinds of map.
  Specs 46 to 63 added a lot on top. This ticket brings the sample Room, the
  tour and the landing page's feature cards back in line, and adds a rule so
  they stay in line.
- Frontend only (`lib/demo/`, tour, landing, locales, `public/demo/`). **No
  backend change, no migration.** `requirements.md` is unchanged.

## Audit (what the Demo has today, 2026-11-05)

| Area | In the Demo today | Gap |
| --- | --- | --- |
| Start page | Documents list (`/rooms/demo/documents`) | Since spec 55 a Room opens on its **Room landing** (Sections); the Demo never shows it. `/sections` returns only the 3 page cards, the Clocks card and one Clocks Section |
| Sections and blocks (55, 60) | none | No Section with a Documents, Map, text or Index block, no tool block, no Room image, no edit mode to point at |
| Clocks (61, 63) | 5 clocks, 2 groups, rules, a Clocks Section (added with 61_4) | No tour step; the Clocks page is never visited |
| Session 0 (46, 47, 53, 54) | page exists but is **empty** ("not started") | No sample Stars and Wishes, Lines and Veils, poll or module chain; the whole feature is invisible |
| Maps (28, 38, 42, 58, 62) | one free map, one geographic map | Curved lines (62), map cards opening the split pane (62b/c, 58) and players' editing (42) are not pointed out. The free map's arrows are all straight (no `bend`) |
| Markdown (48) | none of the sample text uses it | Headings, lists, bold and links are never shown |
| Split view (37, 50) | works on any Document | No tour step |
| Relational link Notes (41), mentions (39), hover preview (32) | a flagged Note exists; mentions exist | No tour step for the link Note or the hover preview |
| Characters (17), version history (24, 24b), reveal history (22) | none: characters list is empty, `versions` and `audit-log` return `[]` | Features not visible |
| Export / import (23, 27, 40, 56), PDF styles (35) | writes, refused in read-only mode | The landing card for Export has no tour step (`tour: null`) |
| Images (1, 26, 29) | none: "the sample Room has no images yet" (Next Up) | Cards and Documents look bare; Room image and map backgrounds are missing |
| Tour (45_3) | 13 steps: room, index, card, document, text, mention map, comments, visibility, view-as, search, free map, geo map, end | Nothing about spec 46 onwards |
| Landing cards (45_1) | 6: Rooms, Documents, Visibility, Comments, Maps, Export | Sections/Room landing, Session 0 and Clocks, the biggest additions since, are not mentioned |

## Decisions (proposed, to confirm)

Each carries a recommendation (marked **Rec**). The product owner confirms or
changes them before any code is written.

1. **Start the Demo on the Room landing** (not on the Documents list), so the
   first thing a visitor sees is what a real Room looks like today. **Rec:
   yes.** `DEMO_START_PATH` moves to `/rooms/demo`; the old Documents steps
   keep their own `path`.
2. **A real Room landing in the sample Room**: the landing gets a Room image,
   plus Sections with blocks, all read-only: a welcome text Section (short
   Markdown), a "Characters and places" Section with a Documents block (Tags
   NPC and Place), a "Maps" Section with a Map block, the existing Clocks
   Section, and the three page cards. **Rec: yes**, built from the same
   Section shapes the real API returns; the Room Index tab (44) keeps
   working over them.
3. **A sample Session 0, already played**: a Session 0 with a short module
   chain (Lines and Veils, Stars and Wishes, one **poll** with results, one
   Clock/tool block), so the page shows real content instead of "not
   started". It is a frozen snapshot: nothing is live, voting is refused like
   every write. **Rec: yes**; it is the largest piece of missing content.
4. **Markdown in the sample text**: rewrite two Documents and one Note with
   headings, bold, a list and a quote, so the Markdown rendering (48) is seen
   without a tour card needing to explain it. **Rec: yes**, a small text
   change in `demoData.ts`.
5. **Images** (closes the 45 Next Up item): a Room image, an image on about 6
   Documents and a background for the geographic map, bundled in
   `public/demo/`. **Rec: yes.** I generate stylised illustrations
   (consistent palette, small files, no stock or third-party art, so no
   licence question). You can replace any of them later by dropping a file
   with the same name.
6. **Content for the hidden features**: one character Document played by the
   Master so "Characters" is not empty (17); a short **version history** on
   one Document (2 versions) and a **reveal history** entry on the Master-only
   one (22, 24), served read-only. **Rec: yes for versions and a character;
   skip reveal history** (low value, bigger shape to fake).
7. **Maps**: give two arrows of the free map a `bend` so curved lines (62)
   show; add a map card flagged as a link to a Document so the split pane
   (62b/c) can be shown. **Rec: yes.** Players' editing (42) and live
   updates (43, 52) are not shown: read-only has nothing to edit.
8. **Tour restructure**. 13 steps is already long; the new total is about 20.
   **Rec: two chapters.** "The basics" (the 13 current steps, trimmed to 11:
   `room` is replaced by the Room landing) and "More" (new ones below), with
   a chapter list in the tour card so a visitor can jump or stop after the
   first chapter. Final step list, in order:
   - Basics: `roomLanding` (new), `sections` (new), `roomIndex`,
     `documentCard`, `document`, `documentText` (now also names Markdown),
     `mentionMap`, `comments`, `visibility`, `viewAs`, `search`.
   - More: `splitView`, `linkNote`, `freeMap` (now also curved lines),
     `geoMap`, `sessionZero`, `poll`, `clocks`, `versions`, `export` (opens
     the Export dialog and says writes need an account), `end`.
   Each new step is a `data-tour` attribute on an existing real component,
   as spec 45_3 does; they are listed in Design.
9. **Landing page cards**: 6 become 9: add **Sections and the Room landing**,
   **Session 0** and **Clocks**; the Export card gets a tour step. Same grid
   (3 / 2 / 1 columns). **Rec: yes.** Maps keep one card; its text names
   curved relationship lines.
10. **What stays out**: Friends, Account, agent tokens, read-aloud (30), image
    search (29), generate mentions (39), duplicate Room (33), PDF import/export
    (27, 56) and edit mode of Sections (55): they are writes, or settings
    pages, or need a backend. The Export step mentions import/export and PDF
    styles in one sentence. **Rec: keep out.** Say so if one of these must be
    in.
11. **Keep it from rotting again**: (a) a frontend test that every `data-tour`
    target of `TOUR_STEPS` exists in the source and every step has a title and
    body in all 12 locales; (b) one line in `ai-workflow-rules.md`: a ticket
    that adds a user-visible feature says whether the Demo needs sample data
    or a tour step, and the progress tracker has a "Demo" tick per feature.
    **Rec: yes to both.** (b) edits a context file but not `requirements.md`.
12. **Languages**: sample content stays English + Italian (as 45 Decision 11);
    tour and landing strings in all 12 UI languages (the 10 beta ones drafted
    by Claude, as in spec 34). Nothing else changes.

## Design

### Sample data (`lib/demo/demoData.ts`, `demoBackend.ts`)

- `sections`: returns the full landing shown in Decision 2 (replaces the
  hard-coded 5-item list), `can_edit: false`, with blocks in the shapes of
  `RoomSection` / `SectionBlock` (spec 55/60 types). The Room gets an
  `image_url` under `/demo/`.
- `session-zero`: `started: true`, a `modules` chain, a round with Lines and
  Veils, Stars and Wishes entries from Marco, Giulia and the Master, and a
  poll with `results` (spec 53/54 shapes), `timer: null`. `overview` answers
  the same snapshot.
- `characters`: the character Document is `played_by` the Master.
  `versions` returns 2 entries for one Document; `audit-log` stays `[]`.
- Documents: image URLs (`public/demo/*.webp`), Markdown bodies, one
  map-linked card. Maps: two `bend` values.
- Everything stays inside the existing `answer()` switch and `Viewer`
  filtering, so View-as hides what a Player must not see (a Master-only
  Session 0 module is hidden from the Player).

### Tour (`lib/demo/tour.ts`, `DemoTour.tsx`)

- New `TourStepId`s per Decision 8; `TOUR_STEPS` carries a `chapter: 'basics'
  | 'more'`. The card shows "Step n of N" and a two-button chapter control.
- New `data-tour` attributes: Room landing header (`room-landing`), Section
  card (`section`), split pane toggle (`split-view`), link Note (`link-note`),
  Session 0 module chain (`session-zero`), poll card (`poll`), Clocks block
  (`clocks`), version history button (`versions`), Export button (`export`).
- Landing: `FEATURES` gains `sections`, `session`, `clocks`; the tour ids
  keep the `/demo?step=<id>` links.

### Locales

`tour.steps.<id>.{title,body}` for the new steps, `tour.chapters.*`,
`landing.features.{sections,session,clocks}.{title,text}` in the 12 files.

## Units (one PR into `staging`, frontend only)

- **64_1** sample data: Room landing Sections, Session 0 snapshot, Markdown,
  images, versions, character, map tweaks (+ backend tests).
- **64_2** tour: new steps, chapters, `data-tour` targets, the guard test
  (Decision 11a).
- **64_3** landing cards, 12 locales, docs (`ui-context`, `architecture`
  Demo section, tracker, `ai-workflow-rules` line).

## Tests

- `demoBackend.test.ts`: sections, Session 0 snapshot, versions, characters
  and the View-as filtering of the new content.
- `tour.test.ts` / `DemoTour.test.tsx`: chapters, jumping, every target exists
  in the rendered pages.
- `LandingPage.test.tsx`: 9 cards, each tour link resolves to a known step.
- Locale-completeness test for the new keys. 100% coverage gate holds.

## Estimate

About 1.5 to 2 hours of Claude's build time in total: 64_1 about 50 minutes
(the Session 0 snapshot and Sections shapes are the careful part), 64_2
about 40 minutes, 64_3 about 30 minutes, plus about 15 minutes to generate
and optimise the images. One PR, or three small ones if you prefer to review
per unit. No migration, nothing to apply by hand.

## Open questions (for the product owner)

- **Q1** Start on the Room landing instead of the Documents list? **Rec: yes.**
- **Q2** Tour as two chapters (basics / more), about 20 steps? **Rec: yes.**
  Alternative: one flat list of 20, or cut the "More" chapter to 4 steps.
- **Q3** Sample Session 0 already played, with a poll? **Rec: yes.**
- **Q4** Generated illustrations for the sample images? **Rec: yes.**
  Alternative: you provide art, or the Demo stays image-free.
- **Q5** Skip reveal history, Friends, read-aloud, image search and the other
  items in Decision 10? **Rec: yes.**
- **Q6** Add the "Demo needs an update?" line to `ai-workflow-rules.md` and
  the guard test? **Rec: yes.**
- **Q7** One PR or three (64_1 to 64_3)? **Rec: one PR, three commits.**

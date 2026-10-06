## Goals

- Replace spec 24's two histories (one for the Document's text, one per Note) with **one History per Document** that covers its name, its description and its Notes. Product owner's call, 2026-10-06: Notes are part of the Document (D-18), not things versioned on their own, and a per-Note history is lost with the Note, so the change most worth undoing (deleting a Note) couldn't be undone.
- Still FR-D5 (change history with restore); spec 24's Decisions 2 (merge window), 3 (who, restore appends) and 5 (retention) stay.

## Decisions (product owner, 2026-10-06)

1. **What a revision holds**: the Document's name and description and, for each Note, its title, text and position. Tags, images, Attachments, Owners and visibility are still not versioned (visibility has its own history, spec 22).
2. **When**: every change to any of those (Document edit, Note created, edited, deleted or reordered) writes a revision, with spec 24's merge window (same person within 10 minutes updates the latest revision).
3. **One entry point**: the History icon on the Document. Notes have none.
4. **Compare**: a revision against the current one: name and description side by side, then each Note: changed (side by side), removed since (it would come back) or added since (it would go away).
5. **Restore** puts the whole Document back as it was in that revision: name, description and the Notes the restorer can see (texts, order, Notes deleted since come back, Notes added since are deleted). Restoring appends a revision, so nothing is lost.

## Visibility (VR-03, VR-07)

- A revision is shown to a viewer **projected on the Notes they may see**: a Note that still exists counts if they see it now; a deleted Note counts if they would have seen it with the visibility and grants it had when it was deleted. Everything else is absent, never named.
- A Note's visibility isn't versioned, but each revision stores it so deleted Notes can be judged: a visibility or grant change of a Note (edit, Reveal) rewrites it in the latest revision without adding one.
- The list is projected too: a revision that changed only what the viewer can't see is left out (the earliest revision of a run of identical projections is kept), and the word counts only count what they see.
- Restore never touches a Note hidden from the restorer, now or in the revision. A deleted Note comes back with its id, its last visibility and its grants to members still in the Room.

## Design

- **Migration**: `document_versions` gains `notes` (JSONB list of `{id, title, description, position, visibility, selective_user_ids}`); `note_versions` is folded into it and dropped. Backfill: for each Document, every `document_versions` and `note_versions` row is replayed in time order on a running state (the Note's current position and visibility), one revision per row. Lossy downgrade (recreates `note_versions` with each Note's current text).
- **Domain** (`app/domain/versions.py`): `DocumentState`, `plan_revision` (merge window, equality ignores visibility, a visibility-only change rewrites the latest), `project` (a revision for one viewer), `visible_history` (projection plus de-duplication) and the change size over everything visible.
- **API**: `record_revision(session, document_id, editor)` reads the Document and every Note and records the state; called after each change listed in Decision 2 and after any Note visibility change. Routes: list, read, restore under `.../documents/{doc}/versions`; the Note routes are removed. Access as in spec 24 (Owners and the Master, `get_owned_document`).
- **Frontend**: the drawer compares the chosen revision with the newest one; the Note history icon goes away; deleting a Note no longer says it can't be undone.

## Implementation

- **24b_1** backend and migration, **24b_2** frontend, one PR into `staging`. The migration must be applied to staging, and to production before the release.

## Definition of Done

- An Owner deletes a Note by mistake; the Document's History shows the revision before, and restoring it brings the Note back with its text and place.
- An Owner never sees, in the list, the comparison or the counts, a Master-only Note or a revision that only changed one.

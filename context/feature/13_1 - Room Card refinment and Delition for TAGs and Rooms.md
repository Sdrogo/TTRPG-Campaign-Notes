## Goals

- Make the whole **Room card** on the Rooms page a link to the Room's Documents, and drop the "Documents" button. The "Setup" and "Invite" buttons keep working and win over the card click.
- On the Room setup page (`/rooms/:roomId/setup`, Administrator only), add:
  1. **Delete the Room** completely, with a confirmation step like the Document deletion one.
  2. **Delete a Tag**, so a Tag added by mistake (or no longer wanted) can be removed.
- This ticket is the spec of spec `13 - Room Card Refinment, Room and TAG deletion.md`. Work is split in three steps, each its own branch and PR (`ai-workflow-rules.md`: backend and frontend ship separately, and the card change is unrelated to the deletions):
  - **13_1a** Room card (frontend only).
  - **13_1b** Backend: `DELETE` Room and `DELETE` Tag.
  - **13_1c** Frontend: the two controls on the setup page. Must not start before 13_1b is merged.

## Design

### Room card (13_1a)

- The card is one click target to `/rooms/{id}/documents`. "Setup" (Administrator) and "Invite" (Administrator) keep their own behavior and must **not** also trigger the card navigation.
- Follow the pattern `DocumentCard` already uses for a clickable card whose inner controls take priority (link overlay, controls raised above it; spec 07 notes "carousel arrows beat the card's link overlay"). Reuse it rather than inventing a second one. Do not nest an `<a>` inside an `<a>`.
- Keyboard and a11y: the card must be reachable with Tab, show a focus ring, and have an accessible name (the Room name). Hover state tells it is clickable (cursor, subtle border/background from theme tokens, no new radius, no hardcoded hex: `ui-context.md`).
- Remove the `rooms.documents` string from `it.json` and `en.json` if nothing else uses it (a key unused in every language is dead text).
- Roles: every member gets the card link, not only Administrators (as the button did).

### Delete a Room (13_1b / 13_1c)

- **Who**: Administrator only (`is_admin`), matching the setup page and `PATCH /rooms/{id}`. The Master alone is not enough. *Assumption, confirm: deleting a whole Room is the most destructive action in the app, so it stays with the role that already manages the Room itself.*
- **What goes**: the Room and everything under it. The database already cascades Memberships, Invitations, Tags, Tag combinations, Documents (and through them Owners, grants, Notes, Comments, Document-Tag links), and the **AuditLog rows of that Room** (`audit_log.room_id` is `ON DELETE CASCADE`).
- **Storage is the trap**: the cascade deletes `document_images` rows without ever creating the `storage_cleanup` row their Storage objects need, so a plain `DELETE FROM rooms` would orphan every image forever (same reason as the Document deletion, architecture.md -> "Deleting a Document"). The route must queue every image of every Document of the Room through `image_uploads.remove_images` **before** deleting the Room row, inside the same transaction, Storage removal after commit. Comment attachments are `document_images` too, so they are covered. Avatars are not (they belong to users, not Rooms).
- **Locking**: lock the Room's Documents (sorted id order, like `remove_images` already does) before reading their images, so a concurrent upload cannot add a row the cascade would then delete unqueued.
- **Response**: `204`. Non-member and non-Administrator: reuse the existing `errors.room.*` 403 style (a new key if no existing one fits, e.g. `errors.room.onlyAdministratorCanDelete`). A Room the requester is not in answers like the other Room routes do (do not reveal that it exists).
- **AuditLog (Invariant 7)**: not applicable, because the room's own audit rows are removed with it, and Room deletion is not one of the listed audited changes. State this in `architecture.md`. If the product owner wants a permanent record of deletions, it needs a table that is not tied to the Room (open question below).
- **Confirmation (UI)**: same workflow as Delete Document (red outlined button, `Modal` with title and body, red `Delete` button with loading state, `notifyError` on failure), with one addition because the blast radius is the whole Room: the confirm button stays disabled until the user types the Room's name. Body text lists what is lost (Documents, images, Comments, members). All strings through i18n, in `it.json` and `en.json`.
- **After success**: invalidate the "my rooms" query, drop cached queries scoped to that Room, `navigate('/')`, `notifySuccess`. Place the control in its own "Danger zone" section at the bottom of the setup page, below the Main Tags editor.

### Delete a Tag (13_1b / 13_1c)

- **Who**: Administrator only on the setup page. The backend allows the same people who may create a Tag today: **Administrator or Master** (`errors.tag.notAllowedToManage`), so the rule is symmetric with creation. The UI only offers it where the setup page is reachable (Administrators), through `lib/roomPermissions.ts`.
- **What goes**: `DELETE /rooms/{id}/tags/{tag}` -> `204`; `404` when the Tag is not in that Room (never touch another Room's Tag). Cascades already remove its `document_tags` and `tag_combination_tags` rows.
- **Main items must stay valid (the real work)**. A Tag can be a single Main item (`tags.main_position`) and part of combinations (spec 11_2). After deletion:
  - the Tag's own single item disappears with the row (positions keep a gap, which is harmless by design);
  - a combination that lost a Tag and now has **fewer than 2 Tags is deleted whole**: a one-Tag combination would duplicate a Main Tag item, and an empty one would render nothing (`plan_main_items` rejects both on PUT, so storing them would break the invariant the editor relies on). A combination that still has two or more Tags simply shrinks.
  - A shrunken combination could now equal another existing combination (same set of Tags) or an existing single Tag. Rule: keep the earlier position, drop the later duplicate. Put this in `app/domain/tags.py` (a `plan_tag_removal`-style function working on plain dataclasses, so it is unit-testable), not in the route.
  - Take the Room's row lock before reading and rewriting items, like the other Main item writes.
- **Mentions**: Documents may contain `#TagName` as plain text. After deletion it stops resolving and renders as plain text (already the accepted behavior for a name that does not match, architecture.md -> Mentions). No text is rewritten.
- **Document content is never lost**: only the label link goes. A Document that had only this Tag simply has no Tag.
- **Confirmation (UI)**: deleting a Tag changes how every Document is grouped, so confirm with a small modal that says how many Documents carry it. The count comes from data the client already has (`useDocuments` list, filtered per viewer); because the list is visibility-filtered (VR-07), word it as "the Documents you can see" or leave the number out. **Do not** add a backend count: it would leak hidden Documents (Invariant 1). Choose one in the PR and say which.
- **Where in the UI**: the Main Tags editor lists the Room's Tags, so add a delete (trash) icon button per Tag in a small "All Tags" list on the setup page, with an accessible name that includes the Tag name. Deleting a Tag the editor currently has in an unsaved draft must reset or reconcile that draft (the editor is re-keyed on the saved list, so invalidate `tags` and `mainItems` and let it re-key; make sure unsaved edits are not silently kept pointing at a missing Tag).
- No rename, merge, or category editing here.

## Implementation

### 13_1a - Room card (frontend only)

- Branch from `origin/main`: `feature/13-1a-room-card`.
- Edit `frontend/src/components/RoomCard.tsx`; follow the overlay pattern in `DocumentCard`. Update `RoomCard.test.tsx`: the card links to `/rooms/{id}/documents`; Setup and Invite are still reachable and do not navigate to Documents; no "Documents" button.
- Remove the dead i18n key in both locale files (`locales.test.ts` guards parity).
- Check `App.test.tsx` / `RoomsPage` tests that look for the "Documents" button by name.

### 13_1b - Backend

- Branch from `origin/main`: `feature/13-1b-room-tag-delete-backend`.
- **No migration expected** (all FKs already cascade). If one turns up, it follows the usual rules (RLS + deny policy) and is applied to the live DB with the user's go-ahead **before** the merge.
- **Domain** (`app/domain/`): the Administrator check for Room deletion, and the Tag-removal planner described above (inputs: the Room's Tags and combinations as dataclasses; output: which combinations to delete, which to shrink, which Tag to drop). Narrow `DomainError` subclasses with translation keys.
- **DB** (`app/db/rooms_repo.py`, `tags_repo.py`, `documents_repo.py`): `delete_room`, `delete_tag`, a way to list every image of every Document of a Room (including Comment attachments, no visibility filter: deleting does not need one, same as Document deletion), and the combination rewrite.
- **API**: `DELETE /rooms/{room_id}` in `app/api/rooms.py`; `DELETE /rooms/{room_id}/tags/{tag_id}` in `app/api/tags.py`. Role check **before** any mutation (Invariant 6). Thin handlers.
- **i18n**: every new `detail` in `app/i18n/locales/{en,it}.json`; `tests/test_i18n.py` must pass.
- **Docstrings** on every public name (ruff `D1`).
- **Tests, coverage stays at exactly 100%** (domain and `app/`):
  - Room: Administrator deletes; Master-only (not admin) -> 403; Player -> 403; non-member -> same status as other Room routes; everything cascades (Documents, Tags, memberships, invitations, audit rows); **every image of every Document, Comment attachments included, gets a `storage_cleanup` row and no object is removed before commit**; a failure rolls back and leaves Room and objects intact; another Room is untouched.
  - Tag: Administrator and Master delete; Player -> 403; Tag of another Room -> 404; `document_tags` and `tag_combination_tags` rows gone; documents survive; single Main item gone; combination of 3 shrinks to 2; combination of 2 is deleted; shrunken combination that becomes equal to an existing item keeps the earlier position only; positions of the others unchanged; `GET /tags/main` after deletion returns only valid items.
  - `tests/test_database_security.py` unaffected.

### 13_1c - Frontend setup page

- Branch from `origin/main` **after 13_1b is merged**: `feature/13-1c-room-tag-delete-frontend`.
- Hooks in `src/hooks/` (`useDeleteRoom`, `useDeleteTag`) with TanStack Query; tests mock `lib/apiClient` and assert method and path (`DELETE /rooms/{id}`, `DELETE /rooms/{id}/tags/{tag}`) and what is invalidated: Room delete -> my rooms, and drop Room-scoped caches; Tag delete -> `tags`, `mainItems` and the documents list.
- Components under `src/components/setup/` (a `DeleteRoomSection`, and a Tag list or an extension of `MainTagsEditor`, whichever keeps each file single-purpose). Mantine primitives only, theme tokens only, existing radius scale.
- Honor the backend: never re-derive permissions beyond `roomPermissions.ts`.
- All strings through `t()`, in both locale files, interpolation not concatenation.
- Tests: the confirm button is disabled until the Room name is typed; cancel does nothing; success navigates to `/`; failure shows `notifyError` and stays; Tag delete asks for confirmation; deleting a Tag refreshes the Main Tags editor without keeping a stale reference.

## Definition of Done

- The Room card is a single link to the Room's Documents, Setup and Invite still work and do not navigate to Documents, keyboard works, no "Documents" button, no dead i18n key.
- An Administrator can delete a Room from the setup page after typing its name; everything under it is gone, **no image object is left orphaned in Storage**, and the user lands on the Rooms page.
- An Administrator can delete a Tag from the setup page; Documents keep all their other data; Main Tags and combinations remain valid (no empty or one-Tag combination, no duplicate item), and the Documents page and Tag filter still work.
- No invariant in `architecture.md` is violated; no hidden-Document information leaks through a count (Invariant 1, VR-07).
- Documentation updated: `architecture.md` (Storage Model: how Room deletion handles Storage, Tag deletion and its effect on Main items/combinations, who may do each, why Room audit rows are not kept), `ui-context.md` if the clickable-card or danger-zone pattern is new, `progress-tracker.md` (completed units, Open Questions below).
- Frontend: `npm run build`, `npm run lint` and `npm test` pass. Backend: `pytest`, `ruff`, `mypy` strict pass locally and on CI.
- Git commit, push and PR for each of the three steps, presented as a link to finish the job.

## Open questions to log in `progress-tracker.md`

- Who may delete a Room: assumed Administrator only (not Master alone). Confirm.
- Room deletion removes the Room's audit rows with it (existing cascade). Should deletions be kept somewhere that outlives the Room? Not built; no requirement in `requirements.md` asks for it.
- Tag deletion by Master from the API (allowed, same as creation) even though the setup page is Administrator-only. Confirm or tighten to Administrator.
- A combination left with fewer than 2 Tags is deleted, and a duplicate created by shrinking is dropped (assumed). Confirm.
- Confirmation wording for Tag deletion: show a count of visible Documents, or none.
- Soft delete / undo for Rooms is out of scope; deletion is permanent, like Documents.

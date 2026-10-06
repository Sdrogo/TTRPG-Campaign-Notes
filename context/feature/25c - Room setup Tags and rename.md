## Goals

- Product owner's request (2026-10-06): rework the whole **Tags** part of the Room setup page, and let an Administrator **rename a Tag** that already exists.
- What is wrong today (screenshots of 2026-10-06, 3440px wide): three separate blocks ("Main Tags" list, two "add" fields and a "Save order" button, then "Tags") that read as unrelated; every Main item and every Tag is a full-width boxed row, so 40 Tags take three screens; the up/down/remove icons sit at the far right; "Save order" is a disabled grey button under two add fields, easy to miss; two different controls add a single Tag and a combination; Tags can't be created here at all, and a typo in a Tag name can only be fixed by deleting the Tag (which removes it from every Document).
- Builds on spec 25 (density rules, `CompactList`). Backend for the rename, frontend for the section.

## Decisions (proposed, confirm in the PR)

1. **One "Tags" section with two parts**: **Grouping** (the Main items, what the Documents page groups by) and **All Tags**. Side by side from `lg` (Grouping about 5/12, All Tags 7/12), stacked below. One section title, one short description per part.
2. **One way to add a group**: a single searchable `MultiSelect` "Add a group" and an "Add" button. One Tag picked = a Main Tag, two or more = a combination (specs 11, 11_2). "Add" is disabled, with a one-line reason under the field, for a set that is already listed (a single Tag already a Main Tag, or the same set of Tags).
3. **Grouping saves on every change** (move, remove, add), no "Save order" button: the list is short, each change is small, and a separate save is what made the old block confusing. Optimistic update of `mainItems`, rolled back with `notifyError` on failure; no success toast per change. While a save is in flight the next one waits (one mutation at a time), so the order on screen is the order saved. *If the product owner prefers an explicit save, keep the draft and show "Save" / "Discard" only while there are unsaved changes, in the section's header.*
4. **Rename a Tag**: Administrator or Master, the same people who may create and delete a Tag (`errors.tag.notAllowedToManage`); the setup page offers it to Administrators, like the delete. Name only: the category stays as it is (not editable here, as before). Trimmed, not empty, unique in the Room (same rule as creation, exact match). Renaming to the same name changes nothing.
5. **What a rename changes**: everything that refers to the Tag by id follows at once: its Documents, Main items and combinations, the Tag filter in the URL (`?tag=<id>`), `#[Name](tag:<id>)` mention tokens (shown with the Tag's current name, spec 20), the Room export and PDF (current name), the search (the Tag's generated `search_vector`). What does **not** change: the frozen excerpts of "Mentioned in" (`document_mentions.excerpt`, written at save time) and the name stored inside a mention token, which only the search reads; plain `#Name` text that was never converted to a token stops resolving, as after any rename (architecture.md → Mentions). Not AuditLogged (Invariant 7 lists visibility, Reveal, role and Ownership changes). No confirmation dialog: a rename is reversible by renaming back.
6. **Create a Tag here too**: All Tags gets a "New Tag" field (name, Enter to add) using the existing `POST /rooms/{id}/tags`, so the setup page manages Tags end to end. Today a Tag can only be created from a Document or the mention popup.
7. **All Tags list**: a filter field ("Filter Tags", case- and accent-insensitive, like the mention popup) and the count in the heading; rows `#Name`, category dimmed, a small marker when the Tag is used in Grouping, then Rename (pencil) and Delete (trash) icon buttons; in columns on wide screens (spec 25 Decision 4), alphabetical.

## Design

### Backend (25c_1)

- `PATCH /rooms/{room_id}/tags/{tag_id}` in `app/api/tags.py`, body `{name}` → `200` with `TagResponse`. Role check before anything else (Invariant 6): Administrator or Master, else 403 `errors.tag.notAllowedToManage`; a Tag not in this Room → 404 `errors.tag.notFound` (never touch another Room's Tag); empty after trimming → 422 `errors.tag.nameRequired`; a name another Tag of the Room has → 409 `errors.tag.duplicateName`, through a SAVEPOINT like `create_tag`.
- `tags_repo.rename_tag(session, room_id, tag_id, name)`: one `UPDATE … WHERE room_id AND id`. No migration (the `uq_tag_room_name` constraint already guards uniqueness; `search_vector` is generated).
- Docstrings, i18n untouched unless a new key is needed (none expected).
- Tests (coverage stays at 100%): Administrator and Master rename; Player → 403; non-member → 403; another Room's Tag → 404; blank → 422; duplicate → 409 and the transaction is still usable; same name → 200, unchanged; whitespace trimmed; after a rename `GET /tags`, `GET /tags/main`, the Documents list and the search return the new name, and a document's mention token renders it through the export.

### Frontend (25c_2)

- `hooks/useTags.ts`: `useRenameTag(roomId)` (`PATCH`, updates the `tags` cache in place, invalidates the Documents list and search caches that embed Tag names). `useSetMainItems` gains the optimistic update of Decision 3.
- `components/setup/TagsSection.tsx` (new, replaces the page's use of `MainTagsEditor` and `TagManagement`): the two parts of Decision 1. Split into `GroupingEditor.tsx` (list + `GroupAdder.tsx`, which replaces `CombinationAdder` and the single-Tag `Select`) and `AllTagsList.tsx` (filter, new Tag, rows, the delete confirmation that `TagManagement` has today, rename). Keep each file single-purpose.
- **Grouping rows** through `CompactList` (`ol`): position, the item as `#A` or `#A + #B`, up / down / remove `ActionIcon`s right after the label (accessible names as today: "Move {name} up", …). The list holds **Tag ids** and resolves names from the current `tags`, so a rename shows at once (today the editor keeps `Tag` objects, which would show the old name until reload).
- **Rename in place**: the pencil turns the row into a `TextInput` (prefilled and selected, `aria-label` "New name for {name}"), Enter or the check icon saves, Esc or the X cancels; a 409 or 422 shows as the field's `error`, not only as a toast; success shows `notifySuccess("Tag renamed to {name}")`. One row in edit mode at a time.
- Deleting a Tag keeps spec 13's confirmation and behavior; the Grouping list drops items through the refetched `mainItems`.
- `RoomSetupPage.tsx`: render `TagsSection` in place of the two blocks; drop the re-keying trick the draft needed if Decision 3 is kept.
- i18n: new keys under `setup.tags.*` (section and part titles, descriptions, "Add a group", the disabled reasons, "Filter Tags", "New Tag", rename labels and messages) in `it.json` and `en.json`; remove the keys of the old blocks that nothing uses ("Save order", the combination labels).
- `ui-context.md` → Room setup page: replace the Main Tags / Combinations / Tag list entries with the new section. `architecture.md` → Tags: the rename route and Decision 5's list of what follows a rename.

## Implementation

- **25c_1** backend and **25c_2** frontend, one PR into `staging` (two commits), after 25b is merged. No migration.
- Frontend tests: adding one Tag makes a Main Tag, two make a combination, a listed set can't be added; move / remove / add each send the whole list once and roll back on error; renaming updates the row, the Grouping labels and the filter; a 409 shows under the field and keeps edit mode; Esc cancels; the filter narrows the list ignoring accents; creating a Tag adds it to the list; delete still asks for confirmation.

## Definition of Done

- An Administrator fixes a typo in a Tag name from the setup page; its Documents, groups, mentions and the Documents page filter all show the new name without a reload, and nothing else changes.
- With 40 Tags and 5 groups, the whole Tags section fits in about one screen at 1920px and has no full-width row at 3440px.
- A Player can't rename a Tag through the API; another Room's Tag can't be touched.
- Backend `pytest`, `ruff`, `mypy` strict; frontend `npm run build`, `npm run lint`, `npm test`; all at 100% coverage. `architecture.md`, `ui-context.md`, `progress-tracker.md` updated.

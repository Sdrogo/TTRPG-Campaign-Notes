## Goals

- Product owner's request (2026-10-12): the Room card on the Rooms page shows its actions as separate icon buttons (Setup, Invite) next to the ⋮ menu. Move **all of them into the ⋮ menu**, as labeled items.
- Add a new action, **Duplicate**, that creates a copy of an existing Room named after the original with "Copy" at the end, so a Master can reuse a campaign's setup and content (a playtest, a second group running the same campaign).

## Decisions (product owner, 2026-10-12)

### Room card menu

1. **One ⋮ button** on the card's title row. Its menu lists, in this order and each only for whoever may use it today:
   - **Setup** (gear icon): Administrators and the Master, a link to `/rooms/{id}/setup`.
   - **Invite** (user-plus icon): Administrators, opens the existing `InviteModal`.
   - **Duplicate** (copy icon): the Master only (Decision 5).
   - a divider, then **Leave** (red, sign-out icon): every member, opens the existing `LeaveRoomModal`.
2. Nothing else changes on the card: the whole card still links to the Room's Documents, the ⋮ button keeps its page-colored background on a Room image, and its `aria-label` stays "Actions for <Room>".

### Duplicate Room

3. **What is copied**: the Room's setup and every Document with its Notes and images.
   - **Room**: game system, the image (spec 26), "Players can create Documents", default visibility (spec 22).
   - **Tags**: every Tag with its category, the Main Tags with their order and the Tag combinations of the Main items (`tag_combinations`).
   - **Documents**: name, subtitle (if spec 28_0 has landed), description, Tags, visibility, images with the favorite flag.
   - **Notes**: title, description, position, visibility.
4. **What is not copied**: PDF Attachments (product owner), Comments with their replies, reactions and images, Reveals and their recipients, read state, version history (each copied Document starts a fresh one, Decision 9), the AuditLog, invitations, export and import jobs. Relationship maps (spec 28) don't exist yet; ticket 28 decides whether a duplicate copies them.
5. **Who**: only the **Master** of the Room (`role == 'master'`), who sees every Document, so the copy is complete. Anyone else gets 403 (a non-member 404, as for every Room endpoint). Refused while previewing as a member (`X-View-As` refuses every write, spec 22b).
6. **Members**: only the person duplicating joins the copy, as **Master and Administrator**, like a new Room (UC-02). They invite the others afterwards.
7. **Name**: the original name followed by " (Copy)", localized in the duplicating user's language (`it`: " (Copia)"). If that exceeds the 200-character limit, the original name is shortened to fit. Duplicating a copy adds the suffix again ("Tokyo Playtest (Copy) (Copy)"); the Master can rename it from the setup page (spec 25c).
8. **Content that names members** is adapted, because the other members are not in the copy (the same rules as the import, spec 27, Decisions 10, 12 and 14):
   - **Owners**: the person duplicating is the only Owner of every copied Document.
   - **Character player** (`played_by`): not copied.
   - **Visibility**: `room`, `master` and `private` stay as they are; **Selective becomes Private**, since its grant list names members of the original Room (on Documents and Notes alike).
   - **Mentions**: `#Document` and `#Tag` mentions are re-pointed to the copied Document and Tag, so the copy's links and backlinks (spec 20) point inside the copy, never to the original. `@member` mentions become plain `@Name` text.
9. **History**: each copied Document starts a fresh version history (spec 24b) whose first revision is the duplicate, by the person duplicating.
10. **Images are shared, not re-uploaded.** A copied Document image row, and the copy's Room image, point at the **same Storage object** as the original. `storage_cleanup` never removes an object while any row still references its path, so deleting an image (or the whole original Room) leaves the copy's images intact, and the object goes only when the last reference does. No Storage call, no download, no new object.
11. **One transaction, all or nothing**, run in the request: rows are written with bulk inserts in a fixed number of queries per kind (NFR-04), never one per Document. There is no background job and **no migration**.
12. **Confirmation**: Duplicate opens a small modal that names the new Room and says in one sentence what is and isn't copied ("Documents, Notes, Tags and images are copied. Comments, PDF Attachments and members are not."), with **Duplicate** and **Cancel**. On success the modal closes, the new Room's card appears in the list and a notification says "Created <new name>". On failure the modal shows the error and nothing is created.

## Implementation

- One branch into `staging`, backend and frontend together.
- **Backend**
  - `app/domain/rooms.py`: `plan_duplicate_room(source, tags, combinations, documents, notes, images, duplicator, locale)` (pure): new ids for the Room, Tags, Documents, Notes and image rows; the copy's name (Decision 7); the visibility, Owner and mention rewrites (Decision 8), reusing the import's mention rendering in `app/domain/imports.py` (`_render`) where it fits.
  - `app/db/rooms_repo.py`: reads the source Room in a fixed number of queries and writes the plan in one transaction (Room, membership, Tags, combinations, Documents with Tags and Owners, Notes, images, mention index rows for backlinks, first version per Document). Search vectors are filled as for any write.
  - `POST /rooms/{id}/duplicate` (201, the new Room as `MyRoomResponse`): checks Decision 5 first.
  - New error and name strings in the backend `en`/`it` catalogs.
  - Tests at 100%: a Player and an Administrator who is not the Master get 403; the copy has the duplicator as its only member (Master and Administrator) and the only Owner; Selective becomes Private; `#Document` and `#Tag` mentions point into the copy and `@member` mentions are plain text; Comments, PDF Attachments, Reveals and `played_by` are absent; deleting the original Room or an original image keeps the copy's images; name suffix and truncation; `X-View-As` refused.
- **Frontend**
  - `RoomCard`: the Setup and Invite buttons move into the ⋮ menu (Decision 1), plus Duplicate.
  - `DuplicateRoomModal` (Decision 12), a mutation that invalidates the Rooms list.
  - New strings in `en.json` and `it.json`.
  - Tests: who sees which menu item (Player, Administrator, Master, Master and Administrator); the modal calls the endpoint and shows the notification; an error is shown in the modal.
- Update `architecture.md` (Room duplication, shared Storage objects) and `progress-tracker.md`.

## Definition of Done

- On the Rooms page the card shows only the ⋮ button; its menu shows Setup, Invite, Duplicate and Leave according to the member's role.
- The Master duplicates "Tokyo Playtest" and gets "Tokyo Playtest (Copy)" with the same Tags, Main Tags, Documents, Notes and images, no Comments or PDF Attachments, and only themselves as member; a mention inside the copy opens the copied Document.
- Deleting the original Room leaves the copy's images visible.
- A Player and a non-Master Administrator don't see Duplicate, and the endpoint refuses them.
- Checks green.

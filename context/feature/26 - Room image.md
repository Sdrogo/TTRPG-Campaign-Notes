## Goals

- Product owner's request (2026-10-07): a Room can have an **image**, set when the Room is created or later from the Room setup page. It becomes the **default cover of the Room PDF** (spec 23b).
- Today the PDF cover shows the favorite image of a Document picked in the export dialog, or nothing; the Room has no picture of its own.

## Decisions (defaults picked, confirm in the PR)

1. **Optional**: a Room works exactly as today without an image.
2. **Who sets it**: an Administrator, the same people who see the Settings tab of the setup page (spec 11); the creator is one, so the create dialog offers it too. Any member sees it (it is Room-level, like the name). Not AuditLogged (Invariant 7 lists visibility, Reveal, role and Ownership changes).
3. **How**: the avatar's controls (spec 05): upload a file, import from a URL, remove. Same pipeline: validated by content, EXIF stripped, re-encoded as WebP, longest side at most 1920 px, **not cropped** (a cover is a page, not a circle). One image per Room; a new one replaces the old.
4. **Storage**: like avatars, a private Supabase Storage object under `rooms/{room_id}/{random}.webp`, a fresh name per upload; Postgres keeps only the path (`rooms.image_path`). Replaced, removed and deleted-with-the-Room images go through `storage_cleanup`; the sweep never removes an image a Room still points at.
5. **PDF cover**: the export dialog's cover field starts on **"Room image"** when the Room has one. Picking a Document still overrides it (its favorite image, as before); clearing the field prints no cover image. A PDF requested without saying anything (an older client) uses the Room image. A cover Document the requester can't see falls back to the Room image.
6. **In the create dialog**: the image is picked with the name; the Room is created first and the image uploaded right after. If the upload fails the Room still exists, an error says so, and the image can be set from the setup page.

## Design

### Backend (26_1)

- Migration: `rooms.image_path VARCHAR(500) NULL`. No new table.
- `RoomResponse.image_url`: a signed link (like `avatar_url`), null without an image or when Storage can't sign it right now. The Rooms list signs all of them in one request.
- `POST /rooms/{id}/image` (multipart `file`), `POST /rooms/{id}/image/from-url` (`{url}`), `DELETE /rooms/{id}/image`, each returning the `RoomResponse`. 403 `errors.room.notAMember` for a non-member, 403 `errors.room.onlyAdministratorChangesImage` for a member who isn't an Administrator, 413/422 from the image pipeline. The Room row is locked while its image is swapped, so two uploads can't orphan one.
- Room deletion schedules the image's removal with the Documents' images.
- PDF: `PdfExportRequest.room_cover: bool = True` (stored in the job's options; older jobs read as `false`). The job signs the Room image when `room_cover` is set and the chosen Document gives no cover, and embeds it like every other image.
- Tests: upload / import / replace / remove; Player and non-member refused; non-image 422; the image survives the sweep; deletion removes it; the PDF cover is the Room image by default, the Document's when one is chosen, none with `room_cover: false`.

### Frontend (26_2)

- `Room.imageUrl`; `useUploadRoomImage`, `useImportRoomImage`, `useRemoveRoomImage` in `hooks/useRooms.ts`, updating the Room and Rooms caches.
- `components/setup/RoomImageSection.tsx` on the Settings tab: the image (or a placeholder) with Upload, From URL and Remove, saved at once like the avatar.
- `CreateRoomModal`: an optional "Image" file picker with a preview; upload after creation (Decision 6).
- `PdfExportForm`: the cover `Select` gains "Room image" first when the Room has one, and starts on it.
- i18n keys in `it.json` and `en.json`.

## Definition of Done

- An Administrator sets, replaces and removes the Room image from the setup page and when creating a Room.
- A PDF of a Room with an image has it on the cover unless a Document or no image is chosen.
- Backend `pytest` (100% coverage), `ruff`, `mypy`; frontend `npm run build`, `npm run lint`, `npm test`. Migration applied to staging before merging. `architecture.md`, `progress-tracker.md` updated.

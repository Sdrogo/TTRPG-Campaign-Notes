# 59 - Large imports in image blocks

## Goals

- Product owner's report (2026-10-30): importing the JSON export of a whole
  Room (`tokyo-playtest-2026-10-30.json`) is refused with "Si possono
  importare al massimo 200 immagini alla volta". Of the three options
  proposed (count only the chosen Documents, raise the number, run the
  import in blocks), the product owner chose **the import in blocks**
  (2026-11-02).
- Why the cap exists today (spec 27 Decision 8): every image is fetched
  again (up to 20 MB), normalized and stored, 4 at a time, on the VPS that
  serves the rest of the app, inside one job that is taken as lost after 30
  minutes from its start and failed outright by a restart. 200 was a round
  guard, never measured, and a whole Room easily has more.
- After this ticket a Room export with **up to 2000 images** imports in one
  go: the text is written at once as today, the images arrive in blocks the
  job records as it goes, the dialog shows how far it got, and a restart
  resumes the images instead of losing them.
- Backend and frontend; **one migration** (two columns on `import_jobs`).

## What stays as it is

- One import, one preview, one confirm: the user never splits a file by
  hand, and never sees "blocks" as separate imports.
- Documents, Notes, Tags, maps and Sections are still written **in one
  transaction, all or nothing** (spec 27 Decision 9). Splitting the text
  would break mentions between Documents of different blocks and leave
  half a Room on a failure, so only the images (already best effort, one
  transaction each) are split.
- The image pipeline (`remote_images`, `normalize_image`, Storage order
  `record_pending_upload` → upload → row → `confirm_upload`) and the
  20-images-per-Document cap. One import active per user and Room.

## Decisions (proposed by Claude, to be confirmed by the product owner)

### Limits

1. **Images: 200 → 2000 per import**, counted on the Documents **ticked
   in the preview** (and their maps and Sections), checked when the job is
   started. The upload keeps a looser sanity cap of **5000** image links
   across the files (spec 27 Decision 17, no unbounded input), so a big
   file still reaches the preview where the user can untick Documents.
   The preview shows the image count of the current selection, and the
   confirm button explains why it is disabled when the count is over 2000.
2. **Documents stay at 200** and the other spec 27 limits are unchanged
   (10 files, 5 MB each). Text is not what made imports heavy; raising it
   is a separate question (Open questions, Q2).

### Image phase in blocks

3. **Blocks of 25 images.** After the transaction, the job lists every
   image it has to fetch (Document images, map backgrounds, Section images,
   in that order) as a **work list** saved on the job row, and works
   through it 25 at a time, still 4 at a time inside a block. After each
   block it saves in one statement: how many are done, what was skipped
   and why, the new image ids map cards must point at, and the time.
4. **The work list is self-contained**: each entry names the target
   (Document, map or Section id, already written) and the source (URL or
   our own Storage path), the favorite flag and the file's image id. The
   job never re-plans after the transaction: the Documents it just wrote
   would now match the file's ids and look like "existing" ones (spec 27
   Decision 5).
5. **Stale means no progress**, not "started long ago": a job is taken as
   lost when it saved nothing for **30 minutes** (`IMPORT_STALE_AFTER`, now
   measured from `updated_at`). A 2000-image import may run well past 30
   minutes; a block of 25 never should.
6. **A restart resumes the images.** At startup, an active job still
   before its transaction is failed as today (`interrupted`: it wrote
   nothing). A job in its image phase is queued again and continues from
   the first entry not done. Each attached image marks its entry done in
   the **same transaction** as its image row, so a resume never adds an
   image twice; at most the images of the interrupted block that were
   still being fetched are fetched again.
7. **Our own links don't expire under a resume.** Images of an export from
   this app are read straight from Storage by path (as today, with the
   importer's visibility check at fetch time), so a resume hours later
   still finds them. A foreign URL that stopped answering is skipped and
   listed, as today.
8. **Map cards** still point at their chosen image once every image is
   attached (`_point_card_images`), reading the saved ids so a resumed job
   points them too.

### What the user sees

9. **Progress in the job panel**: while the images arrive, `ImportJobPanel`
   shows "Images: 120 of 450" with a bar under the line that says the
   Documents are already in the Room (they are, from the first second of
   the image phase, and open normally; their images appear as they come).
   `GET .../imports/{job}` returns `progress: {phase, images_done,
   images_total}`; the panel keeps polling as today.
10. The dialog can be closed and reopened as today. The result at the end
    lists what was skipped, now with how many images came across
    ("448 of 450 images imported, 2 skipped").
11. **No stop button** in this ticket: the text is already written and the
    images are best effort. A "Stop importing images" can follow if wanted
    (Q3).

## Design

- **Migration**: `import_jobs` gets `progress JSONB NULL` (phase, work
  list, done count, skipped list, attached ids) and `updated_at
  TIMESTAMPTZ NOT NULL DEFAULT now()`. `payload` (the parsed files) is
  cleared when the transaction commits, since the work list is all the
  image phase needs; `progress` is cleared, all but the counts, when the
  job ends (spec 27 Decision 17: no content kept). Existing rows need no
  backfill.
- `app/domain/imports.py`: `MAX_IMAGES = 2000` applied by the plan to the
  chosen Documents; `MAX_IMAGE_LINKS = 5000` in `validate_files`.
  `image_work_list(plan, written)` builds the work list (pure), and
  `next_block(progress)` / `record_block(progress, outcomes)` are pure too.
- `app/api/import_job.py`: `run_import_job` becomes "write, save work list,
  then blocks"; `resume_import_job(job_id)` enters at the blocks. The
  existing `_fetch_image` / `_store_image` / `_attach_backgrounds` /
  `_attach_section_images` are reused per entry.
- `app/db/import_jobs_repo.py`: `save_progress`, `requeue_image_phase`
  (startup), `sweep` on `updated_at`. The startup hook in
  `export_jobs_repo` calls the resume for jobs in the image phase.
- `start_import` refuses with `errors.import.tooManyImages` (max 2000) when
  the chosen Documents carry more; the upload uses
  `errors.import.tooManyImageLinks` (max 5000). New strings in the 12
  locales, both backend and frontend; the panel's progress line too.
- Docs: spec 27 Decision 8 gets a line pointing here; `architecture.md`
  (import job section) and the tracker.

## Units

- **59_1 backend + migration**: limits, work list, blocks, progress,
  stale on `updated_at`, resume at startup.
- **59_2 frontend**: selection image count and disabled confirm, progress
  bar, result count.

## Tests

- Domain: the image count follows the selection (2001 chosen refused, the
  same file with a Document unticked accepted); 5001 links refused at
  upload; the work list holds Documents, backgrounds and Section images in
  order with the right targets; `next_block` / `record_block` across the
  last partial block.
- Job: a 60-image import (blocks of 25, served by the test server) saves
  progress three times and ends `done` with every image; a failing image
  is skipped and listed; the payload is cleared after the transaction; a
  job stopped after its first block and resumed attaches the rest without
  duplicating any image; a job interrupted before its transaction is
  failed `interrupted` with nothing written; a job whose last save is 31
  minutes old is swept `stale`, one that started 2 hours ago but saved a
  minute ago is not; map cards point at images attached in a resumed run.
- API: `progress` in `GET .../imports/{job}`; `tooManyImages` at start.
- Frontend: the confirm button with the over-the-cap hint; the panel's
  progress line and the result count.
- Coverage stays at 100% for the backend files touched.

## Open questions

- **Q1 - Storage room.** 2000 WebP images of up to 1920 px are roughly
  0.4 to 0.8 GB. Supabase's free plan has 1 GB of Storage for the whole
  project. Is production on a plan with more, or should the cap be lower
  (for example 1000) until it is? Default: 2000.
- **Q2 - Documents.** Keep 200 Documents per import, or raise it too (for
  example to 500)? Default: keep 200.
- **Q3 - Stop button.** Add "Stop importing images" (the text stays, the
  rest is listed as skipped)? Default: not in this ticket.
- **Q4 - Block size.** 25 images per saved block. Smaller saves more often
  (less fetched twice after a restart), larger writes less. Default: 25.

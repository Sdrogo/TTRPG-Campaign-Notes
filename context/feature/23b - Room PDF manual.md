## Goals

- Export a Room as a **PDF laid out like a TTRPG manual**, in a style the user chooses (product owner's idea, 2026-10-02): something a group can print, keep or hand to players.
- Builds on the export tree of **23** (same content, same visibility rules).

## Decisions (product discussion, 2026-10-02)

1. **Structure**:
   - a **cover** with the Room's name and image (the favorite image of a Document chosen in the dialog, or none);
   - a **table of contents** with page numbers;
   - **one chapter per Main item** of the Room (single Tags and combinations, in the order of the Documents list); Documents in no Main item go in a last "Other" chapter. A Document in several items is printed once, in its first chapter, and referenced from the others ("→ p. 12");
   - **one section per Document**: favorite image, description, its Notes as **paragraphs after the description**, each under its title (product owner, 2026-10-06; boxed sidebars before); each Document on its own pages;
   - a closing **glossary of the Documents' names**, A–Z by initial letter, each with its Tags and page number (product owner, 2026-10-06; it replaced the index of Tags).
2. **Comments**: left out by default; an option adds them as an appendix per Document.
3. **Mentions** become internal links with a page reference ("Drago Rosso → p. 12"); a mention of something not in the PDF stays plain text.
4. **Styles**: presets, built in this order:
   - **Gothic** (the first one, product owner's choice 2026-10-02), inspired by the look of *Vampire: The Masquerade* manuals: black and deep blood-red accents, a full-bleed dark cover, distressed serif headings, red rules and drop caps, quotes set in italic sidebars, white pages for the body so it stays readable and printable. **Inspired by, never copied**: no logos, trademarked symbols, artwork or proprietary fonts from the game; only open-licensed fonts and original ornaments in the repo;
   - **Modern**: clean sans-serif, one column, generous whitespace;
   - **Print**: black and white, no backgrounds, ink-friendly.
   More presets later (a fantasy parchment one was mentioned), then custom colors or fonts.
5. **Page size**: A4 or Letter.
6. **Visibility**: only what the requester sees (as 23). With 22b the Master can generate it "as player X" to hand out.
7. **PDF Attachments** (character sheets, spec 16): optionally appended at the end; off by default.
8. **Generation**: on the server, in the background, with a "ready, download" notice: a large Room with images takes time.

## Design

### Backend (23b_1)

- **Rendering**: the export tree of 23 → HTML with one Jinja template per style and print CSS (CSS Paged Media: `@page`, running headers, `target-counter()` for page numbers in the TOC, glossary and mention links, `columns` for two-column styles) → PDF with **WeasyPrint**. Fonts are bundled in the repo (open licenses), not loaded from the web. Images are fetched through Storage with the backend's key, downscaled for print.
- **Deploy check first**: WeasyPrint needs Pango and its system libraries. Confirm Render's Python runtime can install them (or move the backend to a Docker image) before anything else; the fallback is headless Chromium (Playwright), which handles page numbers less well.
- **Jobs**: table `export_jobs` (`id`, `room_id`, `requested_by`, `options` JSON, `status` = `queued` | `running` | `done` | `failed`, `storage_path`, `created_at`, `finished_at`), RLS + deny policy. `POST /rooms/{id}/exports/pdf` creates a job and runs it in a background task in the same process (like the Storage sweeper); `GET /rooms/{id}/exports/{job}` returns the status and, when done, a signed **download** link (never rendered from the app's origin, as for PDF Attachments). The file lives in a private Storage prefix and is deleted after 24 hours through `storage_cleanup`. One running job per user and Room. The visibility snapshot is taken when the job starts, for the requester (or the 22b target).
- PDF Attachments are merged with `pypdf` when requested.
- Tests at 100% on the template data (what goes in which chapter, TOC entries, hidden content never present, mention links) and the job lifecycle; one smoke test renders a small Room to a PDF and checks page count and text.

### Frontend (23b_2)

- In the Export dialog of 23, a **PDF** option with style (thumbnail previews), page size, include Comments, include Attachments, cover image, Tag filter.
- Progress state while the job runs (polling every few seconds while the dialog is open; also listed on the Room page until downloaded), then a download button.
- New strings in `en.json` and `it.json`; the PDF's own fixed texts ("Contents", "Glossary", "Other") follow the requester's UI language.

## Implementation

- After 23_1 (shared export tree). **23b_1** backend (start with the deploy check), then **23b_2** frontend, into `staging`.
- Update `architecture.md` (PDF pipeline, jobs, temporary files).

## Definition of Done

- A Room with ~30 Documents and images renders in each of the three styles (Gothic first), A4 and Letter, with a working TOC, page references and glossary.
- A Player's PDF contains nothing hidden from them; the Master's "as player X" PDF matches what X sees.
- Files disappear from Storage after 24 hours. Checks green.

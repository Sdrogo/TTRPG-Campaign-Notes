## Goals

- Product owner's request (2026-10-07, follow-up of spec 27): export **one Document as a PDF**, laid out like a page of the Room manual (spec 23b): a handout for a player, a single NPC or place to print.
- Reuses the Room PDF entirely: the same export tree, styles, renderer and background job. Nothing in the Room PDF changes.

## Decisions (proposed 2026-10-07, refreshed 2026-10-28, confirm in the PR)

1. **Where**: the Document's Export dialog (spec 27 Decision 3) gains a third format, **PDF**, like the Room's dialog (spec 23b_2). Every member who sees the Document; with `X-View-As`, the Master generates it "as player X" (the member's id goes in the body as `view_as_user_id`, as for the Room PDF).
2. **Options**: style (Gothic, Modern, Print, Parchment from spec 35), page size (A4 / Letter), Comments (off; only those written as a Character, spec 23b Decision 2), PDF Attachments appended (off). No Tag filter and no cover picker: it is one Document.
3. **Layout**: a cover with the Document's name, the Room's name under it, and the Document's favorite image (its first one when none is marked; no image, no picture); then the Document's section exactly as in the manual: description, Notes as paragraphs, the Comments appendix when chosen. **No table of contents, no chapters, no glossary**: they mean nothing for one Document.
4. **Content and visibility**: what the requester sees of that Document, from the same `load_export` read as spec 27's single-Document export (404 for a Document they can't see). A mention of another Document is plain `#Name` (the PDF holds only this one, spec 23b Decision 3).
5. **Text layout** (added 2026-10-28): the Document's section runs in **one column across the full page width**, not in the manual's two columns: on its own page a handout reads better as one column, and the Room PDF's "fits one column, sits beside the next" rule (2026-10-19) has no neighbour to pair with. Descriptions and Notes render their Markdown (spec 48) and `#` mentions print as the bare name (2026-10-21), as in the Room PDF.
6. **Job**: the Room PDF job with a `document_id` in its options. It counts toward the "one active PDF per user and Room" rule (409), shows in the Room page's PDF list, is the requester's alone, expires after 24 hours like every PDF. File name `<document>-<date>.pdf`.

## Design

### Backend (27b_1)

- `PdfOptions.document_id: uuid.UUID | None = None` (stored in the job's options; older jobs read as none). `POST /rooms/{id}/exports/pdf` accepts it: 404 when the requester (or the "as" member) can't see the Document; `tag_ids` and `cover_document_id` must be empty with it (422).
- The run: `load_export(..., document_id=...)`, then `build_manual` in a single-Document mode (`Manual` with one section, no chapters, references or glossary, the cover from that Document); the templates skip the TOC and glossary when the manual has none. Images and Attachments as today. The job re-checks at start that the Document is still visible, else `refused`.
- `GET .../exports` returns `document_id` and the Document's name so the list can label it; the download is named `<document>-<date>.pdf`.
- Tests: a single-Document PDF of a Player holds nothing hidden from them; the Master "as player X"; no TOC or glossary in the rendered text; one full-width column; 404 for a hidden Document; 422 with a Tag filter; the 409 rule shared with Room PDFs.

### Frontend (27b_2)

- `ExportDocumentModal` gets the PDF format: `PdfStylePicker`, page size, Comments, Attachments, then "Generate PDF" and `PdfJobPanel`, all reused from the Room dialog; the start hook takes an optional `documentId`.
- `RoomPdfExports` labels a Document's PDF with the Document's name.
- New strings in all 12 UI languages (spec 34).

## Implementation

- After spec 27 (it builds on 27_1's `load_export` filter and on `ExportDocumentModal`). **27b_1** backend, **27b_2** frontend, into `staging`. No migration (the options are JSONB).
- Update `architecture.md` (Room PDF section) and `progress-tracker.md`.

## Questions for the product owner (2026-10-28)

1. Full-width single column (Decision 5), or the manual's two columns?
2. Cover page (Decision 3), or the Document starts on page 1 with its name and image as a header, which saves a page on a one-page handout?
3. The single-Document PDF shows up in the Room page's PDF list (Decision 6). OK, or should it appear only inside the Document's Export dialog?

## Definition of Done

- A member generates a PDF of one Document in each style; a Player's PDF holds nothing hidden from them.
- The Room PDF is unchanged.
- Backend `pytest` (100% coverage), `ruff`, `mypy`; frontend `npm run build`, `npm run lint`, `npm test`.

## Goals

- A Document's **Owners (and the Master, implicit Owner, D-12)** can attach **PDF files** to it. Typical use: a Player keeps the character sheet of their PC on the PC's Document.
- Readers of the Document can open or download the PDFs.
- Images keep their own pipeline; a PDF is a new kind of attachment, not an image.

> Spec: D-21, D-22, VR-12, FR-D8, UC-20, I-12 in `requirements.md` (v0.4). The defaults below are the ones recorded there.

## Decisions (recorded in `requirements.md`, change them there first)

1. **Visibility**: a PDF has **the Document's visibility** (no level of its own). Anyone who sees the Document sees its PDFs. A secret file goes on a secret Document. *(Alternative: own visibility like Notes, more work and a second filter.)*
2. **Who uploads and removes**: Owners + Master only (D-12, same as images and the description). Comments can't carry PDFs in this unit.
3. **Limits**: ≤ **10 MB** per file, ≤ **10 PDFs** per Document.
4. **Name**: the original file name is kept as the display name (trimmed, ≤ 200 chars, editable later if wanted). The stored object name is random.

## Design

### Backend (16_1)

- **Table** `document_files`: `id`, `document_id` (FK `ON DELETE CASCADE`), `storage_path`, `display_name`, `size_bytes`, `content_type` (`application/pdf`), `uploaded_by`, `created_at`. RLS + deny policy like every table (`tests/test_database_security.py`).
- **Storage**: same private bucket, path `documents/{document_id}/files/{uuid}.pdf`, through the existing `storage_cleanup` mechanism (row committed before the upload, removal after commit). The sweep must treat a path referenced by `document_files.storage_path` as in use, like `document_images` and `users.avatar_path`.
- **Validation by content, not by name**: the bytes must start with `%PDF-` and be within the size cap (read capped one byte past it, like `image_uploads.read_capped`). No re-encoding: PDFs are stored as uploaded.
- **Serving safely**: signed links (1 hour, same cache as images) created with Supabase's `download` option so the object is served with `Content-Disposition: attachment` and `application/pdf`. The UI opens the browser viewer through a blob URL fetched from that link (or offers plain download). A PDF can carry scripts; never embed it from the app's own origin.
- **Routes** (`app/api/document_files.py`): `POST /rooms/{id}/documents/{doc}/files` (multipart), `DELETE .../files/{file}`. Role check before any mutation (Invariant 6); the Document row lock before counting (cap can't be overshot). 404 for a hidden Document, like the other nested routes (`api/access.py`).
- **Returned** embedded as `files` in every single-Document response (`DocumentDetailResponse`), like Notes. Not in the Documents list (a card shows no files), so that path keeps its fixed number of queries. Maybe a count badge later.
- **Deleting a Document or a Room** must queue its files for Storage removal before the row goes, exactly like images (architecture.md -> "Deleting a Document", "Deleting a Room"). Extend `remove_images` into a shared removal or add `remove_files` next to it, called from both paths.
- **AuditLog**: not audited (it is not a visibility, role or Ownership change), like images.
- **i18n**: `errors.file.notPdf`, `errors.file.tooLarge`, `errors.file.tooMany`, `errors.file.notFound` in both locales.

### Frontend (16_2, after 16_1 is merged)

- A **Files** section on the Document detail page, under the gallery: a list of PDFs (icon, name, size, upload date), each with Open and Download; an Owner/Master also gets Upload (`FileButton`, `accept="application/pdf"`) and a delete icon with a small confirm.
- Client-side checks (type, size) only to give early feedback; the backend decides.
- Hook `useDocumentFiles` (TanStack Query mutations that update the Document cache from the response, like Notes).
- Strings in both locale files. Mobile: the list must work at phone width (NFR-05).

## Implementation

- 16_1 backend, branch `feature/16-1-pdf-backend`: migration (applied to the live DB with the user's go-ahead before merge), model, repo, domain rules (`app/domain/files.py`: size, count, name rules, plain dataclasses), routes, Storage helpers, sweep update, Document and Room deletion update. Tests at exactly 100%: Owner/Master upload; Player who isn't an Owner -> 403; non-PDF bytes with a `.pdf` name -> 422; over 10 MB -> 413/422; 11th file -> 409; hidden Document -> 404; deleting the Document or the Room queues every file; the sweep keeps referenced paths.
- 16_2 frontend, branch `feature/16-2-pdf-frontend`.

## Definition of Done

- An Owner uploads a PDF to their PC's Document, another member who sees the Document opens it, and a member who can't see the Document gets nothing.
- Backend and frontend checks green; architecture.md Storage Model updated.

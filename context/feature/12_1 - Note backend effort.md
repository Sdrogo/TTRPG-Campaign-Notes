## Goals

- Introduce the **Note**: an additional block of information attached to a Document, with its own **title**, **description** and **standalone visibility** (VR-03 already lists "blocco di un Documento" as content that carries a visibility; requirements.md section 7 mentions "blocco di informazione").
- This ticket is the **backend and DB half** of spec `12 - add Notes to Documents.md`. The UI is ticket `12_2 - Note frontend effort.md` and must not start before this one is merged and its migration applied to the live DB.

## Design

- A Document has zero or more Notes. A Note has: `id`, `document_id`, `title`, `description`, `visibility` (Room / Master / Private / Selective, the same four levels as a Document), a Selective grant list, `position` (display order within the Document), `created_by`, `created_at`, `updated_at`.
- **A Note is the Detail of D-18** (confirmed by the product owner, 2026-10-01: same feature, two names; "Note" is the name used in code, routes and UI). It deliberately departs from D-19: it lives in its own table, is managed by the Document's Owners and the Master (not written by any member as a Thread Post), and has no replies. The departure is an Open Question against `requirements.md`.
- **Visibility is independent of the Document's, but never wider in effect**: a Note is only reachable through a Document the viewer already sees (hidden Document -> 404 for its Notes too, VR-07), exactly like Comments.
- Who sees a Note, by level (reusing `app/domain/visibility.py::is_content_visible`, with the Document's Owners as the "Owner"):
  - Room: every member who sees the Document.
  - Master: Masters only.
  - Private: the Document's Owners and the Master.
  - Selective: Owners, Master and the granted users.
- **A Note the viewer cannot see must be absent from every response**: not in the list, not in a count, not as an empty placeholder, not as an id in an error. A Document with only hidden Notes looks identical to one with none (Invariant 1, VR-07).
- Permissions, following the Document matrix (section 9, D-12): Owners and the Master create, edit, reorder, delete a Note and change its visibility. Nobody else can.
- The description is plain text with the same `#Name` mentions as a Document description: **no backend parsing, no new column type**. Same length rule as the Document description (reuse its limit and validator, do not copy it).
- Limits (implementation choices, log them under Open Questions): title required, trimmed, <= 200 chars (like a Document name); at most 50 Notes per Document.

## Implementation

- Create a new branch from `origin/main` (`feature/12-1-notes-backend`).
- **Migration** (Alembic, next after `b5d8f2a9c1e3`): tables `document_notes` and `document_note_visibility_grants` (FK to `documents` and to the note with `ON DELETE CASCADE`, so deleting a Document removes its Notes; they hold no Storage objects, so no `storage_cleanup` is needed). Every new table must `ENABLE ROW LEVEL SECURITY` and create the `backend_only_deny_clients` policy, or `tests/test_database_security.py` fails. No `NOT NULL` column without a `server_default` on a table with rows (none expected, the tables are new).
- **Domain** (`app/domain/notes.py`, framework-independent): dataclass, field validation (raises `DomainError` subclasses with translation keys), the permission rule (`Owner or Master`), the position rule. Visibility goes through the existing `is_content_visible`; do not write a second filter. Add a `Note` dataclass to `app/domain/models.py`.
- **DB layer** (`app/db/notes_repo.py`): reads and writes only, in a fixed number of queries. Batch the Selective grants for a Document's Notes in one query, and read them only for Notes that survived the filter where that is possible.
- **API** (`app/api/notes.py`, nested under the Document, reusing `app/api/access.py` for the membership and "can this viewer see the Document" checks):
  - `GET /rooms/{id}/documents/{doc}/notes` — visible Notes only, ordered by `position`.
  - `POST` — create (Owner/Master); appended at the end.
  - `PATCH /{note}` — title, description, visibility, grants.
  - `PUT .../notes/order` — replace the order with `{note_ids: [...]}` (same "all ids of this Document, no duplicates, 422 otherwise" shape as `plan_main_items`). Skip it, and say so in the PR, if reordering is judged out of scope; creation order then defines the order.
  - `DELETE /{note}`.
  - Each Note in a response carries `can_edit` and `can_delete`, so the UI never re-derives the rules (as Comments do).
  - Notes are also **embedded in the Document detail response** (`GET /rooms/{id}/documents/{doc}`), so the detail page needs no second request. They are **not** in the Documents list response: that path is batched to a fixed number of queries (architecture.md) and the card does not show Notes. Decide and document this in the PR.
  - A hidden Document or a Note the viewer cannot see answers **404, not 403**.
- **AuditLog** (Invariant 7, VR-08): a visibility or grant-list change writes a `note_visibility_changed` row in the same transaction. Create/edit/delete are not logged (same as Comments).
- **i18n**: every new `detail` goes through `app/i18n/locales/{en,it}.json` (`errors.note.*`); `tests/test_i18n.py` must still pass.
- **Docstrings** on every public module, class and function in `app/` (ruff `D1` gate).
- **Tests are part of the effort, coverage stays at exactly 100%** (domain and `app/`):
  - domain: validation, permission rule, order planner;
  - API/DB: every visibility level x viewer (Master, Owner, granted member, other member, non-member), 404 for a hidden Document and a hidden Note, a hidden Note absent from the detail response, Owner/Master-only writes (Player gets 403), AuditLog row on visibility change and none otherwise, cascade on Document delete, the 50-Note cap, 422 cases;
  - `tests/test_database_security.py` covers the two new tables.

## Definition of Done

- Notes can be created, read, edited, reordered (if kept) and deleted through the API, with per-Note visibility enforced for every viewer and no leak of a hidden Note anywhere.
- Migration applied to the live DB with the user's go-ahead **before the merge** (code deployed before its migration caused a 500 on spec 11).
- Technical and project documentation is updated: `architecture.md` (Storage Model: the Note tables, permissions, where they are embedded, why not in the list), `progress-tracker.md` (completed unit, choices to confirm), and Open Questions for the assumptions below.
- All backend tests pass, `ruff`, `mypy` strict and the backend build pass locally and on CI.
- Git commit, push and PR are part of the task; backend work only in this PR, presented as a link to finish the job.

## Open questions to log in `progress-tracker.md`

- Naming: resolved - Note = Dettaglio (D-18). Open: amend D-19/I-10/FR-T10 to match the Owner/Master-managed model, or move Notes onto `posts` later.
- Private means "the Document's Owners and the Master", not "the Note's creator", since a Note has no separate author in the ownership sense. Confirm.
- Limits (title 200, 50 Notes per Document) and the optional reordering.
- Whether Notes appear on the Document card (assumed no) and in the Agent export (not built yet; the export must apply the same filter, FR-G1).

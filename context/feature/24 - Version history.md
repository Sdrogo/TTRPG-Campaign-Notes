> **Reshaped 2026-10-06** by `24b - Whole-Document history.md`: Notes no longer have a history of their own; the Document's history covers them.

## Goals

- FR-D5: keep the **history of a Document's text** and let the people who edit it **compare and restore** an earlier version.

## Decisions (product discussion, 2026-10-02)

These complete FR-D5 in `requirements.md` and don't change it.

1. **What is versioned**: a Document's **name and description**, and each Note's **title and text**. Not Tags, images, Attachments, Owners or visibility (visibility has its own history, ticket 22).
2. **When**: every save creates a version, but saves by the **same person within 10 minutes** are merged into the latest version (it is updated, not added), so typing sessions don't flood the list.
3. **Who**: the Document's **Owners and the Master** (those who may edit it, D-12) see the history and restore. **Restoring creates a new version** with the old text, so nothing is ever lost.
4. **Compare**: a side-by-side view of any version against the current one, with the differences highlighted (words added and removed).
5. **Retention**: every version is kept, without limit (text only, small).

## Design

### Backend (24_1)

- **Migration**: `document_versions` (`id`, `document_id`, `name`, `description`, `edited_by`, `created_at`, `updated_at`) and `note_versions` (`id`, `note_id`, `title`, `description`, `edited_by`, …), `ON DELETE CASCADE` from the Document / Note, RLS + deny policy. A backfill writes the current text of every Document and Note as its first version (author: the Document's creator, time: its last update).
- **Domain** (`app/domain/versions.py`): `plan_version(previous, editor, now, text)` → append a new version, or update the latest when it is the same editor within 10 minutes; nothing when the text didn't change. Called in the same transaction as the Document and Note edit routes, and by the restore.
- **Routes**: `GET /rooms/{id}/documents/{doc}/versions` (list without bodies: author, time, a short summary of the change size), `GET .../versions/{v}` (full text), `POST .../versions/{v}/restore`; the same under `.../notes/{note}/versions`. Owners and the Master only, via `access.get_owned_document` (404 before 403). A Note's history follows the Note's visibility as well: an Owner who can't see a Note (it is Master-only) can't see its history either.
- Mention tokens (ticket 20) are stored as they are; restoring rewrites `document_mentions` like any save.
- Not audited (text edits aren't, Invariant 7); the version list itself is the record.
- Tests at 100%: merge window (same editor inside / outside 10 minutes, another editor inside), unchanged save writes nothing, restore creates a version, permissions, a hidden Note's history refused, cascade on delete.

### Frontend (24_2)

- "History" in the Document menu and in each Note's menu (for those who can edit): a drawer listing versions (author avatar, relative time); selecting one shows the side-by-side diff against the current text (a small diff library such as `diff`, word level), with **Restore** behind a confirmation.
- Mobile: the diff stacks vertically (old above, new below).
- New strings in `en.json` and `it.json`.

## Implementation

- **24_1** backend and migration (with the backfill), then **24_2** frontend, into `staging`. Independent of 19–23.
- Update `architecture.md` (versions, merge window).

## Definition of Done

- An Owner edits a description three times within a few minutes: one version. A different Owner edits it: a second version. The diff shows what changed; restoring the first adds a third version with the old text.
- A Player who isn't an Owner sees no History entry, and the API refuses them.
- Checks green.

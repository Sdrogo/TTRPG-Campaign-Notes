## Goals

- FR-G1: export a Room's content as **structured data** (JSON) and as **readable text** (Markdown), scoped to what the requester may see (UC-17, I-01).
- The export is for people as much as for AI Agents (product discussion, 2026-10-02): a backup, a handout, the input of an Agent.
- Siblings: **23b** (the Room as a PDF laid out like a TTRPG manual) and **23c** (direct access for an Agent with a personal token, FR-G2).

## Decisions (proposed 2026-10-02, product owner agreed to the export direction; confirm the details)

1. **Formats**: JSON (for Agents and tools) and Markdown (one file, readable by a person). Both carry the same content.
2. **Content**: Room name; Tags (with category and the Main items order); Documents with name, description, Tags, Owners, the Character player, Notes, Comments with their replies (ticket 19), mentions with ids (ticket 20); images and PDF Attachments as **signed links** only (no binaries), labelled as expiring. Not included: the AuditLog, invitations, member emails.
3. **Visibility**: exactly what the requester sees, built with the same domain functions as the other read paths (NFR-01, VR-07). Visibility levels and grant lists are included only where the requester may manage that content (as the API does today).
4. **Who**: every member, for what they see. With 22b the Master can export "as player X".
5. **How**: "Export" in the Room's menu opens a dialog (format, optional Tag filter), then downloads a file `<room>-<date>.json|md`.
6. **Partial export**: the whole Room or only the Documents with chosen Tags (AND, like the list filter), with their Notes and Comments.

## Design

### Backend (23_1)

- `app/domain/export.py`: builds a format-independent export tree from already-filtered rows (pure, easy to test); `render_json` and `render_markdown` serialize it. JSON has a `schema_version` and stable ids (UUIDs) for every object, and references between objects by id (Document → Tags, mention → Document, reply → parent).
- Mention tokens become `[Name](#doc-<id>)` links in Markdown and `{type: "mention", target_id}` spans in JSON.
- `GET /rooms/{id}/export?format=json|md&tag=…` (members only), streamed with `Content-Disposition: attachment`. Reads in a fixed number of queries per kind (like the Documents list), never one per Document (NFR-04).
- Tests at 100%: a Master-only Document, Note, reply and image never in a Player's export (both formats); Tag filter; ids stable across two exports; the Master's export holds everything.

### Frontend (23_2)

- "Export" dialog in the Room menu (and on the setup page), download through a blob like PDF Attachments.
- New strings in `en.json` and `it.json`.

## Implementation

- **23_1** backend, **23_2** frontend, into `staging`. Best after 19 and 20 (replies and mention ids are part of the format); if built earlier, `schema_version` goes up when they land.
- Update `architecture.md` (export format, versioning). Closes the Open Question "Agent export format".

## Definition of Done

- A Player and the Master export the same Room in both formats: the Player's files contain nothing hidden from them; the Master's contain everything.
- The JSON validates against the documented schema; the Markdown reads well with Documents grouped like the list.
- Checks green.

## Goals

- A Document can be marked as a **Character played by a member** of the Room (a PC). The default Tag "PC" stays a Tag (D-05: no Document types); the link to a player is a separate relation, like Ownership.
- A member can **write a Comment as one of their Characters**: it shows the Character's name and picture, with the real user still identifiable.
- Comments are the only Posts that exist today (the full Thread is still in Next Up), so "posts" in this ticket means Comments. When Threads land, the same field applies to every Post.

> Spec: D-23, D-24, D-25, VR-13, FR-D9, FR-T11, UC-21, UC-22, I-13 in `requirements.md` (v0.4). The defaults below are the ones recorded there.

## Decisions (recorded in `requirements.md`, change them there first)

1. **Who links a Character to a player**: the **Master** (or an Owner of the Document, D-12) picks the player among the Room's members. The player doesn't have to confirm.
2. **How many**: a Document has **at most one player**; a member can play **several** Characters in the same Room.
3. **Does the player become an Owner?** Not automatically. Setting the player offers to also add them as Owner (one checkbox, checked by default), so they can edit their sheet and upload its PDF (spec 16).
4. **Who may post as a Character**: only its player. The **Master may post as any Document of the Room** (to speak as an NPC). *(Alternative: the Master is limited to Documents tagged NPC, or gets no in-character posting.)*
5. **Visibility leak rule**: a Comment posted as a Character shows the Character's name and picture **only to viewers who can see that Character's Document**. Everyone else sees the plain author, as today. Otherwise a hidden NPC's name would leak through a Comment (VR-07, Invariant 1).

## Design

### Backend (17_1)

- **Column** `documents.played_by` (nullable UUID, the player's user id; no FK to `auth.users`, like every user reference). Cleared when that member leaves or is removed (D-15: the Document stays, the link goes), in the same transaction as the membership deletion.
- **Column** `posts.as_document_id` (nullable FK to `documents`, `ON DELETE SET NULL`: deleting the Character turns its Comments back into plain ones, which widens nothing).
- **Domain** (`app/domain/characters.py`): `can_set_player` (Master or Owner), `can_post_as(document, membership)` (player of that Document, or Master), and the read rule `character_shown_to(viewer, comment, visible_document_ids)`.
- **Routes**: `PUT /rooms/{id}/documents/{doc}/player` `{user_id | null, add_as_owner: bool}`; the player must be a member (422 otherwise). It's an Ownership-adjacent change, so write an AuditLog row `character_player_changed` (and the Owner change one when `add_as_owner` applies, Invariant 7).
- Comment create/edit accept `as_document_id`; checked with `can_post_as` before the write (403). The Document must be in the same Room and visible to the author.
- **Responses**: Document responses carry `played_by` (profile fields via `api/profiles.py`). `CommentResponse` gains `as_character: {document_id, name, image_url} | null`, filled only when the viewer may see that Document (batched with the existing visibility filter, no extra query per Comment).
- `GET /rooms/{id}/characters/mine` (or a field on the members list): the Characters the caller may post as, for the composer's picker.

### Frontend (17_2, after 17_1 is merged)

- Document detail: "Played by" with a member picker (`MemberMultiSelect` in single mode) for the Master/Owners, plus the "also make Owner" checkbox. The Document card shows the player's avatar.
- Comment composer: a "Post as" selector (yourself, or one of your Characters) shown only when the caller has at least one; the last choice is remembered per Room in `localStorage` (convenience only).
- A Comment written in character shows the Character's name and favorite image, with "played by {user}" in small text. A link to the Character's Document.

## Implementation

- 17_1 backend, branch `feature/17-1-characters-backend`: migration (RLS unchanged: only columns are added), domain, repos, routes, AuditLog, membership removal clears `played_by`. Tests at exactly 100%, including: a Player can't post as someone else's Character (403); the Master can post as an NPC; a viewer who can't see the Character's Document gets `as_character: null`; removing a member clears their links; deleting the Character keeps its Comments.
- 17_2 frontend, branch `feature/17-2-characters-frontend`.

## Definition of Done

- The Master links "Aria" to a Player, the Player writes a Comment as Aria, other members see it as Aria, and a member who can't see Aria's Document sees the Player's own name.
- Checks green; architecture.md updated.

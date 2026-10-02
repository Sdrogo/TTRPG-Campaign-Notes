## Goals

- A Comment can be **answered**: replies nest under the Comment they answer, so a Document's main Thread (D-20) becomes a real conversation instead of a flat list.
- A reply is **never more visible than the Comment it answers** (D-17, VR-04, FR-V6, Invariant I-09), enforced in the domain layer, on every read path.
- Long branches stay readable: limited indentation (FR-T2) and collapsed branches (FR-T4).
- Spec: FR-T1, FR-T2, FR-T4 (collapse only), FR-T5, FR-V6 in `requirements.md`. Out of this ticket: the unread indicator (**19b**), reactions, @User mentions, pinning, "resolved" and promotion (**19c**), server-side pagination (FR-T3, see Decision 3).

## Decisions (product discussion, 2026-10-02)

These agree with `requirements.md` (D-17, FR-T2) and only add detail, except Decision 6, which is still to confirm; `requirements.md` is not changed.

1. **Depth**: three visible levels (a Comment, its replies, their replies). Anyone can still answer a third-level reply; the reply is stored under the post it really answers, but it is **drawn at the third level** with an "in reply to *Name*" line. The data stays a true tree; only the indentation is flattened.
2. **Visibility of a reply**:
   - A new reply **starts with its parent's visibility** (and grant list, for Selective). The author may narrow it, never widen it: a reply whose audience isn't contained in its parent's is refused (VR-04, UC-12).
   - If the parent is **later narrowed**, its replies are **narrowed automatically**: a member who can't see the parent doesn't see the replies either. The reply's own visibility is **kept as its author chose it**, so when the parent becomes visible to that member again, the reply is back to its previous visibility with nothing to restore.
3. **Order and filters**: the Comment toolbar (sort, search, author, visibility, hide deleted) **picks and orders the top-level Comments**; a top-level Comment that is shown brings its **whole branch**, and replies are ordered with the same sort. Loading stays as today (the whole Thread at once, filtered client-side); paginating it is left for when Threads get long in practice.
4. **Collapsing**: a branch with **more than 3 replies** (at any depth below it) starts collapsed to its first 2, with a "Show N more replies" control; any branch can be collapsed and expanded by hand. Not remembered across visits.
5. **Writing as a Character** (D-24, FR-T11): a reply can be written as a Character with the same rules as a Comment (VR-13).
6. **The author and a hidden parent** *(to confirm with the product owner before 19_1)*: today the author always sees their own Comment (VR-02, `architecture.md` → Comment visibility). Proposed: an author who **loses sight of the parent** loses sight of their own reply too, so nobody sees a reply detached from its conversation; it comes back when the parent does. This narrows VR-02 for replies only; if confirmed, `architecture.md` changes in the 19_1 branch and the VR-02 wording needs a product pass (`requirements.md` is protected). *Alternative*: the author keeps seeing their reply, shown under a "parent hidden" placeholder.

## Design

### Backend (19_1)

- **Migration**: nullable `comments.parent_id` (FK to `comments.id`, `ON DELETE CASCADE`, index). A reply belongs to the same Document as its parent; the domain layer checks it (the API only accepts a parent from the URL's Document), so no trigger is needed.
- **Domain** (`app/domain/comments.py`, `app/domain/visibility.py`):
  - `plan_new_comment` takes an optional parent: the parent must exist, belong to the Document, be visible to the author, and not be deleted (no answering a placeholder).
  - `ensure_not_wider(reply, parent, members)`: every member of the Room who would see the reply on its own must also see the parent. Compare **audiences** (sets of members), not level names, because Selective and Private aren't ordered. Used on create and on every visibility or grant edit of a reply.
  - **Effective visibility**: a Comment is visible to a viewer when it is visible on its own **and its parent is visible** (recursively up to the top-level Comment). `is_comment_visible` gains the parent chain (or a helper over the Document's Comments by id), and every caller uses it: the Thread list, the single Comment, and the **Document gallery** (an image attached to a reply follows the reply's effective visibility, `visibility.py` image filter). The future Agent export (FR-G1) must use the same function.
  - The author of a reply follows Decision 6.
  - Narrowing a parent doesn't touch its replies' rows, so it writes no AuditLog row for them; only the parent's own visibility change is audited, as today (VR-08).
- **API** (`app/api/comments.py`): `CreateCommentRequest` gains `parent_id`; `CommentResponse` gains `parent_id`. A reply is a Comment in every other way (edit, delete as a placeholder, images, Character). Deleting a Comment that has replies leaves its placeholder and the replies (FR-T5). The list stays flat (each item with its `parent_id`); the client builds the tree.
- Tests at 100%: reply to a missing, deleted, foreign-Document or hidden parent; wider audience refused on create and on edit (each level pair, Selective subset); parent narrowed hides the replies from the right members and restores them when widened; images of a hidden reply leave the gallery; Master sees everything (I-03).

### Frontend (19_2)

- `lib/comments.ts`: `buildCommentTree` (from the flat list, by `parent_id`) and the toolbar rules of Decision 3 applied to the top level, the same sort inside each branch. The "shown of total" counter counts top-level Comments.
- `CommentItem`: a **Reply** button opens the composer under the post; the composer starts with the parent's visibility and grants and only offers the options that aren't wider (the backend still decides). Indentation for levels 2 and 3, "in reply to *Name*" below that.
- Collapsed branches per Decision 4, with a count; expanding is local state.
- Mobile: the indentation step stays small enough at 390px that level 3 is still readable.
- New strings in `en.json` and `it.json`.

## Implementation

- Two branches into `staging`: **19_1** backend (migration, domain, API), then **19_2** frontend after 19_1 is merged and the migration is live.
- Tests at exactly 100% on both sides, as for earlier units.

## Definition of Done

- A Player answers a Master's Comment, the Master answers the reply, a third member answers that: three levels shown, a fourth reply drawn at level 3 with "in reply to".
- The Master narrows the top Comment to "Master only": the Player no longer sees the branch, including the reply's images in the gallery. Widening it back shows the replies with their old visibility.
- A reply wider than its parent is refused with a clear message.
- Checks green; `architecture.md` updated (effective visibility of a reply).

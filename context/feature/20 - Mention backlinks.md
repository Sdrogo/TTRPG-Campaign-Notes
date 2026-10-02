## Goals

- Finish FR-D4: every Document, and every Tag, shows **which Documents mention it** ("Mentioned in"), filtered per viewer.
- Make mentions **survive a rename** and tell apart Documents with the same name: a mention stores the id of what it points to, not only its name.
- Today a mention is plain `#Name` text resolved in the browser (`architecture.md` → Storage Model → Mentions, spec 06). That stays the way it is *typed*; only how it is *stored* changes.

## Decisions (product discussion, 2026-10-02)

These complete FR-D4 in `requirements.md` and don't change it.

1. **Mentions are stored with an id**: the text still reads `#Name` while typing and reading, but is saved as a token `#[Name](doc:<uuid>)` (or `tag:<uuid>`). The name in the token is the name **at the time of writing**; a reader who sees the target gets its **current** name. The popup can now tell same-named Documents apart (it shows their Tags).
2. **Existing text is converted once** with the rule the browser uses today (longest name wins, a Document beats a Tag with the same name; with duplicate names, the oldest Document). A `#Name` that matches nothing stays plain text.
3. **Sources of backlinks**: a Document's description, its Notes, and its Comments (replies included, once ticket 19 lands).
4. **"Mentioned in"** lists, per mention: the source Document, where the mention is (description, the Note's title, or "Comment by *Name*"), and a short excerpt around it (about 120 characters).
5. **Visibility (VR-07, Invariant 1)**: a backlink is listed only when the viewer sees the source Document **and** the Note or Comment holding the mention (effective visibility, ticket 19). A mention never reveals a hidden target either: a token pointing at a Document the viewer can't see renders the **stored** name as plain text, never the current one.
6. **Where**: a collapsible "Mentioned in" section on the Document page, between the Notes and the Comments; hidden when empty.
7. **Deleted target**: the mention renders as plain text with its stored name.
8. **Tag mentions get backlinks too** (product owner, 2026-10-02): a Tag mention still opens the Documents list filtered by that Tag, stored with an id so renaming the Tag no longer breaks it, and the Tag gets the same "Mentioned in" list with the same rules (Decisions 3 to 5, 7). A Tag has no page of its own, so its list is shown on the **Documents list filtered by exactly that one Tag**, as a collapsible section above the Documents, hidden when empty. A deleted Tag's rows go with it.

## Design

### Backend (20_1)

- **Token grammar** `<sigil>[Name](<kind>:<uuid>)`, shared with the `@User` mentions of ticket 19c: `#[Name](doc:<uuid>)`, `#[Name](tag:<uuid>)`, `@[Name](user:<uuid>)` (the `user` kind is parsed here and used by 19c; until 19c lands it stays plain text); a parser in `app/domain/mentions.py` (pure, tested on edge cases: brackets or parentheses in names, unknown kinds, malformed tokens stay text). The name in a token is escaped (`]`, `\`).
- **Table** `document_mentions` (`source_document_id`, `source_kind` = `description` | `note` | `comment`, `source_id` (the Note or Comment, null for a description), `target_document_id` or `target_tag_id` (exactly one set, CHECK), `excerpt`), RLS + deny policy, `ON DELETE CASCADE` from both Documents, the target Tag, the Note and the Comment. Filled **on save**: creating or editing a description, a Note or a Comment rewrites that source's rows in the same transaction. Mentions of a Document outside the Room are dropped (never stored, never linked).
- Saving checks every `doc:`/`tag:` id: one that doesn't exist in the Room is turned back into plain text, so a client can't forge a link.
- **Routes** `GET /rooms/{id}/documents/{doc_id}/backlinks` and `GET /rooms/{id}/tags/{tag_id}/backlinks`: the rows whose target is this Document, filtered with the same visibility functions as the Document, Note and Comment routes (no new rule), grouped by source Document. A viewer who can't see the target Document gets 404, as for the Document itself; Tags are visible to every member.
- **Data migration**: converts existing descriptions, Notes and Comments per Decision 2 and fills `document_mentions`. Reversible (the downgrade writes the names back as plain `#Name`). Applied to the live database only with the product owner's go-ahead, as for earlier migrations.
- Tests at 100%: rename keeps the link; forged ids; a hidden source or a hidden Comment never listed; the Master sees all backlinks; deleting a source or a target (Document or Tag) cleans up; a Tag's backlinks follow the same filter.

### Frontend (20_2)

- `lib/documentMentions.ts`: `splitMentions` reads tokens (and still reads plain `#Name`, for text not yet converted or typed before a deploy); `insertMention` writes tokens. The textarea shows `#Name`, never the token syntax.
- `MentionText`: a token resolves by id against the viewer's Document and Tag lists; missing means plain text with the stored name (Decision 5, 7).
- Popup: same-named Documents show their Tags to tell them apart.
- "Mentioned in" section (`components/mentions/Backlinks.tsx`) with its own query, collapsible, on the Document page and on the Documents list filtered by exactly one Tag, each entry a link to the source Document (and to the Comment's anchor when it comes from a Comment).
- New strings in `en.json` and `it.json`.

## Implementation

- **20_1** backend and migration, then **20_2** frontend, two branches into `staging`. Can be built before or after 19; if 19 is merged first, replies are sources like any Comment.
- Update `architecture.md` (Mentions are no longer plain text; the open item on backlinks is closed).

## Definition of Done

- Document A mentions B in its description, in a Note and in a Comment; B shows three entries under "Mentioned in". Renaming B updates the three mentions. The same works for a Tag `#T`: the list filtered by `T` shows where it is mentioned, and renaming `T` keeps the mentions.
- A Player who can't see the Note sees only two; a Player who can't see A sees none, and A's mention of a hidden Document shows only the stored name as text.
- Old `#Name` text renders exactly as before the migration.
- Checks green.

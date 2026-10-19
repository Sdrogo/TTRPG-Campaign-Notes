# 39 - Generate mentions

## Goals

- Product owner's request (2026-10-19): a "Genera menzioni" button on a
  Document that looks for the names of the Room's other Documents in its
  text and turns them into mentions, so nobody has to type `#` in front of
  every name by hand. The same for the whole Room at once. Then (same day):
  new Document names link **by themselves on save**, and Tags stay out of
  both (Decision 10).
- Builds on the stored mentions of spec 20: a generated mention is the same
  `#[Name](doc|tag:<uuid>)` token a typed one is, so it links, survives a
  rename and feeds "Mentioned in" and the mention map (spec 36).

## Decisions (defaults picked 2026-10-19, to confirm in the PR; 10 is the product owner's)

1. **Preview before applying**: the button never changes text directly. It
   opens a dialog listing every proposed mention, each with a few words
   around it, grouped by Document and by where it is (description or a
   Note). Nothing is saved until "Applica".
2. **Every occurrence, with per-match opt-out**: each occurrence of a name
   is proposed, each with a checkbox (checked by default); a group's
   checkbox selects or clears all of its matches.
3. **Only what the user sees and may edit**: names come from the Documents
   the user sees (VR-07), **never from Tags** (product owner, 2026-10-19:
   too many Tags are ordinary words); the texts scanned are the
   descriptions and the visible Notes of the Documents the user manages
   (an Owner or the Master, D-12). A hidden Document's name is never
   proposed, so the dialog can't reveal that it exists.
4. **Existing mentions are never touched**: text already inside a mention
   token, and a plain `#Name` the browser already shows as a mention, are
   skipped.
5. **How a name matches**: as a whole word (it can't start or end inside a
   word), ignoring case but not accents, the longest name first where names
   overlap ("Castello Drakon" before "Drakon"). A Document's own name is not proposed in its own text.
   Names shorter than 3 characters are ignored (too many false hits), and a
   name two visible Documents share is not proposed (it is ambiguous; the
   `#` popup still tells them apart).
6. **What is written**: the token keeps the words as written in the text
   (`la locanda` → `#[la locanda](doc:…)`); a reader who sees the target
   reads its current name, as with every mention.
7. **Stale preview**: applying recomputes the proposals on the current
   text; if any chosen match is no longer there (someone edited the text in
   between), nothing is saved and the dialog asks to reload the preview
   (409).
8. **One save per Document**: applying edits descriptions and Notes through
   the same rules as an edit (mention cleaning, "Mentioned in" rows), and
   records one revision per Document in its history (spec 24b), in one
   transaction for the whole request.
9. **Where**:
   - On a Document: an action among the Document's actions, for its Owners
     and the Master (not while previewing as a member).
   - On the Room: "Genera menzioni" in the Room's title menu on the
     Documents page, for every member; it scans every Document they manage.
     Someone who manages none sees an empty dialog.

10. **Automatic on save** (product owner, 2026-10-19): saving a
    description or a Note (created or edited) links, with no preview, the
    names of the Documents the writer sees that the save **added**: only in
    the part of the text the save changed, and only for a Document the text
    now names more often than before (plain words and mentions together).
    So turning a mention back into plain words, or editing near a name left
    plain on purpose, never links it again. Same matching rules (Decisions
    3 to 5), never Tags, not Comments. Text written before this, or before
    the named Document existed, is what the button is for. A restored
    revision (spec 24b) is written back as it was.

## Design

### Backend (39_1)

- `app/domain/mention_suggestions.py` (pure): `usable_candidates` and
  `suggest_mentions` find the matches (`start`, `end`, the written text,
  target) by Decisions 3 to 5; `apply_mentions` writes them as tokens;
  `link_new_names(text, previous, candidates)` is Decision 10, called by
  `app/api/mentions.py::link_document_names` from the create and edit
  routes of Documents and Notes, after `clean_content_mentions`.
- `app/api/mention_suggestions.py`:
  - `GET /rooms/{id}/documents/{doc}/mention-suggestions`: 404 for a
    Document the caller can't see, 403 if they don't manage it.
  - `GET /rooms/{id}/mention-suggestions`: every Document the caller sees
    and manages.
  - Both answer `{sources: [{document_id, document_name, note_id,
    note_title, matches: [{start, end, text, kind, target_id, target_name,
    before, after}]}]}`, sources with no match left out; `before`/`after`
    are about 40 characters of the text around the match as a reader sees
    it.
  - `POST /rooms/{id}/mention-suggestions/apply` `{sources: [{document_id,
    note_id, matches: [{start, end, kind, target_id}]}]}`: the same checks
    per source (404/403, a Note the caller can't see is 404), 409 per
    Decision 7, then the save of Decision 8. Answers `{applied, documents}`.
- No migration.

### Frontend (39_2)

- `hooks/useMentionSuggestions.ts` (the two queries and the apply mutation,
  which reloads the Room's Documents, the Documents touched and their
  backlinks).
- `components/mentions/GenerateMentionsModal.tsx`: the dialog of Decisions
  1, 2 and 7.
- The Document action and the Room menu item of Decision 9.
- New strings in every language.

## Definition of Done

- Typing "Lyra" in a description and saving links it to the Document
  "Lyra"; a Tag "Nord" is never linked.
- A description saying "Lyra entra nella Locanda", written before the
  Documents "Lyra" and "Locanda" existed, proposes two mentions; unchecking
  one and applying links only the other, and the target's "Mentioned in"
  lists it.
- A Player who doesn't see "Locanda" is never offered it; a Player who
  owns no Document gets nothing to apply.
- Text already holding `#Locanda` is not proposed again.
- Checks green.

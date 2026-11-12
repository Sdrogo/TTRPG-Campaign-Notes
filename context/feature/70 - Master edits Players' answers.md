# 70 - Master edits Players' answers

## Goals

- Product owner's request (2026-11-12): the **Master can edit the Players'
  answers** in the **Questions** (Domande) step of Session 0, and in the
  **standalone** Questions tool that lives in a Section block (spec 60).
- Typical uses: fix a typo before "Crea i Documenti di tutti", shorten an
  answer that is too long for a Name, fill in an answer a Player gave out
  loud at the table.
- Same behaviour in both places: the Session 0 step and the Section tool
  block render the same `QuestionsBoard` and call the same module routes, so
  one change covers both.

## How it works today

- Spec 47 Decision 10: each Player answers in a form saved as they type
  (`PUT .../modules/{m}/answers`, the caller's own answers only). The Master
  doesn't answer (`ensure_can_answer` → 403).
- The Master sees every Player's answers read-only, one accordion row per
  Player (`AnswersByPlayer` in `QuestionsModule.tsx`), and can reveal them to
  everyone (read-only for the others).
- Answers are stored in `session_zero_answers` (`question_id`, `user_id`,
  `body`, `note_private`, `updated_at`). Documents already created from the
  answers never change when an answer changes (Decision 11).
- A closed (past) Session 0 session is read-only (409); a Section tool has no
  closed state.

## Decisions (confirmed by the product owner, 2026-11-12)

1. **Where: inline.** In the Master's answers list, each Player's row
   (accordion panel) shows that Player's answers as **editable fields** in
   place of the read-only text, laid out like the Player's form (same limits:
   Name and Subtitle one line, others up to 2000 characters). Q4.
2. **Autosave**, like the Player's form: changes are sent once typing pauses,
   when a field is left and when the panel goes away (Q4).
3. **What the Master can change.** The text of any answer of that Player,
   including **writing an answer the Player left empty** (Q3) and **clearing
   an answer** (an empty field deletes it, as for the Player). The
   **Private** tick of a Note answer stays the Player's choice: the Master
   sees it but cannot change it (Q2).
4. **Who.** Any Master of the Room, for any Player who is a member of the
   Room. A Player still edits only their own answers. Masters still don't
   answer for themselves.
5. **No marker, no migration** (Q1): an edited answer looks like any other.
6. **Live.** The Player sees the new text at once (SSE `answer` event, to the
   Player and the Masters, or to everyone if revealed, as today). In the
   Player's open form, a field they are **not typing in** takes the Master's
   text; a field they are typing in keeps what they typed and the next save
   wins (last write wins, per answer). The same holds for two Masters.
7. **Documents already created don't change** (as for a Player's edit,
   spec 47 Decision 11). If the Player has no Document yet, "Crea il mio
   Documento" / "Crea i Documenti di tutti" use the edited answers.
8. **Past sessions too** (Q5): the Master can edit the answers of a **closed**
   Session 0 session as well. Players' own form in a closed session stays
   read-only (409), and a closed session still makes no Documents.
9. **No audit log entry.** Answers aren't in the Room's audit log today.

## Design

- **No migration.**
- **Backend**
  - Domain (`domain/session_zero_questions.py`): `ensure_can_edit_answers(role)`
    (Master only).
  - Route: `PUT /rooms/{room_id}/session-zero/modules/{m}/answers/{user_id}`,
    Master only (403), any visible Questions module including a closed
    session's (Decision 8), `user_id` must be a Player of the Room (404), body
    as the Player's route (`answers: [{question_id, body}]`, `note_private`
    ignored: the stored one is kept, false for a new answer), same cleaning
    and 422s, then `_answers_changed` for that Player.
- **Frontend**
  - `boardWrites.saveAnswersFor(moduleId, userId, answers)`.
  - `QuestionsModule.tsx`: the Master's `AnswersByPlayer` rows render an
    editable `AnswerFields` (the fields of `AnswerForm`, shared) for the
    Master whenever the board is writable (open or closed session); the
    Player's revealed list of others stays read-only. Unfocused fields follow
    the saved answers (Decision 6), in both forms.
  - Strings: a short hint under the Master's fields
    (`sessionZero.questions.masterEdits`), all locales.
- **Tests**
  - Backend: Master edits / fills / clears a Player's answer; `note_private`
    kept; 403 for a Player, 404 for a non-member or a Master as target, 422
    for bad answers, works on a closed session's and on a Section tool's
    module; Documents already made untouched; stream reaches the Player and
    the Masters only.
  - Frontend: fields editable only for the Master; autosave sends the Master
    route; Private tick disabled for the Master; Player's unfocused field
    updates.

Estimate: backend ~45 min, frontend ~1.5 h, on the same PR into `staging`.

## Definition of Done

- The Master edits any Player's answers in the Session 0 Questions step (open
  or closed session) and in a Section's Questions tool; the Player sees the
  change live.
- No migration.
- Context docs (architecture, ui-context) and the progress tracker updated;
  backend and frontend suites green.

## Addition: the Name question becomes optional (proposed, to confirm)

Product owner, 2026-11-12: today a list of questions must have exactly one
Name question (`clean_questions`, 422 `oneNameQuestion`; the editor's
`questionsProblem`), because the step assumes the answers make a Player's
character Document. Not every round of questions is about creating the PC.

10. **Zero or one Name question.** A list may have no Name question; at most
    one stays the rule. Existing steps don't change.
11. **No Name question, no Player's Document.** Subtitle, Description and Note
    fill the Document the Name question names, so without one they can't be
    picked: the editor offers only "Nuovo Documento" and "Resta qui"
    (`none`), and the backend answers 422 for the others. The Tag of the
    Players' Documents select is hidden then (the creation switch stays, for
    "Nuovo Documento").
12. **"Nuovo Documento" questions still work without a Name** (Q6): the
    Player's button reads "Crea i miei Documenti" and the Master's "Crea i
    Documenti di tutti" counts the Players with an unmade "Nuovo Documento"
    answer; each makes only those Documents (409 when there is nothing to
    make). With a Name question nothing changes.
13. **A list with only "Resta qui" questions** makes no Documents at all: no
    create buttons and no "Rispondi alla domanda sul nome" hint; the
    answers stay in the step (to read at the table, reveal, and now edit).
14. **The editor's first question** of an empty list stays Name (the common
    PC case); the Master can switch it to another target (Q7).

Design: `clean_questions` drops the "exactly one" check for "at most one"
and refuses `subtitle`/`description`/`note` without a Name;
`draft_documents` makes no main Document without a Name question;
`create_my_document`/`create_everyone` and `can_create`/`creatable` count
extras only in that case; frontend `questionsProblem`, the target select
and the labels follow. No migration.

Open questions:
6. Without a Name question, should "Nuovo Documento" questions still create
   their Documents (proposed, Decision 12), or should such a step make no
   Documents at all?
7. Should the first question of an empty list still default to Name
   (proposed), or to "Resta qui"?

## Answers (product owner, 2026-11-12)

1. No "edited by the Master" marker, no migration.
2. The Master can't change the Private tick: ok.
3. The Master can also write empty answers: ok.
4. Inline editing (autosave) instead of a dialog.
5. The Master can also edit the answers of closed sessions.

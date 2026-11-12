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

## Decisions (proposed defaults, to confirm)

1. **Where.** In the Master's answers list, each Player's row gets an
   **"Modifica risposte"** button (open session or Section tool only). It
   opens a dialog with that Player's answers, one field per question, laid out
   like the Player's form (same limits: Name and Subtitle one line, others up
   to 2000 characters).
2. **Save, not autosave.** The dialog has **Salva** / **Annulla** (it doesn't
   close on an outside click and asks before dropping unsaved changes, like
   the Edit questions dialog). Unlike the Player's form, nothing is sent while
   the Master types, so the Player never sees half-written edits.
3. **What the Master can change.** The text of any answer of that Player,
   including **writing an answer the Player left empty** and **clearing an
   answer** (an empty field deletes it, as for the Player). The **Private**
   tick of a Note answer stays the Player's choice: the Master sees it but
   cannot change it.
4. **Who.** Any Master of the Room, for any Player who is a member of the
   Room. A Player still edits only their own answers. Masters still don't
   answer for themselves.
5. **Marker "Modificata dal Master".** An answer the Master changed shows a
   small dimmed label "Modificata dal Master" under it, wherever it is shown
   (the Player's own form, the Master's list, everyone's list after reveal).
   The label goes away when the Player edits that answer again (it is their
   text again). One new column, so **one migration**.
6. **Live.** The Player sees the new text at once (SSE `answer` event, to the
   Player and the Masters, or to everyone if revealed, as today). In the
   Player's open form, a field they are **not typing in** takes the Master's
   text; a field they are typing in keeps what they typed and the Player's
   next save wins (last write wins, per answer).
7. **Documents already created don't change** (as for a Player's edit,
   spec 47 Decision 11). If the Player has no Document yet, "Crea il mio
   Documento" / "Crea i Documenti di tutti" use the edited answers.
8. **Past sessions stay read-only.** A closed Session 0 session can't be
   edited by anyone (409, unchanged).
9. **No audit log entry.** Answers aren't in the Room's audit log today; the
   marker of Decision 5 is the trace.

## Design

- **Migration** (revises the current head): `session_zero_answers.edited_by_master
  BOOLEAN NOT NULL DEFAULT false`. Andrea applies it to the staging DB before
  the PR merges and to prod before the release.
- **Backend**
  - Domain (`domain/session_zero_questions.py`): `ensure_can_edit_answers(role)`
    (Master only); `Answer.edited_by_master`.
  - Repo: `save_answer(..., edited_by_master: bool)`; a Player's save sets it
    to false, a Master's to true. A Master's save keeps the stored
    `note_private` (Decision 3).
  - Route: `PUT /rooms/{room_id}/session-zero/modules/{m}/answers/{user_id}`,
    Master only (403), `user_id` must be a Player of the Room (404), body as
    the Player's route (`answers: [{question_id, body}]`, `note_private`
    ignored), same cleaning and 422s, then `_answers_changed` for that Player.
  - Response: answers carry `edited_by_master`.
- **Frontend**
  - `lib/sessionZero` types and `boardWrites.saveAnswersFor(moduleId,
    userId, answers)`.
  - `QuestionsModule.tsx`: "Modifica risposte" in each `AnswersByPlayer` row
    (Master, editable only) → `EditAnswersDialog` (reuses the answer fields
    of `AnswerForm`); `ReadAnswer` and `AnswerForm` show the marker;
    `AnswerForm` drops its local copy of a field that isn't focused when the
    saved answer changes (Decision 6).
  - en/it (and the other locales) strings: `sessionZero.questions.editAnswers`,
    `editAnswersTitle` ("Risposte di {{name}}"), `editedByMaster`.
- **Tests**
  - Backend: Master edits / fills / clears a Player's answer; marker set by
    the Master and cleared by the Player's save; `note_private` kept; 403 for
    a Player, 404 for a non-member or a Master as target, 409 on a closed
    session, works on a Section tool module; Documents already made untouched.
  - Frontend: button only for the Master on an open step; dialog saves and
    cancels with confirm; marker shown; Player's unfocused field updates.

Estimate: backend + migration ~1 h, frontend ~1.5 h, one PR into `staging`.

## Definition of Done

- The Master edits any Player's answers in the Session 0 Questions step and in
  a Section's Questions tool; the Player sees the change and the marker live.
- Migration listed for Andrea (staging before merge, prod before release).
- Context docs (architecture, ui-context) and the progress tracker updated;
  backend and frontend suites green.

## Open Questions

1. **Marker** (Decision 5): show "Modificata dal Master" (proposed, needs a
   migration), or no marker at all (no migration)? If shown: to everyone who
   can read the answer (proposed), or only to the Master and the author?
2. **Private tick** (Decision 3): the Master can't change a Note answer's
   Private tick (proposed). Should they?
3. **Empty answers** (Decision 3): the Master can also write answers the Player
   left empty (proposed), or only change existing ones?
4. **Save mode** (Decision 2): a dialog with Save (proposed), or edit inline in
   the accordion with autosave like the Player's form?
5. **Past sessions** (Decision 8): read-only as today (proposed), or let the
   Master fix answers of a closed session too?

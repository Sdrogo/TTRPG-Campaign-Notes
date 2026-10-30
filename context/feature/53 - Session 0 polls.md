# 53 - Session 0 polls

## Goals

- Product owner's request (2026-10-30): "Vorrei inserire la possibilità di
  creare dei sondaggi dentro una Room. Un sondaggio permette più
  possibilità scelte (minimo 2 fino ad n). Il master crea un sondaggio e
  decide se i player possono votare più di una scelta a testa. Dovrebbe
  essere parte della suite per le sessioni 0."
- A new step kind for the Session 0 chain (spec 47): **Poll**
  ("Sondaggio"). The Master writes one or more polls, each with a
  question and 2 to 20 choices, and decides per poll whether a Player may
  vote for one choice or several. Players vote; the table sees the tally
  live.
- Same request, a small change outside the poll Decisions: a new
  session's default name drops "0.5" and "#": "Sessione 0", then
  "Sessione 1", "Sessione 2"... (was "Sessione 0.5 #1", spec 46d Decision
  3). The product owner asked for it directly, so it is **built in this
  PR and does not wait for Q1-Q5**. Frontend strings only; a session the
  Master named keeps its name. "Session 0.5" stays the name of the
  concept (a later round) in the code and the glossary.
- `requirements.md` has no requirement for Session 0; this ticket adds none
  until the product owner asks.

## Decisions

Proposed by Claude on 2026-10-30; the product owner answered Q1-Q5 the
same day (see "Answers" below) and the Decisions follow those answers.

1. **Poll step.** `kind` `poll` joins Retro, Lines & Veils, Stars and
   Wishes, Questions and DDI in "New session" and "Edit steps", counts
   toward the 10-step limit, and follows spec 47 Decision 5 (Players see
   it once the table has reached it). One step holds **up to 10 polls**,
   shown one under the other (Q1).
2. **A poll** has a question (up to 200 characters), an optional hint (up
   to 300) and **2 to 20 choices** (each up to 200 characters, no two the
   same, ignoring case and spaces). The Master sets, when creating it:
   - **Votes per person** ("Voti a testa"), from 1 to the number of
     choices, default 1 (Q2). A voter gives at most that many choices one
     vote each; above 1 the voter sees a badge with the votes left.
   - **The Master votes** ("Vota anche il Master"), off by default (Q3).
   - **Who sees who voted what** ("Voti nominativi"): `master` (default:
     the Master sees the names, Players only counts), `everyone`, or
     `nobody` (anonymous for everyone, the Master included) (Q4).
   - **Results**: `live` (default: the tally is shown while voting) or
     `hidden` ("Voto segreto": Players don't see the tally until the
     Master presses "Rivela i risultati"; the Master always sees it) (Q5).
3. **Setup** (Master only, open session only): an "Edit polls" dialog
   like "Edit questions" (spec 47_2): add, remove and reorder polls and
   their choices, sent as the whole list in order. An `id` keeps a poll or
   a choice with its votes; a choice left out goes with its votes; editing
   a choice's text keeps its votes. The four settings of Decision 2 can
   change only while the poll has no votes (409 otherwise), so nobody's
   vote becomes less secret than when it was cast.
4. **Voting** (the Players, and the Master when the poll says so): a radio
   list when votes per person is 1, checkboxes otherwise (no more ticks
   than votes left); the vote is saved on each change and can be changed
   or withdrawn until the poll is closed. A vote replaces the voter's
   previous one for that poll as a whole.
5. **Results and progress.** Each poll always shows **"N su M hanno
   votato"** (M = the Players, plus the Master when the Master votes) and,
   once N = M, **"Hanno votato tutti"** (a highlighted chip, and a toast
   for the Master when it happens live). The tally (count and bar per
   choice) shows live to every member who has reached the step, except a
   `hidden` poll not yet revealed, whose tally only the Master sees; the
   Master can hide it again. Names per choice follow Decision 2 (shown on
   hover or tap of a count). The voter always sees their own choices
   ticked. With names visible to the Master, the Master also sees who has
   not voted yet.
6. **Closing.** The Master has "Chiudi sondaggio" per poll (and "Riapri"):
   a closed poll takes no votes and, once its tally is visible, highlights
   the winning choice(s). Closing doesn't reveal a `hidden` poll. A closed
   session (spec 46) is read-only, its polls included.
7. **Carry over** (spec 47b): Poll joins the carryable kinds. A Poll step
   with "Porta dalla sessione precedente" copies the polls (questions,
   hints, choices, settings) of the earlier session's Poll step chosen by
   `carry_source`, not their votes, closed or revealed state.
8. **Live.** Writes go through the Room stream (specs 46_2 and 52): setup
   changes, closing and revealing push `module` to everyone; a vote pushes
   the new event kind `vote` to everyone, since the voter count is public,
   and bumps `revision`. Events carry no content.
9. **Data** (one migration, revising the current head): backend-only
   tables with RLS + deny policy, cascading with the step and so with the
   session and the Room:
   - `session_zero_polls` (`module_id`, `position`, `body`, `hint`,
     `max_choices` default 1, `master_votes` default false,
     `voters_visible` `master`/`everyone`/`nobody` default `master`,
     `results` `live`/`hidden` default `live`, `revealed` default false,
     `closed_at`);
   - `session_zero_poll_options` (`poll_id`, `position`, `body`);
   - `session_zero_poll_votes` (`poll_id`, `option_id`, `user_id`,
     `created_at`, unique per option and user; cascading with the option
     and the user).
   Rules pure in `app/domain/session_zero_polls.py`, routes in
   `app/api/session_zero_polls.py`.
10. **API** (under `/rooms/{id}/session-zero`):
    - `PUT .../modules/{id}/polls` (Master): the whole list in order,
      `[{id?, body, hint?, max_choices, master_votes, voters_visible,
      results, options: [{id?, body}]}]`;
    - `PUT .../polls/{poll_id}/vote` (a voter): `{option_ids}`, empty
      withdraws; 422 for more than `max_choices`, a repeated choice or a
      choice of another poll; 403 for the Master when the Master doesn't
      vote; 409 on a closed poll or session;
    - `PUT .../polls/{poll_id}/closed` (Master): `{closed}`;
    - `PUT .../polls/{poll_id}/reveal` (Master): `{revealed}`.
    `GET` answers each Poll step's `polls`: settings, choices, `voter_count`,
    `electorate` (M), `my_option_ids`, each choice's `count` (null while
    the tally is hidden from the viewer) and `voters` (names, only when the
    viewer may see them), and `not_voted` for whoever sees names.
11. **Personal data.** A member's votes are in their data export (spec 31)
    and erased with the account. Like spec 46, polls are not in Room
    duplication, JSON/PDF export or search.
12. **Translations** in the 12 UI languages; glossary row "Poll".

## Answers (product owner, 2026-10-30)

- **Q1 - Polls per step**: several, as proposed ("Ok, va bene").
- **Q2 - Votes per person**: set by the Master, 1 to n; Players see a
  badge with the votes they have left.
- **Q3 - Does the Master vote**: set when creating the poll.
- **Q4 - Anonymity**: set when creating the poll.
- **Q5 - Results while voting**: set when creating the poll. A count of
  the votes cast, a signal when everyone has voted and, for a secret
  vote, a button to reveal the votes.

## Units

- **53_1 backend** (built 2026-10-30, migration `b9e4c2a7d1f3`): migration,
  domain rules, routes, `GET` shape, carry over, SSE `vote`, export and
  account deletion, translations of server strings.
- **53_2 frontend** (built 2026-10-30): `components/sessionZero/PollModule.tsx`
  (`PollBoard`), "Edit polls" dialog, the step in "New session" / "Edit
  steps" with its carry checkbox, live re-read on `vote` (every event
  re-reads the boards), translations.

## Tests

- Backend: 2 to 20 choices and up to 10 polls (422 outside); duplicate
  choices 422; `max_choices` 1 to the choices; Master-only setup, close and
  reveal; the Master votes only when the poll says so (403); more than
  `max_choices` 422; a vote replaces the previous
  one; withdrawing; closed poll and closed session 409; a removed choice
  takes its votes; settings locked once votes exist; a hidden tally
  only for the Master until revealed; names per `voters_visible`; voter
  count and electorate; a hidden step's poll 404 to a
  Player; carry copies polls without votes; export and erasure.
- Frontend: radio vs checkboxes from votes per person, the votes-left
  badge; vote saved on change and
  shown at once; counts and bars; Master sees voters, Player doesn't;
  closed poll read-only with the winner highlighted; "Edit polls"
  validation (at least 2 choices, at most 20); default session names
  "Sessione 0", "Sessione 1".

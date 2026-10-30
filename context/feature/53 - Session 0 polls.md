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
- Same request, done in the same PR without a ticket: a new session's
  default name drops "0.5" and "#": "Sessione 0", then "Sessione 1",
  "Sessione 2"... (was "Sessione 0.5 #1"). Frontend strings only; a
  session the Master named keeps its name.
- `requirements.md` has no requirement for Session 0; this ticket adds none
  until the product owner asks.

## Decisions

Proposed by Claude on 2026-10-30, to be confirmed by the product owner
(open points in "Questions" below; the Decisions follow the proposed
defaults).

1. **Poll step.** `kind` `poll` joins Retro, Lines & Veils, Stars and
   Wishes, Questions and DDI in "New session" and "Edit steps", counts
   toward the 10-step limit, and follows spec 47 Decision 5 (Players see
   it once the table has reached it). One step holds **up to 10 polls**,
   shown one under the other, so a few votes ("Sistema", "Giorno",
   "Ambientazione") don't fill the stepper (Q1).
2. **A poll** has a question (up to 200 characters), an optional hint (up
   to 300), **2 to 20 choices** (each up to 200 characters, no two the
   same, ignoring case and spaces) and a switch **"Più scelte a testa"**,
   off by default: off, a Player votes for one choice; on, for any number
   of them, at least one (Q2).
3. **Setup** (Master only, open session only): an "Edit polls" dialog
   like "Edit questions" (spec 47_2): add, remove and reorder polls and
   their choices, sent as the whole list in order. An `id` keeps a poll or
   a choice with its votes; a choice left out goes with its votes; editing
   a choice's text keeps its votes. The multiple-choice switch can change
   only while the poll has no votes (409 otherwise), so a single-choice
   poll never holds a Player with two votes.
4. **Voting** (Players only; the Master doesn't vote, like Questions and
   DDI, Q3): a radio list, or checkboxes when "Più scelte a testa" is on;
   the vote is saved on each change and the Player can change or withdraw
   it until the poll is closed. A Player's vote replaces their previous one
   for that poll as a whole.
5. **Results.** Each choice shows its count and a bar, live, to every
   member who has reached the step; the Player sees their own choices
   ticked. Votes are **named for the Master** (hovering or tapping a count
   lists the Players) and **anonymous for Players**, who see only counts
   (Q4). Results are shown while voting is open (Q5). Under each poll, "N
   Player su M hanno votato".
6. **Closing.** The Master has "Chiudi sondaggio" per poll (and "Riapri"):
   a closed poll takes no votes and shows its final tally with the winning
   choice(s) highlighted. A closed session (spec 46) is read-only, its
   polls included.
7. **Carry over** (spec 47b): Poll joins the carryable kinds. A Poll step
   with "Porta dalla sessione precedente" copies the polls (questions,
   hints, choices, switch) of the earlier session's Poll step chosen by
   `carry_source`, not their votes or their closed state.
8. **Live.** Writes go through the Room stream (specs 46_2 and 52): setup
   changes and closing push `module` to everyone; a vote pushes the new
   event kind `vote` to everyone who may read the step (counts are
   public), and bumps `revision`. Events carry no content.
9. **Data** (one migration, revising the current head): backend-only
   tables with RLS + deny policy, cascading with the step and so with the
   session and the Room:
   - `session_zero_polls` (`module_id`, `position`, `body`, `hint`,
     `allow_multiple` default false, `closed_at`);
   - `session_zero_poll_options` (`poll_id`, `position`, `body`);
   - `session_zero_poll_votes` (`option_id`, `user_id`, `created_at`,
     unique per option and user; cascading with the option and the user).
   Rules pure in `app/domain/session_zero_polls.py`, routes in
   `app/api/session_zero_polls.py`.
10. **API** (under `/rooms/{id}/session-zero`):
    - `PUT .../modules/{id}/polls` (Master): the whole list in order,
      `[{id?, body, hint?, allow_multiple, options: [{id?, body}]}]`;
    - `PUT .../polls/{poll_id}/vote` (Player): `{option_ids}`, empty
      withdraws; 422 for more than one on a single-choice poll or a choice
      of another poll, 409 on a closed poll or session;
    - `PUT .../polls/{poll_id}/closed` (Master): `{closed}`.
    `GET` answers each Poll step's `polls`, each with its choices and
    counts, `my_option_ids`, `voters` (Players who voted) and `members`
    (Players who could), and, for the Master only, each choice's voters.
11. **Personal data.** A Player's votes are in their data export (spec 31)
    and erased with the account. Like spec 46, polls are not in Room
    duplication, JSON/PDF export or search.
12. **Translations** in the 12 UI languages; glossary row "Poll".

## Questions for the product owner

- **Q1**: several polls in one step (proposed), or one poll per step?
- **Q2**: with "Più scelte a testa" on, any number of choices (proposed),
  or a maximum the Master sets (e.g. "fino a 2")?
- **Q3**: the Master doesn't vote (proposed, like Questions and DDI), or
  votes like a Player?
- **Q4**: votes named for the Master and anonymous for Players
  (proposed), named for everyone, or anonymous for everyone?
- **Q5**: results visible live while voting (proposed), or hidden from
  Players until the Master closes the poll?

## Units

- **53_1 backend**: migration, domain rules, routes, `GET` shape, carry
  over, SSE `vote`, export and account deletion, translations of server
  strings.
- **53_2 frontend**: `components/sessionZero/PollModule.tsx` (`PollBoard`),
  "Edit polls" dialog, the step in "New session" / "Edit steps" with its
  carry checkbox, live re-read on `vote`, translations.

## Tests

- Backend: 2 to 20 choices and up to 10 polls (422 outside); duplicate
  choices 422; Master-only setup and close, Player-only vote (403);
  single-choice poll rejects two choices; a vote replaces the previous
  one; withdrawing; closed poll and closed session 409; a removed choice
  takes its votes; switch locked once votes exist; counts for everyone,
  voters per choice only for the Master; a hidden step's poll 404 to a
  Player; carry copies polls without votes; export and erasure.
- Frontend: radio vs checkboxes from the switch; vote saved on change and
  shown at once; counts and bars; Master sees voters, Player doesn't;
  closed poll read-only with the winner highlighted; "Edit polls"
  validation (at least 2 choices, at most 20); default session names
  "Sessione 0", "Sessione 1".

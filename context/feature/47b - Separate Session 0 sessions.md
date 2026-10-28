# 47b - Separate Session 0 sessions

## Goals

- Product owner's request (2026-10-28): "ogni sessione dovrebbe essere un
  istanza separata. Noi al momento ci portiamo tutte le domande delle
  vecchie sessioni. io metterei l'opzione di portare dietro le info vecchie
  su ogni singola feature quando vengono inserite nella sessione."
- Today (spec 47) a new session copies the previous session's Nth Retro
  step's columns, Nth Questions step's questions and settings and Nth DDI
  step's Document. From now on a new session starts empty, and each step
  carries the earlier content over only when the Master asks for it.
- Proposed in the thread on 2026-10-28; the product owner confirmed it the
  same day ("per il resto ok").

## Decisions

1. **A new session starts empty.** Retro steps get the preset columns,
   Questions steps no questions and the Room's `PC` Tag, DDI steps no
   Document. Lines & Veils stays the Room's one board, as before.
2. **"Carry over from the previous session", per step.** When the Master
   composes a new session's chain, each Retro, Questions and DDI step has
   this checkbox, off by default. "Edit steps" has it beside "Add step" for
   those kinds, when the Room has an earlier session. Stars and Wishes and
   Lines & Veils have nothing to carry.
3. **What is carried** is what spec 47 copied: a Retro step's column titles
   and colours (no post-its, no groups), a Questions step's questions, Tag
   and creation switch (no answers), a DDI step's Document (no
   acceptances).
4. **From where:** the most recent earlier session that has a step of that
   kind; the step there in the same position among its kind (the 2nd
   Questions step from the 2nd one), or its last of that kind when it has
   fewer. Nothing to carry leaves the step empty.
5. **API:** `POST .../rounds` `modules` takes steps as `{kind, carry}`
   (a bare kind still works and carries nothing); without `modules`, the
   previous chain with nothing carried. `POST .../modules` takes
   `{kind, carry}`. No migration.

## Tests

- Backend: a new session's steps start empty; `carry` copies Retro
  columns, questions and settings, the DDI Document, from the most recent
  session with that kind; a step added with `carry` copies from an earlier
  session, not the open one; nothing to carry leaves it empty.
- Frontend: the checkbox per carryable step in "New session", sent as
  `{kind, carry}`; the checkbox beside "Add step" only for carryable kinds
  and once there is an earlier session.

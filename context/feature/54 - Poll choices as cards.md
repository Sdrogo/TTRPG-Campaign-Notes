# 54 - Poll choices as cards

## Goals

- Product owner's request (2026-10-30): "Vorrei fare un refactor della UI
  della pagina dei sondaggi, vorrei che le opzioni venissero visualizzate
  incolonnate come card, voglio che le risposte possano portarsi dietro una
  descrizione. [...] Le due card vengono mostrate in colonna, uno dei bordi
  della card incorpora la barra della percentuale dei voti, alla
  rivelazione dei voti, la card ruota su se stessa e si mostra solo con il
  titolo, senza descrizione, ci sarà una percentuale colorata del colore
  accent che serve a rappresentare la percentuale di voti ottenuti. Quella
  vincitrice ha un bagliore esterno ed una maggiore grandezza per
  testimoniare che è la vincitrice."
- Example given: "Quale spunto di campagna preferite?", choice "Stanza 404"
  with the description "Scenario d'apertura. All'#Hotel Kaguya, nella
  stanza 404, ..." and choice "Il concerto al Budōkan" with "#SHITE canta
  al Nippon Budōkan, ... del #Palazzo Imperiale ...".
- Restyles the Poll step of spec 53 and adds one field. Everything else of
  spec 53 stays: votes per person and the votes-left badge, whether the
  Master votes, who sees the names, live or secret tally, reveal, close and
  reopen, "N su M hanno votato", "Hanno votato tutti", carry over, live
  updates.
- `requirements.md` has no requirement for Session 0; this ticket adds none.

## Decisions

Proposed by Claude on 2026-10-30; the product owner answered Q1-Q4 the
same day (see "Answers" below) and the Decisions follow those answers.

1. **A choice has a title and an optional description.** The title is the
   current choice text (up to 200 characters, still unique within the
   poll). The description is new: up to 2000 characters, Markdown and
   mentions like a Note (spec 48, `MarkdownText`), written in the "Edit
   polls" dialog with the mention textarea (typing `#` suggests Documents,
   `@` members), so `#Hotel Kaguya` links the Document. Editing a
   description keeps the choice's votes; it is not one of the locked
   settings of spec 53 Decision 3.
2. **Choices are cards in one column**, one under the other, at most about
   44rem wide (a full 3440 px wide card would be a stripe), on every
   screen. Each card shows the title (bold) and, under it, the description.
   The poll's question, hint and badges stay above the column; progress and
   the Master's buttons stay under it. Several polls in one step stay one
   under the other, as now.
3. **Voting on the card.** The whole card is the control: a click or tap,
   or Space/Enter with the keyboard, ticks it (a radio card when votes per
   person is 1, a checkbox card otherwise; Mantine `Radio.Card` /
   `Checkbox.Card`, so screen readers still hear a radio or checkbox). A
   ticked card has the accent border and a check in its corner. A link
   inside the description opens the Document and doesn't tick the card.
   "Ritira il voto" stays under the column. A card the voter can't tick
   any more (no votes left) is dimmed, as the checkbox was.
4. **The vote bar is the card's left edge** (Q1): a 4 px strip along the
   left border, filled from the bottom up to the choice's share, with the
   count at the right of the title ("3 voti", names on hover or tap as
   now). It shows whenever the viewer sees the tally (live polls for
   everyone, secret ones for the Master, spec 53 Decision 5); otherwise
   the edge is a plain border.
5. **The share** (Q2) is the choice's votes over all the votes cast in the
   poll, so the cards add up to 100 % even when each person has more than
   one vote. Rounded to whole numbers. With no votes yet every share is 0 %.
6. **The reveal flips the cards** (Q3). A poll enters its **results view**
   when its tally becomes visible as final: a secret poll when the Master
   presses "Rivela i risultati", any poll when the Master closes it (a
   secret poll closed but not revealed stays face down for the Players).
   Then every card turns over on its vertical axis (about 0.6 s, the cards
   one after the other, 80 ms apart) and its back shows only the title and
   the share in large type in the accent colour, with the count under it
   and the left edge filled to the share. No description on the back.
   "Nascondi" (secret polls) and "Riapri" turn them back.
7. **The winner** is the choice, or every choice tied, with the most votes
   once the poll is in its results view (spec 53 Decision 6, now also for
   a revealed poll still open). Its card has an outer glow in the accent
   colour and is a little larger (scale 1.04, without pushing the others
   sideways); the trophy icon stays for screen readers and colour-blind
   viewers. No votes, no winner.
8. **Voting after a reveal.** A secret poll revealed while still open
   keeps taking votes (spec 53 is unchanged): its cards show the back, and
   a "Mostra le opzioni" button turns them face up for the viewer only, to
   read the descriptions and change a vote; the shares on the back update
   live.
9. **Reduced motion.** With `prefers-reduced-motion: reduce`, there is no
   rotation, no stagger and no scaling: the front is replaced by the back
   at once (a short fade at most) and the winner is marked by the glow and
   the trophy only.
10. **Live.** A vote, a reveal or a close from someone else re-reads the
    board as now (spec 52); a viewer who has the poll open sees the flip
    happen when the event lands. A page opened on a poll already in its
    results view shows the backs straight away, without the animation.
11. **Data** (one migration, revising the current head `b9e4c2a7d1f3`):
    `session_zero_poll_options.description` text, nullable. Nothing else
    changes in the schema.
12. **API.** `PUT .../modules/{id}/polls` takes `description` per choice
    (optional; trimmed, empty is none, 422 over 2000 characters); `GET`
    answers it per choice, and `winner` is set once the poll is closed or,
    being secret, revealed, for whoever sees the tally (was: closed only).
    Carry over (spec 47b) copies the descriptions with the choices. The
    member data export (spec 31) is unchanged: it lists the member's own
    votes, by title.
13. **Translations** in the 12 UI languages for the new strings
    ("Descrizione", "Mostra le opzioni", "Mostra i risultati", the share
    label for screen readers).

## Answers (product owner, 2026-10-30)

- **Q1 - Which edge holds the bar?** The left edge ("Bordo sinistro è
  meglio"), filled bottom to top. Claude had proposed the bottom edge.
- **Q2 - What is the percentage?** The share of all the votes cast, as
  proposed (the cards add up to 100 %).
- **Q3 - When do live polls flip?** On close, as proposed; a secret one on
  "Rivela i risultati" or on close.
- **Q4 - Is the flip for everyone?** Yes, the Master included, as
  proposed; the Master still sees bars on the front of a secret poll
  before revealing it.

## Units

- **54_1 backend**: migration, `description` in the domain, the routes,
  the `GET` shape, carry over and `winner` on reveal; tests.
- **54_2 frontend**: the card column, the edge bar, the flip and the
  winner, the description in "Edit polls" with mentions, reduced motion,
  translations; tests.

## Tests

- Backend: a description is saved, trimmed, cleared when empty, 422 over
  2000 characters; editing it keeps the votes and is allowed when the
  settings are locked; carry over copies it; `winner` on a revealed open
  secret poll, on a closed one, ties all win, none without votes and none
  for a Player on a hidden tally.
- Frontend: cards are radios or checkboxes by votes per person and tick on
  click; the description renders Markdown and a mention link that doesn't
  tick the card; the edge bar width and the share (sum 100 %, 0 % with no
  votes); a revealed or closed poll shows the backs with title and share
  and no description; the winner card(s) marked; "Mostra le opzioni" on a
  revealed open poll; reduced motion skips the animation class; the
  description field in "Edit polls".

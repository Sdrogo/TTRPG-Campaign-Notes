# 61 - Clocks: background

What "clocks" are in tabletop role-playing games, where they come from, the
variants tables use and how Masters and Players use them. It is the
groundwork for ticket `61 - Clocks.md`: the ticket says what Ex Libris
builds, this file says what the tool has to be faithful to.

Written by Claude on 2026-11-03 at the product owner's request ("documentazione
sul concetto stesso di Clock nei GDR"). Rules are described in our own words;
no game text is quoted. Game names are given to place ideas, never to be shown
in the app.

## 1. The idea in one paragraph

A **clock** is a circle cut into equal **segments** (usually 4, 6 or 8), drawn
next to something in the fiction that takes time or effort: an obstacle, a
threat, a plan, a rival's scheme. When something in play moves it forward, the
Master **ticks** (fills) one or more segments. When the last segment is
filled, the thing happens: the vault is open, the guards raise the alarm, the
cult finishes the ritual. The clock turns "how close are we?" into a shared,
visible quantity that everyone at the table reads at a glance, without exact
time or hit points. It is a pacing tool more than a rule.

## 2. Origins

- **Apocalypse World** (D. Vincent Baker, 2010) introduced **countdown
  clocks** for the Master's *threats*: a clock face with six slices read as
  hours (3:00, 6:00, 9:00, then 10:00, 11:00 and 12:00), each slice written up
  in advance as a stage of escalation, with midnight as the moment the threat
  comes to its full, bad conclusion. The later slices are shorter: things
  accelerate near the end. Many "Powered by the Apocalypse" games keep the
  idea (countdowns in Monster of the Week, for instance).
- **Dungeon World** (Sage LaTorra and Adam Koebel, 2012) turned the same idea
  into **Fronts** with **grim portents**: an ordered list of escalating events
  ending in an *impending doom*, ticked off as the fiction moves. Not drawn as
  a circle, but the same "steps toward doom" shape.
- **Blades in the Dark** (John Harper, One Seven Design; playtested from 2015,
  published 2017) generalised it into **progress clocks** for almost
  anything: obstacles, dangers, long projects, factions' plans. Its system
  reference was released under a Creative Commons licence as **Forged in the
  Dark**, and the clock spread with it (Scum and Villainy, Band of Blades,
  Wicked Ones and many others).
- Since then clocks have travelled well beyond those families: games with
  their own clocks in the core rules (Fabula Ultima, Lancer's narrative play),
  and countless tables that bolt clocks onto other systems (D&D, Pathfinder,
  Call of Cthulhu) to track chases, rituals, heists, travel and downtime.
- **Related, but different: progress tracks.** Ironsworn and Starforged
  (Shawn Tomkin) track vows and journeys on ten boxes of four ticks each,
  where the difficulty sets how many ticks one success marks. They solve a
  neighbouring problem (how far along is the *Player's* goal) and are not in
  scope for ticket 61; see §8.

## 3. Anatomy of a clock

| Part | What it is | Notes for the tool |
| --- | --- | --- |
| Name | What the clock measures, short and concrete: "Breaking into the vault", "The Red Sashes find you". | Shown on the face. |
| Segments | How many ticks fill it. 4 = simple, 6 = complex, 8 = daunting is the usual rule of thumb; 10-12 for long arcs. | The tool needs presets and a free number. |
| Filled | How many segments are ticked now. | The state that changes in play. |
| Direction / tone | Is filling it good for the Players (progress) or bad (danger)? | Mostly colour; same mechanics. |
| Stage text | Optional: what each segment *means* (countdowns). | Per-segment labels. |
| Trigger | What happens when it fills. Often only the Master knows. | A Master-only note. |
| Visibility | Shown to the table or kept secret. | Key requirement (§6). |

**How much to tick.** In Forged in the Dark games a roll's *effect level*
decides it: limited effect one segment, standard two, great three, more on a
critical. Other games tick one segment per relevant event, or one per
in-world unit of time (an hour, a day). The tool must not assume a rule: it
needs "+1" fast and "+N" possible.

**Can it go back?** Most clocks only fill. Some are designed to move both
ways (see tug-of-war), and Masters sometimes "un-tick" a clock after a great
Player move ("you buy yourselves time"). The tool must allow it.

## 4. Variants used at the table

1. **Progress clock (obstacle).** A goal too big for one roll: picking a
   complex lock, convincing a council, crossing a desert. The Players fill it
   with successful actions. Visible, "good" when full.
2. **Danger clock.** A bad thing approaching: alarm, pursuit, a storm, the
   ritual. Filled by complications, failed rolls or the passing of time. Most
   often visible, so the Players feel the pressure.
3. **Countdown clock.** A danger clock whose segments are written in advance
   as stages ("the bridge is guarded", "the city closes its gates", "the
   plague reaches the palace"). The Master reads the next stage aloud when it
   ticks. Apocalypse World's six-hour face is the classic form.
4. **Racing clocks.** Two clocks running against each other: the Players'
   escape against the pursuers' net, our ritual against theirs. Whichever
   fills first decides the outcome. Shown side by side.
5. **Linked (tiered) clocks.** Filling one unlocks or starts the next: "find
   the hideout" (6) opens "break into the hideout" (8); a danger clock whose
   completion starts a worse one. Often the next clock is hidden until then.
6. **Tug-of-war clock.** One clock that both sides move: filled by one side,
   emptied by the other (a district's control, a fragile alliance, a
   character's sanity). Often has meaningful thresholds at the half.
7. **Long-term project clock.** A Player's downtime goal (craft a device,
   learn a ritual, build a reputation), usually 8 segments or more, ticked
   across sessions. Often owned and ticked by the Player.
8. **Faction clock.** The Master's off-screen world: each faction's plans as
   clocks, ticked between sessions ("faction turn"), so the world moves
   without the Players. Usually hidden, sometimes revealed as rumours.
9. **Mission / time clock.** A clock for the time available ("the ball ends
   at midnight", "before the reinforcements arrive"), ticked as scenes pass.
10. **Group / shared clock.** Several Players contribute to the same clock in
    one scene (teamwork, a group check); some games formalise this.

They are the same object with different settings: segment count, tone,
stage texts, whether it can go back, who ticks it, who sees it, and whether
it is paired with or followed by another clock. That is why ticket 61 has
one clock with options and presets, not ten kinds.

## 4b. Two rule sets side by side (shared by the product owner)

On 2026-11-03 the product owner shared two manuals' clock chapters, with the
goal: "Vogliamo creare un sistema che sia universale e personalizzabile al
massimo" (a universal system, as customisable as possible). They disagree
on purpose, which is what the tool has to absorb.

**Blades in the Dark (progress clocks).** Points beyond §3-§4:
- Make the clock *about the obstacle, not the method* ("Interior Patrols",
  not "Sneak Past the Guards"): the Players choose how to fight it.
- Complex threats are **layers**, one clock each ("Perimeter Security",
  "Interior Guards", "Office Security"), crossed in order.
- A long project can be **several clocks in phases** (development, testing,
  completion).
- **Racing clocks tie**: if both fill together, both happen (the PCs escape,
  but the officers are outside).
- **Tug-of-war** clocks are filled *and emptied* by events.
- A clock is a speedometer: it shows the situation, it doesn't decide it.
  Not every obstacle needs one.

**Cowboy Bebop GDR ("orologi").** A clock is always tied to an event;
successes (Players) and shocks (the Master, called "Big Shot") are spent to
mark segments ("segnare"); filling the last one "closes" it ("chiudere") and
the event happens. New ideas:
- **Anyone may ask to open a clock**, but the Master defines and manages
  it and decides what happens when it closes.
- Every clock has three properties set at creation and **known to the whole
  table**: *Calibro* (segments: 4 imminent, 8 complex, any number if the
  story needs it), *Approccio* (one of the game's five approaches, Rock,
  Dance, Blues, Tango, Jazz: the **last** segment must be marked by a test
  of that approach, except when marked with a shock) and *Rilevanza*
  (whether closing it ends the current *svolta* positively or negatively).
- **The turn ("svolta")**: at its start the Master opens one clock for the
  characters' goal (closing it ends the turn well) and one for the threat
  (ends it badly). When either, or both at once, closes, the turn ends.
- **Golden rules**: *no going back* (marks are never erased; to stop
  something, open and close a different clock first, "The Bomb Explodes"
  against "Bomb Defused!"); *close it or it won't happen* (when the turn
  ends, the events of clocks not closed in time don't happen); *context
  prevails* (either side may mark any clock, even the other side's).

**What the comparison asks of the tool**
- Decreasing is a **rule of the table**, not a fact about clocks: allowed in
  one game (tug-of-war), forbidden in the other.
- Clocks carry **game-defined properties** (Approach, Relevance) that the
  app cannot know in advance: they must be defined by the Room, with their
  own option lists, and shown to the whole table.
- A tick may have a **source** that matters (a success or a shock), which
  the table wants to see on the face.
- Clocks come in **groups with an end rule**: a race (first to close wins,
  ties possible), a turn (ends when a decisive clock closes; the others
  lapse), a set of layers or phases (closed in order).
- A **closing condition** ("the last segment needs a Rock test") is shown,
  not enforced: the app doesn't roll dice.
- **Players propose**, the Master defines: a proposal step.

## 5. How Masters and Players use them

**Masters**
- *Prep*: write the factions' and threats' clocks before the session, with
  their triggers. Countdowns are prepared in advance.
- *Improvised*: draw a clock on the spot when the Players attempt something
  big ("this'll take a while: six segments").
- *Pacing*: a visible danger clock is a promise ("when this fills, they
  arrive") that makes tension concrete and fair; Players can plan around it.
- *Between sessions*: tick faction clocks, archive finished ones, carry the
  rest over. Clocks are campaign state, not session state.
- *Reveal*: show a secret clock when the Players learn of the threat, or
  show its name but not its progress.

**Players**
- Read the board to choose actions ("two more segments and we're through;
  the alarm has four left").
- In some games tick their own project clocks during downtime.
- At online tables: see the change happen live, without asking "where is
  that clock now?".

**Physical habits worth keeping digitally**: clocks are drawn small and
side by side (a strip of circles under the scene), racing clocks next to
each other, and a full clock is visibly *done* (crossed, coloured) rather
than removed.

## 6. Visibility patterns

| Pattern | Seen by Players | Typical use |
| --- | --- | --- |
| Open | Name, segments, progress | Obstacles, dangers, projects (the default in Forged in the Dark play) |
| Secret | Nothing | Faction clocks, a twist the Master prepares |
| Partly known | Name and existence, not progress (or not the trigger) | "Something is coming", rumours |
| Revealed later | Nothing, then everything | A linked clock unlocked by another |
| Per-Player | Only one Player (and the Master) | A personal project, a secret only one character knows |

The trigger text ("what happens when it fills") is almost always the
Master's alone. In Ex Libris terms these map onto existing rules: the
content visibility levels (Room default, Master only, Private, Selective)
and Reveal (VR-06), with the trigger as Master-only text.

## 7. How digital tools show clocks

Virtual tabletops and companion apps converged on a few patterns, useful as
a checklist rather than a model to copy:

- A **pie face** split into wedges with a gap between them; filled wedges in
  a solid colour, empty ones outlined. Larger faces for important clocks.
- **Click a wedge** to fill up to it; click the last filled wedge to empty
  it; separate +/- buttons for touch and keyboard.
- A **strip or grid** of clocks in a sidebar or on a "scene" panel, with
  names under each face and an "N/M" counter.
- **Colours by purpose** (danger, progress, faction) chosen by the Master.
- **Live sync**: every participant sees the tick at once.
- Often missing, and asked for by tables: a **history** of what moved the
  clock, the **trigger** kept private, **links** between clocks, and clocks
  attached to the thing they describe (a faction's page).

## 8. What this means for Ex Libris

- **Universal and customisable** (product owner, 2026-11-03): the Room
  sets the rules of its game (can clocks go back, who opens and marks them,
  the properties every clock carries, the kinds of mark), and clocks live
  in **groups** with an end rule (race, turn, sequence). §4b.
- One object, **the clock**, with presets for the variants in §4, and
  presets the Room can save of its own.
- Clocks are **Room content** that outlive a session (faction clocks,
  projects), unlike a Session 0 board.
- They need the **visibility** and **Reveal** rules already used for maps
  and Documents, plus a Master-only trigger.
- They need **live updates** (spec 52 Room stream) because they move during
  play.
- They belong where the Room is read during play: a **Section block**
  (spec 55/60), a **Clocks page**, and next to the **Document** they are
  about (a faction, a project).
- Out of scope for the first version: progress tracks in the Ironsworn
  style (boxes with ticks), dice rolling and automatic ticks from rolls,
  timers in real time (Session 0 already has a timer).

## Sources and further reading

- D. Vincent Baker, *Apocalypse World* (2010; 2nd ed. 2016): threats and
  countdown clocks.
- Sage LaTorra, Adam Koebel, *Dungeon World* (2012): Fronts and grim
  portents.
- John Harper, *Blades in the Dark* (One Seven Design, 2017) and the
  *Forged in the Dark* system reference (Creative Commons): progress clocks,
  racing, linked, tug-of-war, long-term project and faction clocks.
- *Cowboy Bebop GDR* (Italian edition), chapter "Orologi": Calibro,
  Approccio, Rilevanza, the turn, the three golden rules (excerpt shared by
  the product owner, 2026-11-03).
- Shawn Tomkin, *Ironsworn* (2018) and *Starforged* (2022): progress tracks
  and clocks.
- Rooster Games, *Fabula Ultima* (2021; English 2023); Massif Press,
  *Lancer* (2019): clocks in other families.

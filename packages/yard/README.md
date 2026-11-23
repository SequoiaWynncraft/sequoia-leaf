# The Works: the yard with no screen in it

The yard behind the guild's workshop, as rules: gatherers pick things up off the forest floor, belts
carry them, machines make goods of them, and the depot in the middle takes everything in.

Everything in this package (`@sequoia-leaf/yard`) is plain data and plain functions, tested. None of
it touches the page: it is type-checked without the page's library or Bun's, and `pure.test.ts`
reads its sources for the clock, chance and storage. Leaf's play service holds the yard with it
(`WORKS`, in `game.ts`), and the Works' page (`apps/works`) runs its copy ahead of Leaf with the
same rules, through `index.ts`.

```sh
bun test                                 # the rules
bun ../../apps/works/review/balance.ts   # plays the whole story by script and prints the pacing
```

## The rules, as built

**Time.** The yard moves in ticks, ten to a second of Leaf's clock. Everything below that takes time
is counted in ticks at the plain pace; plans and a shortage of power change the pace.

**Land.** The map is 48 tiles by 36, nine plots of 16 by 12 with the yard in the middle. Each plot
is drawn in `content/plots.ts` as rows of letters, one a tile: clear ground, six kinds of deposit,
the stream, and redwoods (nothing is built on water or a redwood). Deposits never run out. A new
yard owns the middle plot, which has deadfall within the depot's power and ore and stone just
beyond it. The story puts the other plots up for sale one at a time; a plot can be bought once it
touches land the yard owns.

| Plot            | Price | What is there                                 |
| --------------- | ----: | --------------------------------------------- |
| Long Meadow     |   300 | room, and a drift of deadfall                 |
| The Clay Bank   |   500 | clay                                          |
| Stream Bend     |   900 | sand on both banks, and the stream            |
| Resin Grove     |  1000 | resin                                         |
| The Old Quarry  |  2200 | a great deal of stone, a little ore           |
| The Far Seam    |  2600 | the big ore seam and stone, across the stream |
| Windfall Hollow |  3000 | great drifts of deadfall                      |
| The Millpond    |  5000 | a long bank for waterwheels, sand and clay    |

**Things.** Twenty-three, in four steps, and every one that is made has exactly one recipe, taking
one each of its parts.

- From the ground: deadfall, stone, ore, clay, sand, resin.
- Worked once, at a mill: plank, brick, ingot, pot, glass, lamp oil.
- Put together: tool (plank, ingot), gear (ingot, brick), frame (plank, brick), hamper (plank, pot),
  glazed shell (pot, glass) at a bench; lantern (glass, ingot, lamp oil) at a workshop.
- The guild's goods: engine (tool, gear) and banner pole (frame, gear) at a bench; raid kit (tool,
  lantern, hamper) at a workshop.
- The two that take the whole yard, at a workshop: the Beacon (banner pole, lantern, engine) and the
  clockwork crab (engine, glazed shell, lantern), which has all six things from the ground in it.

**Machines.**

| Machine    | Cost | Power    | What it does                                                             |
| ---------- | ---: | -------- | ------------------------------------------------------------------------ |
| Belt       |    1 |          | carries one thing per tile; takes from behind and from both sides        |
| Gatherer   |   10 | draws 1  | stands on a deposit and gathers one thing every 15 ticks                 |
| Mill       |   20 | draws 3  | one thing in, one out (12 ticks); saws, fires or presses by what arrives |
| Bench      |   40 | draws 4  | two different things in, one out (20 or 30 ticks)                        |
| Workshop   |  120 | draws 8  | three different things in, one out (30 to 80 ticks)                      |
| Splitter   |    8 |          | in at the back; out ahead, left and right by turns; a way can be shut    |
| Joiner     |    8 |          | in at the back and both sides, turn about; out ahead                     |
| Tunnel     |   12 |          | a belt that goes under one to three tiles of anything                    |
| Crate      |   20 |          | holds 32 things of any kinds; can be shut, and then lets nothing out     |
| Pylon      |    6 |          | carries power further                                                    |
| Waterwheel |   60 | gives 10 | only on a tile beside the stream                                         |
| Boiler     |   90 | gives 30 | while it burns deadfall, a piece every 20 ticks                          |
| Depot      |      | gives 20 | three tiles square; takes anything from any side                         |

Taking a thing away gives back all it cost, so the yard can be rearranged freely; what the thing
was holding is lost. Laying a thing over another of its kind only turns it.

A new yard has a few pieces to hand (`STARTERS`: a gatherer, a mill and a dozen belts). Standing one
costs nothing and taking it away gives nothing back, but it goes back to hand and can be stood again,
so a first line can be built, and rebuilt, from an empty purse. `costOf(w, kind)` is what the next
one of a thing would cost.

**Many pieces at once** (`pieces.ts`). A `Piece` is a piece as it is asked for: its kind, its tile,
which way it faces, a tunnel's span, and what it keeps: a set recipe, a shut crate, a colour, a
splitter's shut ways (`Kept` and `keptOf` are the one list of that). `stand(w, pieces, coins)` stands
a set all or none, and is
what a run of belt, a copy and a blueprint set down all go through: each piece is checked and priced
as a single one is (`refusal`, `priceAt`), two of a set may not want one tile, and each goes down
with `build`, so over one of its kind a piece only turns it and a splitter or a joiner takes a belt's
place. A new belt or tunnel asked for no colour takes the colour of the line it joins, whatever
order the pieces come in. For a run, `stand` also takes the belt already standing where it starts,
turned to meet it. `refusals` gives each piece's reason, for a screen to show, and `priceOf` the price, with the
pieces to hand going down first. A refusal for want of Coins says how many are short.

`move(w, tiles, turns, x, y)` moves the pieces on some tiles as one, turned so many quarter turns to
the right, with the corner of the box they then fill on a tile (`placed` does the turning, for the
rules and for a screen alike). The pieces are the same pieces afterwards, holding what they held,
so it costs nothing; they may land where the set itself stood, but not where anything else stands,
not even one of their kind. `clear(w, tiles)` takes away every piece on some tiles for the refund
`remove` gives each. A tunnel named by either mouth is the whole tunnel; `within` gives the tiles of
the pieces in a rectangle, a tunnel only with both mouths in it, and never the depot.

**Blueprints.** A yard keeps three (`BLUEPRINTS`). `saveBlueprint(w, slot, tiles)` keeps the pieces
on some tiles in a place, set against the corner of their box: what each is and keeps, not what it
holds. One holds at most 400 pieces and is at most 32 tiles by 24 (`BLUEPRINT`). It is set down by
standing its pieces, so at a copy's price and by a copy's rules, and one with a kind of piece the
yard cannot build is refused by name. `deleteBlueprint` empties a place.

A machine keeps up to four of each part by it. It makes whatever the parts it holds add up to, and
takes in a part only if some one recipe uses it together with everything already held, so a mixed
belt is worked through rather than jammed on. A single belt that brings two parts in the wrong
proportion can still starve a bench (it fills with one and the other is stuck behind). `setRecipe`
tells a machine to make one thing only, and `tipOut` empties what a machine holds, which frees one
that has filled up with the wrong part.

A plain belt takes whichever of its feeders comes first, so one full line can keep another waiting;
a joiner takes turn about. A splitter sends one thing to each of its ways out in turn, starting after
the way it last sent to, and passes by a way that nothing takes from, one that is full, and one that
is shut. `setWay` shuts or opens a way (`shut` on the building: a bit each for ahead, left and right,
so they turn with it); a shut way hands to nothing in `rewire`, which is the one place that says so.
With all three shut a splitter holds what it has, and `status` says it is blocked.

A tunnel is built as both mouths at once and comes up at the nearest
clear tile; a thing spends as long under the ground as it would on belts over the same tiles. A
tunnel goes under belts, roots and the stream, but never under the depot, and the router goes round.

A belt, a tunnel mouth, a splitter and a joiner each have a `tint`: 0, or one of six colours a
player gives to tell lines apart. It changes nothing about how the yard runs. `paint` colours a
splitter or a joiner by itself, and a belt or a tunnel mouth with its whole line (`lineOf`): every
belt and tunnel joined end to end with it, as `rewire` hands things on, as far as the next thing
that is neither. A belt that joins the side of a line running straight on is a line of its own. A
belt built onto a coloured line, or pieces stood onto one (`stand`), take its colour: the line that
feeds them, or else the line they feed.

`status(w, i)` says what the thing on a tile is doing in a sentence, and whether it is in trouble
that will not mend itself: out of reach of power, nowhere to send what it makes, full of one part
and waiting for another. `rate` is how many it turns out in a minute at the yard's present pace.

**Power.** Reach and supply are separate. Power reaches 6.6 tiles from the depot and 4.6 from every
pylon that is within 8.1 of the depot or of another joined pylon. A machine out of reach does
nothing and draws nothing; a waterwheel or boiler out of reach gives nothing. Supply is what the
depot, the wheels and the burning boilers give; demand is what every gatherer, mill, bench and
workshop in reach draws, working or not, so both are steady numbers a player can plan by
(`power(w)`). When demand passes supply every one of those machines works at `supply / demand` of
its pace, and nothing stops. Belts need no power.

**Plans.** Thirteen, bought with Coins, opened by the story; some want an earlier plan first.

| Plan                                  | Price         | What changes                                    |
| ------------------------------------- | ------------- | ----------------------------------------------- |
| Sharper rakes, then Wheelbarrows      | 180, 1200     | gatherers at 1.5 and 2 times their pace         |
| Second-tier, then Third-tier machines | 1500, 7000    | mills, benches and workshops at 1.5 and 2 times |
| Waxed belts, then Roller belts        | 350, 3200     | belts and tunnels at 1.5 and 2 times            |
| The boiler, The tunnel, The workshop  | 220, 300, 900 | each opens its machine                          |
| A bigger flywheel                     | 450           | the depot gives 40 power                        |
| Taller pylons                         | 500           | pylons reach and link a third further           |
| Bigger crates                         | 300           | a crate holds 128                               |
| A fourth hook                         | 4000          | the board holds four standing orders            |

A gatherer is a little slower than the mill it feeds, so the gatherer plans and the machine plans
take turns at being what a line is waiting for.

**Orders.** The depot pays a hundredth of a thing's worth for anything that arrives, so nothing is
wasted, but orders are where the Coins are. Each thing that arrives goes toward one order that
still wants it: the story's first, then the board's from the top.

- _The story_ is twenty orders, one after another (`content/story.ts`). Filling one pays at once
  and opens machines, plots and plans. Eight of them leave something in the town for good.
- _The board_ goes up after the fourth story order: three standing orders, each from a place in
  town (the crab pond, the Treasury, the campfire, the market stalls, the quest board, the raid
  parties, the gate), one of the town's own (Pipwick, Fika, Tindra) or one of the guild's
  creatures, asking for one or two things (`content/asks.ts`). An order kept in a yard from before
  these askers is asked again by one of them for the same things when the yard is read back
  (`reask`). An
  order is drawn from the yard's seed and how many orders the board has shown before, so the same
  yard is always offered the same orders, reload or no. It asks only for things the yard can make
  as it stands and that the story has already asked for, in numbers sized by the work in them
  (every tick of gathering and making that goes into one), and pays what those goods are worth.
  Nothing on the board has a clock. A filled order waits there until it is handed over (`claim`),
  which pays it and hangs a fresh one; one unfilled order may be swapped for a fresh one, free,
  every ten minutes of the yard's time. Both name the order by its id. A yard without its seed (the
  page's copy) hangs no order: the place stays empty until Leaf's yard, which has the seed, comes.

**A second shift** (`SHIFT`, in `content/shift.ts`) would run the yard at double pace for an hour,
for 100 Leaf. Leaf may not be spent in town yet, so nothing runs it: the page shows its button
closed.

**Away.** The yard works for eight hours after its owner's last command, and then stands still
until their next: `stepTo` runs it no further. At each of their commands it remembers the moment
(`seen`: the tick, what its till held, and everything its depot had ever taken in), so
what it did since is the difference (`awayOf`): how long it worked, the whole Coins its till gained, and
how many of each thing the depot took in. Nothing is estimated: the yard is run every tick.

**Coins.** The yard keeps no purse. `build`, `buyPlot` and `buyPlan` are told the balance and say
what they took; `remove` says what comes back; whatever the yard earns gathers in `w.till`, and
`collect(w)` takes its whole Coins out. Leaf's Coins ledger is the only purse (see below).

**Saving.** `save(w)` is JSON with a version (3), without the seed when the yard has none, and
without `blueprints` when none is kept: the version did not change for them, so a save from before
there were blueprints reads as a yard with none. A splitter's shut ways are written only where one is
shut, the same way: an older save reads with every way open. `load(text)` gives back a yard it can
vouch for or
nothing: a record of the wrong shape or version is refused whole, and inside a good one any plot,
plan, building or blueprint that could not have come about by playing is left out. A blueprint is
read piece by piece with `readPiece`, as a command's pieces are.

## The Works on Leaf (`game.ts`)

`WORKS` is the Works as Leaf's play service holds it (`Game` in core): Leaf owns the yard, its clock
and its Coins, and the page runs a copy ahead of Leaf with the same rules.

**Time is Leaf's.** A yard holds `tick` and `at`, the moment of Leaf's clock that tick stands for,
so Leaf's tick for it is `tick + floor((now - at) / 100)` (`clockOf`). `create` starts a yard at tick
0, at Leaf's now, seeded from Leaf's dice. `advance` brings a yard that has fallen behind to `LEAD`
(30 ticks, three seconds) short of Leaf's clock, so that a command made a moment ago is never in
its past: a tick at a time however far, moving `at` with it (`stepTo`). A yard standing still keeps
Leaf's clock with it (`at` is set to now), so the hours it stood are let go and it starts again from
its owner's next command. `tend` does what `advance` does for as long as Leaf says, so that Leaf
can run a yard on a slice at a time: Leaf runs every yard so, whether or not anyone is looking (the
root README's play service). Given a command, `tend` runs the yard instead toward the tick `apply`
does it at, keeping what happened on the way as the command's news: Leaf runs a yard there before
each command, so that `apply` has no tick left to run.

**Commands** each carry `tick`, the tick the page's copy stood at. `apply` runs the yard to that
tick (one in its past is done now, one more than `LEAD` ahead of the clock at `LEAD`), then does
the command (`play`), or refuses it with a code (`REFUSED`) and leaves the yard as running on alone
left it. A plot, a plan and a standing order are named by fields of their own, since the play
service gives every command an `id`.

| `do`       | fields                                                                         |
| ---------- | ------------------------------------------------------------------------------ |
| `build`    | `kind, x, y, dir`: a piece; over the same kind it only turns                   |
| `lay`      | `legs: [{kind, x, y, dir, span}]`, `turn?: {x, y, dir}`: all of it or none     |
| `stand`    | `pieces: [{kind, x, y, dir, span, recipe?, open?, tint?, shut?}]`: all or none |
| `move`     | `tiles, turns, x, y`: the pieces on those tiles, as one, all or none           |
| `remove`   | `x, y`                                                                         |
| `clear`    | `tiles`: every piece on them                                                   |
| `turn`     | `x, y, dir`                                                                    |
| `paint`    | `x, y, tint`: the line through a tile, 1 to 6, or 0 for no colour              |
| `recipe`   | `x, y, item` (or null)                                                         |
| `tipOut`   | `x, y, item` (or null)                                                         |
| `crate`    | `x, y, open`                                                                   |
| `way`      | `x, y, way, open`: a splitter's way out: 0 ahead, 1 left, 2 right              |
| `buyPlot`  | `plot`                                                                         |
| `buyPlan`  | `plan`                                                                         |
| `swap`     | `order`: a standing order, by its id                                           |
| `handOver` | `order`: a filled standing order, by its id                                    |
| `collect`  | pays the till in, and puts the letter about a time away away                   |

`saveBlueprint` (`slot, tiles`) and `deleteBlueprint` (`slot`) keep and empty a blueprint's place.
`tiles` are tiles of the land by their place in its lists, at most all of them. Leaf reads a command
of at most 16 KiB, so one `stand` carries at most 160 pieces (`STAND_MOST`): the page sends a larger
set as several, having first checked the whole of it.

**Coins** are the ledger's. A `build`, `lay`, `stand`, `buyPlot` or `buyPlan` pays the till's whole
Coins in first and then takes the price, in one change; `remove` and `clear` give back what the
pieces cost, in one change; a `move` changes none; `collect` pays the till in;
an order's pay goes into the till. Each change is keyed by the yard's `bank`, which counts them, so
none is made twice, and every one paid in is `free` of the earnings cap: a yard cannot earn faster
than time passes. Each command logs a plot or plan bought, a standing order handed over, and the
story orders finished since the yard last logged one (`told`).

**What the page is shown** (`view`) is `{ yard, clock }`: the yard as stored but without its seed,
which foretells every order the board will hang, with `away` (what it did since its owner's last
command, once that was five minutes ago or more), and Leaf's tick now. A visitor is shown the same
without the blueprints. The page reads it with
`readView` and `WORKS.decode`, and holds a yard with no seed.

## What the town can read

- `w.given`: how many of each thing have gone to orders, ever.
- `townGifts(w)`: what finished story orders have left in town, oldest first, each with an id and a
  line to show (`tree-lanterns`: "Lanterns from the Works hang in the great tree.").
- `postcard(w)` is what the page leaves for the town (the kit's `postcard.ts`) whenever it changes
  and when the town closes it: what is waiting in the yard, the capstones ever made, the till.

## How it is put together

| File                    | What it holds                                                               |
| ----------------------- | --------------------------------------------------------------------------- |
| `index.ts`              | everything a screen needs from the rules, in one import                     |
| `content/*.ts`          | the tables: things, recipes, machines, plots, plans, the story, the shift   |
| `land.ts`, `world.ts`   | the ground put together from the plots; the yard as data                    |
| `build.ts`              | building, taking away, turning, tipping out; buying plots and plans         |
| `pieces.ts`             | many pieces at once: standing a set, moving one, clearing one; blueprints   |
| `power.ts`, `step.ts`   | where power reaches; one tick of the yard                                   |
| `orders.ts`, `clock.ts` | the depot, the story, the board; the yard's time, and its owner's           |
| `game.ts`               | the Works as Leaf holds it: its clock, its commands, its Coins, the view    |
| `route.ts`, `save.ts`   | the shortest clear run for a belt; a yard as text, and back                 |
| `status.ts`             | what a thing is doing, in a sentence, and whether it is in trouble          |
| `yards/*.json`          | yards kept part-way through the story, for tests and for looking at a stage |

A tick has three parts: power is reckoned, then gatherers gather and machines make and things on
belts move along their tile, then every tile hands on what it has finished with, each tile after
the tile it hands to, so a full belt moves as one. Who hands to whom, and in what order, depends
only on what stands where, so it is worked out once (`rewire`) and kept until the yard is changed.

## Running the yard ahead of Leaf

```ts
import { play, stepTo, WORKS } from "@sequoia-leaf/yard";

// When Leaf answers: its yard, with every command not yet answered done again on top, each at its tick.
const copy = WORKS.decode(view.yard);
for (const c of unanswered) play(copy, c);

// Every frame: run the copy on to Leaf's tick now, the view's clock and a tick for each 100 ms since.
stepTo(copy, view.clock + Math.floor((performance.now() - arrived) / 100));

// When the member acts: done to the copy at once, and sent with the copy's tick.
const done = play(copy, { do: "build", kind: "mill", x, y, dir, tick: copy.tick });
if (!("refused" in done)) send({ do: "build", kind: "mill", x, y, dir, tick: copy.tick });
```

What stands on a tile is `yard.cells[at(yard, x, y)]`, the ground under it is in `yard.land`, power
reaches where `yard.power[i]` is 1, and the orders are `storyOrder(yard)` with `yard.filled`, and
`yard.board`. `route(yard, from, to)` and `stand` are there for laying a belt from two taps, which
suits a phone better than dragging.

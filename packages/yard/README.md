# The Works: the yard with no screen in it

The yard behind the guild's workshop, as rules: gatherers pick things up off the forest floor, belts
carry them, machines make goods of them, and the depot in the middle takes everything in.

Everything in this package (`@sequoia-leaf/yard`) is plain data and plain functions, tested. None of
it touches the page: it is type-checked without the page's library or Bun's, and `pure.test.ts`
reads its sources for the clock, chance and storage. The Works' page (`apps/works`) imports it
through `index.ts`.

```sh
bun test                                 # the rules
bun ../../apps/works/review/balance.ts   # plays the whole story by script and prints the pacing
```

## The rules, as built

**Time.** The yard moves in ticks, ten to a second. Everything below that takes time is counted in
ticks at the plain pace; plans, a shortage of power and a second shift change the pace.

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
| Splitter   |    8 |          | in at the back; out ahead, left and right by turns                       |
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

A machine keeps up to four of each part by it. It makes whatever the parts it holds add up to, and
takes in a part only if some one recipe uses it together with everything already held, so a mixed
belt is worked through rather than jammed on. A single belt that brings two parts in the wrong
proportion can still starve a bench (it fills with one and the other is stuck behind). `setRecipe`
tells a machine to make one thing only, and `tipOut` empties what a machine holds, which frees one
that has filled up with the wrong part.

A plain belt takes whichever of its feeders comes first, so one full line can keep another waiting;
a joiner takes turn about. A tunnel is built as both mouths at once and comes up at the nearest
clear tile; a thing spends as long under the ground as it would on belts over the same tiles. A
tunnel goes under belts, roots and the stream, but never under the depot, and the router goes round.

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
  parties, the gate), one of the town's own (Pipwick, Embertoe, Tindra) or one of the guild's
  creatures, asking for one or two things (`content/asks.ts`). An order kept in a yard from before
  these askers is asked again by one of them for the same things when the yard is read back
  (`reask`). An
  order is drawn from the yard's seed and how many orders the board has shown before, so the same
  yard is always offered the same orders, reload or no. It asks only for things the yard can make
  as it stands and that the story has already asked for, in numbers sized by the work in them
  (every tick of gathering and making that goes into one), and pays what those goods are worth.
  Nothing on the board has a clock. A filled order waits there until it is handed over (`claim`),
  which pays it and hangs a fresh one; one unfilled order may be swapped for a fresh one, free,
  every ten minutes of the yard's time.

**A second shift.** `boost(w, now, ms)` makes the yard run two ticks for every one until a moment
on the wall clock. It is the one thing Leaf buys here: `SHIFT` (in `content/shift.ts`) says what it
costs and how long it runs, 100 Leaf for an hour. It opens nothing.

**Away.** `runTo(w, now)` brings the yard up to the clock. A gap of under fifteen seconds is simply
run. After a longer one the yard is credited with up to eight hours' work (a second shift counting
double for as long as it lasted) and an `Away` comes back saying what it did: Coins earned, things
made, orders filled, Coins waiting on the board. Eight hours is 288,000 ticks, so it is not all
run: a few thousand ticks are run for real, counting only what the depot takes in during them,
and the rest is paid out at that pace, through the same order book. A line that had already run
dry is therefore paid nothing. Where a crate would fill or run dry part-way, the yard is paid up to
that moment, run again for a short while to find its new pace, and paid on. A boiler with nothing
gathered for it burns what it holds and what the crates and belts behind it hold, and then goes out:
the yard is paid at the pace with it only until then, it is let go out for real, and the pace
without it is found afresh, once for each boiler that goes out. On the largest yard the
balance script builds this takes about 7 ms and lands within a fifth of a percent of running every
tick.

**Coins.** The yard keeps no purse. `build`, `buyPlot` and `buyPlan` are told the balance and say
what they took; `remove` says what comes back; whatever the yard earns gathers in `w.till` until
`collect(w)` hands it over in whole Coins. A new yard has no Coins of its own: the screen pays for
everything out of the member's purse, and pays the till into it, each with its reason (a building
or a belt, a plot, a plan, what taking one away gives back; from the till, what orders paid since
it was last paid out, and the rest as the depot's). On the guild's server the purse's Coins are
Leaf's, and each of those goes to Leaf's ledger.

**Saving.** `save(w)` is JSON with a version (2). `load(text)` gives back a yard it can vouch for or
nothing: a record of the wrong shape or version is refused whole, and inside a good one any plot,
plan or building that could not have come about by playing is left out. The first yard, before
this one, was a different map with different machines, so its saves are not read as yards;
`oldCoins(text)` finds the Coins in one so a screen can carry them over: with the made-up guild
only. On the guild's server nothing the browser kept becomes Coins; old Coins are brought over
by hand (the root README's Moving over).

## What the town can read

- `w.given`: how many of each thing have gone to orders, ever.
- `townGifts(w)`: what finished story orders have left in town, oldest first, each with an id and a
  line to show (`tree-lanterns`: "Lanterns from the Works hang in the great tree.").
- `runTo` gives the `Away`, and `awayLine(away)` puts it in a sentence: "While you were away the
  Works made 340 Coins and finished "Lanterns for the great tree"."
- `postcard(w)` is what the page leaves for the town (the kit's `postcard.ts`) whenever it changes
  and when the town closes it: what is waiting in the yard, the capstones ever made, the till.

## How it is put together

| File                    | What it holds                                                               |
| ----------------------- | --------------------------------------------------------------------------- |
| `index.ts`              | everything a screen needs from the rules, in one import                     |
| `content/*.ts`          | the tables: things, recipes, machines, plots, plans, the story, the shift   |
| `land.ts`, `world.ts`   | the ground put together from the plots; the yard as data                    |
| `build.ts`              | building, taking away, turning, tipping out; buying plots and plans         |
| `power.ts`, `step.ts`   | where power reaches; one tick of the yard                                   |
| `orders.ts`, `clock.ts` | the depot, the story, the board; the wall clock and catching up             |
| `route.ts`, `save.ts`   | the shortest clear run for a belt; a yard as text, and back                 |
| `status.ts`             | what a thing is doing, in a sentence, and whether it is in trouble          |
| `yards/*.json`          | yards kept part-way through the story, for tests and for looking at a stage |

A tick has three parts: power is reckoned, then gatherers gather and machines make and things on
belts move along their tile, then every tile hands on what it has finished with, each tile after
the tile it hands to, so a full belt moves as one. Who hands to whom, and in what order, depends
only on what stands where, so it is worked out once (`rewire`) and kept until the yard is changed.

## Driving the rules from a screen

```ts
import { build, claim, collect, create, drain, load, power, refusal, runTo, save } from "@sequoia-leaf/yard";

const yard = load(kept) ?? create({ seed });
const away = runTo(yard, Date.now()); // once on opening: an Away after a long gap, else null

// every frame
runTo(yard, Date.now());
purse.earn(collect(yard), "the Works");
for (const news of drain(yard)) celebrate(news); // a story order done, a standing order filled or handed over
const { supply, demand, pace } = power(yard);

// when the member acts
const why = refusal(yard, "mill", x, y, purse.coins, dir); // null, or a sentence to show
const did = build(yard, "mill", x, y, dir, purse.coins);
if (did.ok) purse.spend("coins", did.cost, "the Works");
```

What stands on a tile is `yard.cells[at(yard, x, y)]`, the ground under it is in `yard.land`, power
reaches where `yard.power[i]` is 1, and the orders are `storyOrder(yard)` with `yard.filled`, and
`yard.board`. `route(yard, from, to)` and `lay` are there for laying a belt from two taps, which
suits a phone better than dragging. `yard.seen` is the moment the yard has been run up to, so the
share of the next tick already gone is `(Date.now() - yard.seen) / TICK_MS`.

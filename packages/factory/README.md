# The Works, second design

The rules of the second Works, on flat data: numbers in typed arrays and a few small records,
nothing for each piece and no string for each thing. Tiers 0 to 4 are whole: nodes (lessons,
projects and commissions), research and the Study, counted recipes, grades, the sorter and the cart
stop. Leaf's play service plays it as the Works (`FACTORY`, under the id `works`), and the Works'
page (`apps/works`) holds a copy and draws it; the town reads its standing's words (`src/stats.ts`).

## What to read for which kind of work

| To work on                                                                    | Read                                                                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| what things, machines, grades, recipes, plots, nodes, research and askers are | `src/content/*.ts` (data only)                                                |
| how a name becomes a number; what is open once some goals are done; `locked`  | `src/tables.ts`                                                               |
| what a yard holds, and its side tables                                        | `src/yard.ts`, then `src/land.ts`                                             |
| one tick                                                                      | `src/tick.ts`, `src/wire.ts` (who hands to whom), `src/power.ts`              |
| building, raising, removing, turning, setting pieces, plots                   | `src/build.ts`; many pieces at once: `src/pieces.ts`; colours: `src/lines.ts` |
| a plan of the whole yard: kept, and put back over the yard                    | `src/whole.ts`                                                                |
| the node in hand, the line of research, the board                             | `src/orders.ts`, `src/clock.ts`                                               |
| Leaf's game: commands, Coins, time, the view and the answer                   | `src/game.ts`                                                                 |
| keeping a yard, and the check                                                 | `src/codec.ts`, `src/bytes.ts`, `src/check.ts`                                |
| the route for a run of belt and its legs; what a piece is doing               | `src/route.ts`; `src/status.ts` (`condition` decides, `status` words it)      |
| what a machine or a line makes and needs a minute                             | `src/planner.ts`, and `plan.ts` for the table of the slice                    |
| what an unlock is, for a screen: a typed list, each with its made sentence    | `src/unlocks.ts`; what a tier is called: `src/content/tiers.ts`               |
| what a yard as it stands can make and needs a minute                          | `flow`, in `src/status.ts`                                                    |
| the wire from the page's side: a command written, what Leaf sends read back   | `src/page.ts`                                                                 |
| what the town is told: the postcard, the standing's words                     | `src/postcard.ts`, `src/stats.ts`                                             |
| yards built with commands, for the tests and the play server's tours          | `test/yards.ts` (`delivering`, `generated`, `staged`)                         |
| how long the slice takes a player                                             | `pace.ts` (its settings), then `pace/`                                        |
| what it costs                                                                 | `bench.ts`, and `test/budgets.test.ts` for the budgets                        |
| that a change to the tick leaves every yard as it was, to the bit             | `test/replays.ts` (`bun test/replays.ts --write` writes the record again)     |

```sh
bun test       # every rule, the tables, the budgets and the record of the tick (about 50 seconds)
bun bench.ts   # times and sizes of generated yards of about 6,000 and 10,000 pieces, then hours of work
bun bench.ts --hours   # ms of work an hour of the yard's time for each staged yard and save, and lines that never wait
bun bench.ts --hours --lines   # lines that never wait alone: three of 41 belts from full crates into the depot
bun plan.ts    # the planner's table for every thing the slice can make
bun pace.ts    # tiers 0 to 3 played as a careful player would, and how long each goal took (about 3 seconds)
```

## The yard

A tile is `y * w + x`. Every array below is indexed by the tile, and holds `NONE` (255) for
nothing:

| Array   | Type  | What it holds                                                                                             |
| ------- | ----- | --------------------------------------------------------------------------------------------------------- |
| `kind`  | Uint8 | what stands there                                                                                         |
| `dir`   | Uint8 | the way it faces: 0 east, 1 south, 2 west, 3 north                                                        |
| `grade` | Uint8 | its grade, 1 to 3, for a belt, tunnel, splitter, joiner, sorter, gatherer, mill, bench, workshop or Study |
| `item`  | Uint8 | what a belt, splitter, joiner, sorter or tunnel mouth carries                                             |
| `prog`  | Uint8 | how far across its tile, in eighths                                                                       |
| `via`   | Uint8 | the side it was handed in from, 1 + a way, or 0 (only for drawing)                                        |
| `tint`  | Uint8 | a line's colour, 0 to 6                                                                                   |
| `turn`  | Uint8 | a splitter's next way out, a joiner's next way in                                                         |
| `shut`  | Uint8 | a splitter's shut ways, a bit each                                                                        |
| `first` | Uint8 | the way a splitter puts first, 1 + the way, or 0 for none                                                 |
| `set`   | Uint8 | the one thing a machine is told to make, or a sorter sends to its left                                    |
| `free`  | Uint8 | 1 for one of the pieces a new yard has to hand                                                            |
| `span`  | Int8  | a tunnel's tiles under: positive at the way-in mouth, negative at the other                               |
| `row`   | Int32 | the piece's row in a side table, or -1: read only by `holderOf`, `tunnelOf`                               |
| `lit`   | Uint8 | 1 where power reaches                                                                                     |
| `made`  | Uint8 | how many times the tile has been cleared, round from 255 to 0: never kept, read by Undo                   |

Side tables have a row for each piece that needs one, kept packed (a removed row takes the last),
and grow by half when full. `row` holds a holder's row for some kinds and a tunnel's for another, so
it is read only through `holderOf` and `tunnelOf`, which give -1 for a kind without that table's row
(`test/condition.test.ts` holds every file of the rules to it):

- **holders**, for gatherers, mills, benches, workshops, crates, boilers and Studies: `out`,
  `making`, `last` (things, Uint8: `last` is what a machine last began, for a screen, neither kept
  nor checked), `work` (Uint16, half-ticks), `idle`, `open`, `fuel`, `kinds` (Uint8), `count`
  (Uint16), and `stock`, how many of each thing (Uint16, 25 a row);
- **tunnels**, for each way-in mouth: `under` (thing, Uint8) and `along` (eighths, Uint8), three a row;
- **blueprints**: each one's pieces as 10 bytes a piece (kept in fewer, below).

The plumbing (`wire`) is worked out once after a change: five lists of tiles, sized by what
stands (the order things are handed on in, the tiles that carry, tunnels' way-in mouths, the pieces
that work, the boilers in reach), for each tile the sides it takes things in from, a bit each, and
for each kind of machine the recipes it may make. Which sides a piece takes things in from is
`takes`, read alike by the tick (through those bits), a piece's status and the router; whether it
takes a particular thing is `wants`, and whether it has room for it now is the tick's alone, so a full
belt is still joined. A tick runs down those lists and nothing else, and
makes nothing. Kept with the plumbing, a byte a tile says which tiles wait: each holds a thing the
tile it hands to had no room for, and handing on passes it over until a tile beside it may have room
(`src/tick.ts` says when). A full belt that cannot move costs a tick almost nothing; waiting is
forgotten with the plumbing and after every command.

Beside them, plain records: the clock, the till, the power put by, the goals (done, in the order
they were done; the node in hand; the line of research; what each goal not done has been given),
the board's orders, plots owned (in the order bought), the depot's books, and `open`: what may be
built, bought and used, worked out from the goals done (`openOf`) and never kept.

## Whole numbers

Every number a yard keeps, and every number a tick moves, is whole; the tallies are Float64Array only
for their range.

- **Coins** are thousandths. The depot pays a hundredth of a thing's worth for each that arrives
  (`ARRIVAL`: 3 for a plank); the till pays in whole Coins and keeps the rest.
- **Work** is half-ticks. A gatherer, machine or Study does `PACE[grade]` a tick it works: 2 at
  grade 1, 3 at grade 2, 4 at grade 3. A recipe of 12 ticks wants 24; a gatherer 30; a Study 100 for
  each folio.
- **Belts** move `PACE[grade]` eighths of a tile a tick: a tile in 4, 3 or 2 ticks; so do tunnels,
  splitters, joiners and sorters, each at its own grade.
- **Power** is counted in halves: a piece draws its kind's power once for each half its grade draws
  (2, 3, 4: `drawnAt`), and the depot, waterwheels and boilers give 2 halves for each power. Every
  screen reads power from `power` (with `speed`, the whole per cent machines work at, rounded down),
  `powerSummary` (each kind in reach and in the dark, and what it draws) and `machineRate` (one
  piece: at full power, now, and what it draws now).
- **A shortage of power** is a store (`charge`). Each tick the power there is goes into it, and when
  it holds all that is drawn it is spent and every gatherer, machine and Study works that tick; when
  it does not, none does. With 5 power of every 8 drawn they work 5 ticks in 8, exactly; what is left
  over carries to the next tick and is kept with the yard. A yard with power enough works every tick
  and keeps nothing in the store.
- **Reach** is in hundredths of a tile (`REACH`: a pylon 460), made longer by a whole percentage
  (`open.reach`: 100, 135 with "Taller pylons"), and read as a whole squared distance: a tile is in
  reach when the square of its distance is no more than the reach squared, rounded down.

## Recipes that count

A recipe takes a count of each part and makes one thing (`{ plank: 2, pot: 1 }` makes a hamper). A
machine works out what to make from what it holds as it always has: it takes a thing that some
recipe it may make (the one it is told to make, if it is told) uses together with everything it
holds, and starts the first recipe for which it holds enough of every part.

It takes a part while it holds fewer than 4 of the smallest batch of it that any such recipe takes.
Where every count is 1 that is 4, as before; so a bench with nothing set takes 4 planks, and a
hamper is not started until a second plank comes. Once it holds a pot, only the hamper is left, and
it takes planks up to 8. A machine with enough of one part and none of another takes no more of the
first; it is starved, its status names the part to tip out (`tipOut`) and the one it waits for.
Telling it what to make (`recipe`) tips out whatever it holds beyond 4 of that recipe's batches of
each part (so all of a part the recipe does not use); told nothing, beyond what the recipe of all it
may make that takes the most of each part keeps (`keeps`, `holdsMost`).

Every recipe a yard of tier 0 or 1 may make takes one of each part: the hamper and the glazed shell
are unlocked by tier 1's commission, and lanterns and raid kits are made in a workshop. A machine
makes, is told to make and takes parts in for only the recipes `locked` lets it.

Not built, on purpose: a recipe that makes more than one.

## Grades

A belt, tunnel, splitter, joiner, sorter, gatherer, mill, bench, workshop and Study each have a
grade, 1 to 3, kept on the piece; grade 2 works 1.5 times as fast, costs 3 times as much and draws
1.5 times the power; grade 3, twice, 8 times and twice (`GRADES`). A splitter, joiner or sorter
passes things on at a belt's pace for its grade, so one of a lower grade than the belts round it
holds their line back; whatever unlocks a belt's grade unlocks theirs (`content/nodes.ts`).
`open.kinds[k]` is the highest grade of a kind the yard may build, 0 for a kind not unlocked; a
grade unlocked opens a kind only once the kind itself is (the wax grades the sorter before the
sorter is known).

Building a kind over one of its kind turns it and sets it to the grade asked for, keeping what it
holds, carries, its colour and what it is set to, for the difference in price, which is given back
for a lower grade. A tunnel is raised or lowered with both its mouths. A run of belt laid along belts
does the same to each. Removing gives back what a piece cost at its grade; for one of the pieces a
new yard has to hand (grade 1), what was paid to raise it. `upgrade` raises every piece on some tiles
to the highest grade the yard may build of its kind, all or none (`upgradePrice`, `upgradeRefusal`).
A piece moved, copied, kept in a blueprint or read back keeps its grade, and one set down at a grade
not unlocked is refused with the grade and kind.

## Goals: nodes and research

`content/nodes.ts` and `content/research.ts` are two tables; `tables.ts` numbers them as one list of
goals, the nodes first. Each wants a tally (things delivered, or folios studied), may need other goals
done first, and unlocks an `Unlocks`: kinds, grades, recipes, plots for sale, tools, blueprints and
their size, cart stops, a crate's size, a pylon's reach, the depot's power, a tunnel's span, the hours
the yard runs unwatched, the board and its hooks. Where two give a number the larger holds. A recipe
nothing unlocks is known from the start; a new yard has `START`.

- **Tiers.** Tier 0 is open from the start; each next tier opens once every lesson and commission of
  the one before is done. Each tier's land is put up for sale by the node that opens it.
- **The node in hand** takes what reaches the depot first; the board's orders take the rest. A
  goal is `ready` when it is not done, its tier is open, what it needs is done, and for a lesson,
  every lesson before it is done. `take` puts any ready node in hand; what each node has been given
  stays given. Up to 3 more may wait in a line after it, in the player's order (`queue`, `unqueue`):
  a node goes in only as it could be taken in hand, once, and with nothing in hand it is taken at
  once; taken in hand, it leaves the line. When the node in hand is finished, or a goal is finished
  while nothing is in hand, the first in the line that may be taken comes into hand; with none, the
  next lesson, else the commission of the highest tier open if it is ready, else nothing. Tier 3's
  commission needs the oil press, the workshop and the Brass folio known.
- **Research** is studied in a line of up to 4 (`study`, `unstudy`); the first is being studied. A
  Study holding a folio the research still wants works on it as a machine works (100 half-ticks at
  its grade's pace, so one every 50 ticks at grade 1), and then puts it toward the research. One the
  research has stopped wanting meanwhile stays in the Study, as does any folio the research does not
  want. A Study's work belongs to the research first in the line: when another comes first (one taken
  out, or known), every Study's work is dropped; tipping out a folio drops it only if it is the one
  being worked on. Known, the research unlocks, and the next in line begins. `knownSince` is the
  research that became known since the yard's owner was last there, for the letter about a time
  away; `machineRate` gives a Study's folios a minute at the yard's pace, as it gives a machine's.
- **Finishing** either kind of goal is one function (`finish`): it is done, what it unlocks is open,
  a node pays and the next comes into hand, research lets the next begin, and the yard has news of
  it. Leaf logs each node finished.

## What a yard may do

One function says it: `locked(open, lock)`, in `tables.ts`, gives why a yard may not yet do
something, or nothing. It is asked of a kind of piece at a grade, a recipe (its own unlock and its
machine's), a tool (an area is raised with Select as well as Upgrading an area), how many cart stops
may stand, and a blueprint (its place, how many pieces, how large). Nothing else reads what is open
to decide these: building, standing and laying (`refusal`, and `pieceRefusal` for what a piece is set
to and its colour), moving, raising an area (`highest`), setting a recipe, the plumbing's recipes for
each machine (`recipesFor`), the router, keeping a blueprint, what the board may ask for, and reading
a yard back.

- **Tools.** A command of a tool the yard has not unlocked is refused with the code `locked`: `paint`
  (Paint); `move`, `copy`, `clear`, `placeBlueprint` and a `stand` of two pieces or more (Select);
  `saveBlueprint` (any blueprints); `upgrade` (Upgrading an area, and Select); `saveYard` (A plan of
  the whole yard, and Select), and a plan of the whole yard put back needs it too. A single piece
  (`build`, or a `stand` of one: a removal undone) and a run of belt (`lay`) never are.
- **A run of belt** (`lay`) is made of legs (`Leg`, in `route.ts`): a belt or a tunnel, its tile and
  way, and its grade; only a tunnel's leg says how far under (`span`: 0 for the tunnel standing there,
  raised or lowered), since only a tunnel goes under, so a belt's leg cannot hold one. A leg has nothing
  to set, so the router, the page's run, the writer and the reader carry nothing else, and the rules
  stand each leg as a piece made of those parts alone (`legPiece`). On the wire a belt's leg is a
  piece's shape, with a span of 0. A run that
  names a tunnel twice, by both its mouths, is refused before anything changes, and a run is charged
  the price `priceOf` gives it. Its `turn` turns a belt already standing where the run starts, and
  nothing but a belt.
- **A copy** (`copy`) is one command, as a move is: the tiles, the turns and the corner. What stands
  on those tiles is stood again there (`copyOf`), all or none whatever its size, with the same checks
  as standing those pieces, and charged as one change.
- **Standing pieces** (`stand`) is only for putting back what was taken away (an undone removal), at
  most 160 a command, since Leaf reads a body of at most 16 KiB: a larger put-back goes as several,
  each all or none. A colour in it needs Paint, and what a piece is set to its own unlock. A
  blueprint is set down by naming its place, its corner and its turns (`placeBlueprint`), all or
  none, whatever its size. A tunnel named with its span over a tunnel must be that tunnel, going in
  on its tile that way that far, and is raised or lowered; two pieces of one set on one tile, as a
  kept blueprint might hold, are refused.
- **A plan of the whole yard** (`whole.ts`, the tier 4 research of that name, the most the game asks
  for any: about 15 hours of grade III lines of each folio) keeps every piece in the yard
  (`saveYard`), on the tiles each stood on, whatever their number or the land they cover, in one of
  the yard's places for blueprints. Set down (`placeBlueprint`, whose corner and turns it does not
  read), it goes back where it was taken and makes the yard its layout, all or none (`yardPlan`,
  `placeYard`): a piece that stands as the plan has it stays, with what it holds and is doing; every
  other is taken up, and every piece of the plan not standing is stood, each priced as the rules
  price it (one taken up gives back what it cost, and one of the pieces to hand goes back to hand; one
  stood costs its price, less one to hand while the yard has one). It is refused whole for any piece
  that cannot stand, with its reason, and for Coins short of the net price, with how many for the
  whole. Undo takes it back as one entry (`history.ts`).

- **Coins.** The yard keeps no purse: Leaf plays a command (`FACTORY.apply`) with none, and its
  ledger refuses a price the member's Coins do not cover. The page plays the same command on its copy
  with the purse as it is at the moment it sends (`play(y, command, purse)`): whatever costs more than
  the purse and the till's whole Coins (which a command that costs pays in first) is refused with the
  rules' own sentence ("Not enough Coins", or "Not enough Coins: 12 short" for many pieces at once),
  and nothing changes.

## Pieces new to this design

- **The Study** (`study`), one tile: takes folios in from any side, holds up to 20 of each kind, and
  draws 6 power at grade 1. Its work, and the folio it works on, are kept with the yard.
- **The cart stop** (`stop`): takes things in from any side, and each has reached the depot at once.
  A yard may stand as many as it has unlocked.
- **The sorter** (`sorter`): takes things in from behind; the one thing it is set to (`sort`) goes out
  to its left, everything else ahead. With nothing set it is a belt.
- **A way put first** (`first`, once the yard has unlocked it): a splitter may put one of its open
  ways out first. What it carries goes that way whenever the tile there takes it, and only otherwise
  to its other open ways, in the turn it keeps. Shutting that way puts none first. Who hands to whom
  is the same, so the plumbing stands; the planner and `flow`, which read no splitter, are as they
  were.

## Standing orders

A standing order is sized by the tier reached: 6,000 ticks of work and 3,000 more for each tier open
beyond the first, shared out between one or two things as `fresh` draws them. Only Leaf, holding the
seed, can draw one. It counts from 50 ticks after it is hung (`starts`): until then the depot gives
it nothing, it cannot be handed over (`claim`), and the check leaves it out. A fresh order is hung at
the end of the board. What Leaf answers a batch with (`answer`) is the yard's tick, its check, and the
orders hung in the last minute (`ORDER_TOLD`), counting or not, so that a batch that runs past the tick
one counts from still tells the page of it. `FACTORY.answer` puts it on the wire (`Short`): Leaf's
tick now beside it, and each order as it is kept (`keptOrder`), which the page reads back with
`readAnswer` (`orderOf`, the same reader the codec vouches a kept order with).

## The wire, from the page's side

Leaf reads a command off the wire with `readCommand`; the page writes one with its inverse,
`writeAct` (`writeCommand` with the tick), every thing, kind, plot and goal by its name, so that what
the page writes reads back as the same act (`test/page.test.ts`, and every command of random play in
`test/play.test.ts`). What Leaf sends back is read here too: the view (`readView`), a command's notes,
which are the yard's news (`readNotes`), and the answer to a batch (`readAnswer`), each tested against
what `FACTORY` really gives; and the orders in an answer are put on the page's copy by `hear`, so that
nothing on the page writes to its yard but the rules. A visitor is given the yard as its owner's
page is (`FACTORY.visit`, blueprints and all), and Leaf tells a visitor's page each command it keeps
as `FACTORY.echo` writes it: as the owner's page wrote it, with the tick it was done at, the yard's
after it. A copy that does each one off the wire (`readCommand`, `play`) at its tick, and runs on to
the tick of Leaf's answer, has Leaf's check there (`test/play.test.ts`, over random play and time
away). The postcard the town is left (`postcard`) and what a standing says on a
card (`WORKS_STATS`, in `src/stats.ts`, which reads nothing of the rules) are here as well.

## What is unlocked, for a screen

`unlocks.ts` is the one place an `Unlocks` is read into what a screen shows: `unlocked(u)` gives a
list of things of a few kinds (a kind of piece, a kind at a grade, a recipe, a plot for sale, a tool,
blueprints and their size, a number with what it was before, the board), each with its name and one
plain sentence made from its own numbers and the tables' ("A bench makes hampers from 2 planks and 1
pot.", "A crate holds 128 items, up from 32.", "Carries up to 200 items a minute, up from 150. A tile
costs 3 Coins."). A number that comes with the kind it belongs to, with nothing before it (a tunnel's
first length, the first cart stop), is the kind's to say and is not listed again. `unlockedBy(goal)`
is the same for a goal, so that a screen asks by the goal and never holds an `Unlocks`; the page has
a test that it reads no field of one. `tierName` is what a tier is called ("Tier 2: The stream"), from
`content/tiers.ts`; `TOOL_INFO` what each tool is called and does; `numeral` a grade as it is written.
Nothing in the rules reads any of this: what a yard may do is `openOf` and `locked`.

The research table's `what` lines are written by hand and say nothing these sentences do not.

## What a piece is doing, for a screen

`condition` is the one place a piece's state, and whether it is in trouble, is decided: a number
(`STATES`, and `TROUBLE` added), making nothing, so that a screen can ask it of every piece in view
each frame. `status` takes the state and the trouble from it and adds the sentence, and what the
sentence names (the part to tip out, what is waited for). `test/condition.test.ts` holds each
decision on yards built for it. Neither, nor `aim`, makes anything while the plumbing is worked out:
they read a machine's recipes from it (`Wire.recipes`).

`flow` adds up, for a yard as it stands, what its pieces can make of each thing a minute and what
they need of each to do it: every gatherer, machine and Study power reaches, taken as working each
tick the yard's power lets it (as `machineRate` takes one piece) and never waiting for a part or for
room, so what it gives is a ceiling and not a count. A machine is counted for the recipe it is
working toward (`aim`); one told nothing that holds nothing has none for the moment, and is counted
for the recipe it last began (`lastRecipe`, kept on its row in `holders`, so it goes when the piece is
taken away). A Study needs the folios the research first in line still wants, in the shares it wants
them; a boiler in reach, the deadfall it burns. It runs down the plumbing's lists and makes nothing.

What reaches the depot is not measured by the rules: the depot's books (`y.depot`) are a running
total for each thing, and a screen that wants "in the last minute" keeps a few of those totals and
subtracts (the Works' page does, in `apps/works/src/arrivals.ts`). The rules used to keep a count of
their own for it (`y.pace`), begun again at every change; it is gone from the yard, the tick, the
codec and the check.

`priceOf` with `bare` prices a set of pieces as if on clear ground: a blueprint or a copy before it
is aimed anywhere.

## The planner

`planner.ts` reads only the tables: what a piece of a kind and grade makes a minute (`makes`), what a
machine needs of each part a minute (`needs`), how many of the piece before it each part takes
(`feeders`), the whole tree of machines and gatherers for a thing at a pace (`tree`) and what that
tree takes of each piece (`bill`). Every piece is taken as working every tick. `plan.ts` prints, for
every thing the slice can make, one machine's output a minute and the line that feeds one flat out.
`carried(grade)` is how many things a minute a belt, tunnel, splitter, joiner or sorter of a grade
carries when it is kept full: a thing crosses a tile in a whole number of ticks, so 150 at the first
grade, 200 at the second and 300 at the third, which a test holds a real line of each to.

## How long the slice takes

`bun pace.ts` plays every node and piece of research listed at the top of `pace.ts` (today tiers 0
to 3, from a new yard to tier 3's commission and every piece of research), by the rules: every change
is a command off the wire given with `play` at the yard's tick, and the yard runs on, tick by tick,
meanwhile. It prints a row for each goal in the order done, a row for each tier with nodes beside
the time the design means it to take (`TARGETS` in `pace/table.ts`; "none yet" for a tier with
none), and a line for the slice; `--json` gives the same as data, `--seed N` plays another land's
orders, `--folios N` builds the Studies for N folios a minute (24, two Studies, unless said).
`--seeds 1-12` plays each of those seeds and prints, for each tier, the least, the middle and the
most minutes, building and waiting (for Coins and for deliveries together) of the seeds that
finished it, and names any seed that stopped short. The same seed and settings give the same table,
to the tick. A run takes about 9 seconds; twelve seeds, about 2 minutes. To report a new tier, add
its nodes and research to `NODES` and `RESEARCH` and its time to `TARGETS`; whether the player can
then lay it out is another matter, to be seen in the run (tier 4 does not lay out yet: the raid
kits find no room).

Each row's time runs from when the player turned to the goal (for research, from when it began to be
studied) to when it was done, split into building (setting pieces down, laying belts, buying plots,
taking lines up, working lines out, reading), waiting for Coins and waiting for deliveries or folios.
A row also has the pieces standing, the Coins the player has, the power drawn and given, and what was
bought for it (and how many pieces were taken up for it). A tier runs from when it opened to when its
commission was done and the next opened. Research of a tier still being studied then is marked
(`~ after:`), not counted in the tier, and summed on a line of its own: the folios it still wanted,
and the minutes it then took at this pace.

The player is one careful, ordinary player. Everything it decides by is at the top of `pace.ts`:

- **The order of goals**: nodes in `NODES` order, the first not done that may be taken, so that a
  node waiting on research lets the next go first. Research: what the nodes of the tiers open need
  first, each piece after what it needs (`researchOrder`), then `RESEARCH`; each goes in the line as
  soon as it may be studied, the line kept full, and what may now be studied sooner than what stands
  in the line is moved ahead of it (what it had been given stays given).
- **Lines.** For the node in hand it asks the planner for the lines that would bring each thing it
  still wants in the tier's minutes (`MINUTES`; a tier past the last given takes the last), less what
  standing lines already bring the depot (`pace/needs.ts`), and builds those. Every line ends in the
  depot or a Study. Once the splitter is unlocked, a machine's part is split off a standing line of it
  where one has enough to spare; otherwise it gets a line of its own straight in (`pace/builder.ts`,
  which works each line out on a copy of the yard, with the router, before the player builds it).
- **Blocks, where greedy placing runs out.** A line that will not fit greedily is planned as a block:
  its last machine where belts from free deposits of everything it needs (or from a standing line of
  a part it may split) are shortest, measured as a belt goes, round what stands and under it by
  tunnel; each machine against the side of the one it feeds, handing its things straight in, a part
  split off a standing line first; only the gatherers' belts and the way home laid by the router. A
  Study stands against its block's last machine; a block into the depot goes home by one belt, or
  into a cart stop where one may stand.
- **Taking up old lines.** A line the player cannot do without (nothing standing brings its thing)
  that fits nowhere, not even on a plot bought for it, is worked out as a block on a copy with every
  old line taken up: those built for goals now finished, that nothing still in use draws from, whose
  thing the goal in hand does not want, keeping off their ground where it can. Then the old lines in
  its way are taken up one at a time, nearest first, and the block tried again with the rest still
  standing to be split; a belt of a kept line that one of them had set a splitter on is laid again.
  Taking a line up is a Select drawn over its pieces and cleared; their Coins come back. Pylons stay.
  Failing that, the line is laid as its parts first, each a line into the depot with twice what the
  line takes of it, and then the most of the line that fits, split off them; failing that, at half
  the pace and half again, down to one a minute, and the player waits the longer.
- **What it believes standing lines bring** is what it reads off the yard once its new lines have
  filled (`pace/measure.ts`: a copy run on three minutes, then read over five), as a player reads the
  pace on the page; while that is short of the pace the goal wants, it builds again, up to three
  times. The builder's own booking of a split (half of what the line has left) is only its estimate
  for choosing where to split; a split laid above an earlier one takes half of all that passes and
  leaves the earlier one less, and what is read says so.
- **Research**: once the Study is unlocked, for each kind of folio that may be made and that research
  of an open tier wants, Studies and their folio lines for `FOLIOS` a minute of it.
- **Policy**: new pieces at the highest grade unlocked up to `GRADES` (a splitter at its belts'); after a goal's lines, a boiler
  (or a waterwheel, when short by no more than one gives, and the other where one will not fit)
  whenever the yard would draw more than it gives; a plot only when the land has too little of what a
  line gathers or no room for it; any filled order handed over, and an order that would take more
  than `SWAP` minutes swapped when a swap is free; never building for an order. The till is collected
  once a minute, as the page does. It starts with `PURSE` Coins.
- **A person's time** (`HANDS`): seconds for each piece set down, each run of belt and each tile of it
  (taking a line up counts as such a run over its pieces), each plot bought, each line worked out,
  each node or piece of research read, each order handed over and each piece of research moved in
  the line.

What it does not do, so that a real player may be faster or slower: it lays tiers 0 to 2 out
greedily, each line fitted into what is left, which walls the free deposits of the yard's plot into
pockets by tier 3; it never moves a piece, and takes up only whole old lines, only when nothing else
will do; it does not raise standing pieces to a higher grade; it builds for the node in hand only
(not the commission's lines while the research it waits on is studied); it uses no crate, sorter,
Paint or blueprint, and a cart stop only for a block with no way home.

## Keeping a yard

`encode` writes a JSON record of the yard's numbers, goals and orders, with its pieces packed into
bytes (`cells`, in base64) and each blueprint the same. The pieces' bytes begin with how many there
are; a piece is a few bytes: the gap since the last piece, its kind and way and whether it carries
something, the thing and its progress, then only the parts that are not as new (its grade among
them, when above 1). A blueprint's piece is its kind, x, y and way, then only the parts it keeps.
A splitter's ways are one byte wherever they are kept (`packWays`): its shut ways a bit each, and 8
times 1 + the way it puts first, so a yard kept before there was a way first reads back with none.
A yard kept by version 6, before splitters, joiners and sorters had grades, kept them with none:
each in the yard reads back at the highest grade the yard may build of its kind, for nothing, so no
line goes slower than it went; each in a blueprint, at the highest grade of the belts and tunnels
kept with it. Kept again, the yard is this version's.

`decode` reads shape-first. It refuses whole a record of the wrong shape or version, and pieces'
bytes cut short, left over, with a part it does not know, more pieces than the land has tiles, or a
count no yard could have; nothing else. A record kept while the rules still counted a pace has a
`pace` field, which is passed over: it reads back as the same yard, with the same check, and is
kept again without it. Inside a good one, what depends on today's tuning is clamped or carried,
never a reason to refuse the yard, and nothing a player has is lost (`vouch`):

- the goals done, in their order, each that today's tables have, whatever opens it today; the node
  in hand, the nodes in line after it (none in a yard kept before there was a line) and the line of
  research only where each could be taken up now;
- what each goal not done was given, given again through `giveGoal`, so that one given all it wants
  is finished as in play (it pays, and Leaf logs it);
- the plots owned that the land has; each order with the tick it counts from, no later than one hung
  now would, and an id past the one before it and below the count of orders ever hung (`serial`),
  however many the board holds today; one that does not count yet holds nothing;
- each piece built again through `build`, at the grade it was kept at, or where the yard may not
  build that one, at the highest it may (the difference paid back into the till); one that cannot
  stand at all is paid back at today's price for its grade, and one of the pieces to hand goes back
  to hand; its colour as kept; what it is set to, holds, makes and has made only as `locked` lets the
  yard (and a way put first only where it lets one, and only an open way), a machine no more than it
  keeps; work only toward what is being made, below what that takes; a Study's work and folio only
  while the research they were for is still first in the line;
- each blueprint as kept, whatever it holds: the rules say whether it may be set down when it is. A
  plan of the whole yard is kept as `{ "whole": ... }` among them, its pieces on their own tiles.

`test/saves/` holds yards as each version kept them (7, 6 and the first design's 3), written once;
`test/saves.test.ts` holds each to reading, with what it read when it was kept.

`check` is one pass over the yard into 32 bits, for Leaf and the page to compare their copies:
everything `decode` keeps of the rules' state, each number that may pass 32 bits by both its halves.
It leaves out what only Leaf holds and moves (the seed, `serial`, the orders that do not count yet,
its clock's moment, the letter), news, what is worked out again (what is open, power, the plumbing,
a machine's idle note) and which row of a side table holds a piece's parts; a yard read back gives
the same check. `test/codec.test.ts` changes every other part of a yard in turn, and fails on one
added unmixed.

## Budgets

Held by `test/budgets.test.ts`, at about 6,000 pieces on 112 by 84 tiles (the scale study's
generator, `test/gen.ts`, building with commands, every goal of tiers 0 to 3 done) unless said:

- memory, every array a yard reaches but its land: under 400 KB; a yard of nothing but crates, as
  many as the land holds: under 1 MB;
- kept: packed, three full blueprints included, under 40 KB; as the store keeps it, UTF-8 text,
  under 56 KB;
- allocation: a tick of a yard whose plumbing is worked out, in which no order is filled, allocates
  nothing (no collection in a thousand ticks, and no byte, on the generated yard and on a yard
  delivering to the depot); and nothing the tick calls, in any file, makes an array, object,
  closure, string or iterator, but the plumbing worked out again and a goal finished or an order
  filled (`test/calls.ts`);
- work: a tick reads as many numbers for the same pieces on maps of two sizes;
- time: the median tick under 2 ms.

Measured beside them and printed: the first tick after a change, and a tick that fills an order.

## The tests

One file for each part: whole numbers, counted recipes (and those of tiers 0 and 1, in yards of those
tiers), grades, tiers and tools, research, the new pieces and blueprints, orders, the tables held together (every goal reachable, nothing wanted before it can be made, every
folio cost payable by its tier, ids unique), the planner (and that a yard does what it says), what a
yard as it stands can make and needs (`flow`), the codec and the check, random play (a refusal changes nothing, a yard reads back as itself, every
command and piece takes effect, what the page would write reads back as the command) and time away,
how a piece stands (`condition`), the wire from the page's side, the staged yards, the budgets, the
record of the tick (`test/replays.ts`: every staged yard, every save, the delivering, generated and
junctions yards, random play and the largest yard tended in slices, each run on for hours with the
kept yard digested every tick of its first minute and every minute after, and held to
`replays.json`, which the tick before any change to how fast it runs wrote), a yard kept between
ticks against the same yard read afresh, tick for tick (`test/fresh.test.ts`), and
the pace script's parts (`test/pace.test.ts`: sizing lines, which lines a goal needs beyond what
stands, that a line laid out delivers what it is booked for, that a line that fits nowhere takes up
only the old line in its way, that what the player reads off the yard is what arrives, the order it
studies research and turns to nodes in, that a play repeats to the tick, and what the table makes of
one play and of several). `test/goals.ts` reads from the tables the goals a test needs (the research with nothing
needed first, what a node wants and pays, a commission's needs), so that no test names a count from
the tables and changing one breaks none. `test/yards.ts` builds the
yards they share with commands off the wire, and the yards the play server on a developer's machine
stages for the tours (`staged`: `new`, `small`, `short`, `mid`, `hall`, `study`, `gate`, `large`), which the package exports as
`@sequoia-leaf/factory/test/yards.ts`. A stage is a yard the rules could have made: built by
commands, every goal finished, paid and logged by the rules, by lines of its own or by what the node
in hand wants arriving at the depot through `deliver` (`fillHand`). Research is studied in a Study,
not delivered: `hall` is tier 3 just open, with no Study; `study` adds a line of Timber folios into a
Study and runs it until the first piece of research is known by the Study's own work, with the line
of research filled after it. `gate` runs that yard on until its Study has made known what tier 3's
commission needs, each alone in the line, and the commission is finished: tier 4 has just opened,
with a splitter on the ingots' line to the tools' bench. `large` is the generator's pieces on a
yard with every node of tiers 0 to 2 done, building only what such a yard may, and knows no
research.

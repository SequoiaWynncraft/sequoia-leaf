# The Works, second design

The rules of the second Works, on flat data: numbers in typed arrays and a few small records,
nothing for each piece and no string for each thing. Tiers 0 to 3 are whole: nodes (lessons,
projects and commissions), research and the Study, counted recipes, grades, the sorter and the cart
stop. Nothing serves or draws it yet.

## What to read for which kind of work

| To work on                                                                    | Read                                                                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| what things, machines, grades, recipes, plots, nodes, research and askers are | `src/content/*.ts` (data only)                                                |
| how a name becomes a number; what is open once some goals are done; `locked`  | `src/tables.ts`                                                               |
| what a yard holds, and its side tables                                        | `src/yard.ts`, then `src/land.ts`                                             |
| one tick                                                                      | `src/tick.ts`, `src/wire.ts` (who hands to whom), `src/power.ts`              |
| building, raising, removing, turning, setting pieces, plots                   | `src/build.ts`; many pieces at once: `src/pieces.ts`; colours: `src/lines.ts` |
| the node in hand, the line of research, the board                             | `src/orders.ts`, `src/clock.ts`                                               |
| Leaf's game: commands, Coins, time, the view and the answer                   | `src/game.ts`                                                                 |
| keeping a yard, and the check                                                 | `src/codec.ts`, `src/bytes.ts`, `src/check.ts`                                |
| the route for a run of belt; what a piece is doing                            | `src/route.ts`; `src/status.ts`                                               |
| what a machine or a line makes and needs a minute                             | `src/planner.ts`, and `plan.ts` for the table of the slice                    |
| what it costs                                                                 | `bench.ts`, and `test/budgets.test.ts` for the budgets                        |

```sh
bun test       # every rule, the tables and the budgets (about 15 seconds)
bun bench.ts   # times and sizes of generated yards of about 6,000 and 10,000 pieces
bun plan.ts    # the planner's table for every thing the slice can make
```

## The yard

A tile is `y * w + x`. Every array below is indexed by the tile, and holds `NONE` (255) for
nothing:

| Array   | Type  | What it holds                                                                   |
| ------- | ----- | ------------------------------------------------------------------------------- |
| `kind`  | Uint8 | what stands there                                                               |
| `dir`   | Uint8 | the way it faces: 0 east, 1 south, 2 west, 3 north                              |
| `grade` | Uint8 | its grade, 1 to 3, for a belt, tunnel, gatherer, mill, bench, workshop or Study |
| `item`  | Uint8 | what a belt, splitter, joiner, sorter or tunnel mouth carries                   |
| `prog`  | Uint8 | how far across its tile, in eighths                                             |
| `via`   | Uint8 | the side it was handed in from, 1 + a way, or 0 (only for drawing)              |
| `tint`  | Uint8 | a line's colour, 0 to 6                                                         |
| `turn`  | Uint8 | a splitter's next way out, a joiner's next way in                               |
| `shut`  | Uint8 | a splitter's shut ways, a bit each                                              |
| `set`   | Uint8 | the one thing a machine is told to make, or a sorter sends to its left          |
| `free`  | Uint8 | 1 for one of the pieces a new yard has to hand                                  |
| `span`  | Int8  | a tunnel's tiles under: positive at the way-in mouth, negative at the other     |
| `row`   | Int32 | the piece's row in a side table, or -1                                          |
| `lit`   | Uint8 | 1 where power reaches                                                           |

Side tables have a row for each piece that needs one, kept packed (a removed row takes the last),
and grow by half when full:

- **holders**, for gatherers, mills, benches, workshops, crates, boilers and Studies: `out`,
  `making` (things, Uint8), `work` (Uint16, half-ticks), `idle`, `open`, `fuel`, `kinds` (Uint8),
  `count` (Uint16), and `stock`, how many of each thing (Uint16, 25 a row);
- **tunnels**, for each way-in mouth: `under` (thing, Uint8) and `along` (eighths, Uint8), three a row;
- **blueprints**: each one's pieces as 10 bytes a piece (kept in fewer, below).

The plumbing (`wire`) is worked out once after a change: four lists of tiles, sized by what
stands (the order things are handed on in, the tiles that carry, the pieces that work, the boilers
in reach), for each tile the sides it takes things in from, a bit each, and for each kind of machine
the recipes it may make. A tick runs down those lists and nothing else, and makes nothing.

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
- **Belts** move `PACE[grade]` eighths of a tile a tick: a tile in 4, 3 or 2 ticks. A splitter,
  joiner or sorter, which has no grade, moves at grade 3's pace.
- **Power** is counted in halves: a piece draws its kind's power once for each half its grade draws
  (2, 3, 4), and the depot, waterwheels and boilers give 2 halves for each power.
- **A shortage of power** is a store (`charge`). Each tick the power there is goes into it, and when
  it holds all that is drawn it is spent and every gatherer, machine and Study works that tick; when
  it does not, none does. With 5 power of every 8 drawn they work 5 ticks in 8, exactly; what is left
  over carries to the next tick and is kept with the yard. A yard with power enough works every tick
  and keeps nothing in the store.
- **Reach** is in hundredths of a tile (`REACH`: a pylon 460), made longer by a whole percentage
  (`open.reach`: 100, 135 with "Taller pylons"), and read as a whole squared distance: a tile is in
  reach when the square of its distance is no more than the reach squared, rounded down.
- **The pace** of what reaches the depot counts whole ticks, and halves them, rounded down, each hour.

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

A belt, tunnel, gatherer, mill, bench, workshop and Study each have a grade, 1 to 3, kept on the
piece; grade 2 works 1.5 times as fast, costs 3 times as much and draws 1.5 times the power; grade
3, twice, 8 times and twice (`GRADES`). `open.kinds[k]` is the highest grade of a kind the yard may
build, 0 for a kind not unlocked.

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
  stays given. When the node in hand is finished, or a goal is finished while nothing is in hand,
  the next lesson comes into hand, else the commission of the highest tier open if it is ready, else
  nothing. Tier 3's commission needs the oil press and the workshop known.
- **Research** is studied in a line of up to 4 (`study`, `unstudy`); the first is being studied. A
  Study holding a folio the research still wants works on it as a machine works (100 half-ticks at
  its grade's pace, so one every 50 ticks at grade 1), and then puts it toward the research. One the
  research has stopped wanting meanwhile stays in the Study, as does any folio the research does not
  want. A Study's work belongs to the research first in the line: when another comes first (one taken
  out, or known), every Study's work is dropped; tipping out a folio drops it only if it is the one
  being worked on. Known, the research unlocks, and the next in line begins.
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
  (Paint); `move`, `clear`, `stand`, `placeBlueprint` (Select); `saveBlueprint` (any blueprints);
  `upgrade` (Upgrading an area, and Select). A single piece (`build`) and a run of belt (`lay`) never
  are.
- **A run of belt** (`lay`) reads only belts and tunnels: where each leg goes, which way, how far
  and at what grade. A leg of any other kind does not read; a colour or a setting on one is let be.
  A run that names a tunnel twice, by both its mouths, is refused before anything changes, and a run
  is charged the price `priceOf` gives it.
- **Standing pieces** (`stand`) is for a copy or an undone removal, at most 160 a command; a colour
  in it needs Paint, and what a piece is set to its own unlock. A blueprint is set down by naming its
  place, its corner and its turns (`placeBlueprint`), all or none, whatever its size.

## Pieces new to this design

- **The Study** (`study`), one tile: takes folios in from any side, holds up to 20 of each kind, and
  draws 6 power at grade 1. Its work, and the folio it works on, are kept with the yard.
- **The cart stop** (`stop`): takes things in from any side, and each has reached the depot at once.
  A yard may stand as many as it has unlocked.
- **The sorter** (`sorter`): takes things in from behind; the one thing it is set to (`sort`) goes out
  to its left, everything else ahead. With nothing set it is a belt.

## Standing orders

A standing order is sized by the tier reached: 6,000 ticks of work and 3,000 more for each tier open
beyond the first, shared out between one or two things as `fresh` draws them. Only Leaf, holding the
seed, can draw one. It counts from 50 ticks after it is hung (`starts`): until then the depot gives
it nothing, it cannot be handed over (`claim`), and the check leaves it out. A fresh order is hung at
the end of the board. What Leaf answers a batch with (`answer`) is the yard's tick, its check, and the
orders hung that do not count yet. `answer` is not yet a part of `FACTORY`: core on this branch has
no place for it; it joins when the branch takes in `main`.

## The planner

`planner.ts` reads only the tables: what a piece of a kind and grade makes a minute (`makes`), what a
machine needs of each part a minute (`needs`), how many of the piece before it each part takes
(`feeders`), the whole tree of machines and gatherers for a thing at a pace (`tree`) and what that
tree takes of each piece (`bill`). Every piece is taken as working every tick. `plan.ts` prints, for
every thing the slice can make, one machine's output a minute and the line that feeds one flat out.

## Keeping a yard

`encode` writes a JSON record of the yard's numbers, goals and orders, with its pieces packed into
bytes (`cells`, in base64) and each blueprint the same. The pieces' bytes begin with how many there
are; a piece is a few bytes: the gap since the last piece, its kind and way and whether it carries
something, the thing and its progress, then only the parts that are not as new (its grade among
them, when above 1). A blueprint's piece is its kind, x, y and way, then only the parts it keeps.

`decode` refuses whole a record of the wrong shape or version, and pieces' bytes cut short, left
over, with a part it does not know or with a count past what the tables allow. Inside a good one it
gives back a yard play could have made (`vouch`), doing again through the rules what play does, and
leaves out what it could not:

- the goals done, in their order, only where each could have been done then; the node in hand and
  the line of research only where each could be taken up;
- what each goal that could have been given anything was given, given again through `giveGoal`, so
  that one given all it wants is finished as in play (it pays, and Leaf logs it);
- each order only with the tick it counts from, no later than one hung now would; one that does not
  count yet holds nothing;
- each piece built again through `build`; what it is set to, its colour, what it holds, makes and has
  made only as `locked` lets the yard, a machine no more than it keeps; a Study's work and folio only
  while research it wants is being studied;
- each blueprint only in a place the yard has, holding pieces, grades and settings it may build.

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
folio cost payable by its tier, ids unique), the planner (and that a yard does what it says), the
codec and the check, random play (a refusal changes nothing, a yard reads back as itself, every
command and piece takes effect) and time away, and the budgets. `test/yards.ts` builds the yards
they share with commands off the wire.

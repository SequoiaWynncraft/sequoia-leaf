# The Works

The yard behind the guild's workshop: the building with the chimney in Guild Town, and where Coins
come from. Gatherers pick things up off the forest floor, belts carry them, machines make goods of
them, and the depot in the middle takes everything in. The guild's raid parties, the Treasury, the
crab pond, the town's own and the guild's creatures ask for things, and the yard makes them. Nothing here fells a living
tree: wood is deadfall.

The game is in two parts. `src/sim/` is the rules, with no screen in them: plain data and plain
functions, tested. Everything else in `src/` is the screen: the yard drawn in the town's pixel art,
and an interface for building it with a mouse or a finger.

```sh
bun run dev                      # with hot reload
bun run build                    # dist/
bun test                         # the rules, and the teaching
bun review/balance.ts            # plays the whole story by script and prints the pacing
bun review/balance.ts --yards    # the same, and keeps a few yards part-way through in src/yards/
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
everything out of the member's purse, and pays the till into it.

**Saving.** `save(w)` is JSON with a version (2). `load(text)` gives back a yard it can vouch for or
nothing: a record of the wrong shape or version is refused whole, and inside a good one any plot,
plan or building that could not have come about by playing is left out. The first yard, before
this one, was a different map with different machines, so its saves are not read as yards;
`oldCoins(text)` finds the Coins in one so a screen can carry them over.

## What the town can read

- `w.given`: how many of each thing have gone to orders, ever.
- `townGifts(w)`: what finished story orders have left in town, oldest first, each with an id and a
  line to show (`tree-lanterns`: "Lanterns from the Works hang in the great tree.").
- `runTo` gives the `Away`, and `awayLine(away)` puts it in a sentence: "While you were away the
  Works made 340 Coins and finished "Lanterns for the great tree"."
- `postcard(w)` is what the page leaves for the town (the kit's `postcard.ts`) whenever it changes
  and when the town closes it: what is waiting in the yard, the capstones ever made, the till.

On the guild's own server the page first awaits the kit's `start()` and pulls its saves (the
`purse` and `works` slots, and `town` too when opened on its own), shows the second shift's button
closed, and says the member is at the Works; the kit's README says how.

## The screen

**The picture.** The yard is drawn the way the town is: small, one art pixel to a pixel, sixteen to
a tile, then blown up to the screen by a whole number (the same number the town would use in the
same window, so a tile here is as big as a tile there). All of the art is drawn in code when the
page opens, from the kit's palette: `art/ground.ts` paints the floor a pixel at a time, once as the
yard keeps it and once as the forest left it, and the frame shows the first wherever the yard owns
the land; `art/machines.ts` builds every machine in every pose its work puts it in; `art/belts.ts`
makes a belt tile out of arms, one to each side it joins, with slats that march the way things
travel; `art/items.ts` types out the twenty-three things as tiny pictures.

Dusk is laid over the picture and the lamps cut holes in it, as in the town. Here the lamplight is
also the power: the depot's lamps and every joined pylon's light the ground exactly as far as power
reaches, and burn low together when the yard is short of it. Kilns, boilers and workshop windows
add their own small pools.

A frame draws the floor, then the belts and what rides on them, then everything that stands up,
far to near (machines, the depot, redwoods, the fence and gate, undergrowth on land not yet bought,
whoever is walking about), then the lines between pylons, the dusk, and last whatever is being
pointed at or is about to be built. Only tiles on screen are looked at; every sprite is made once
and kept; what is worked out from the yard's layout (belt shapes, lines, fences, signposts) is
worked out once for each change to the yard (`layout.ts`).

**What things look like.** A gatherer is a gnome who bends and lifts, and sits down asleep when no
power reaches him. A mill shows the face of its work: a saw, a kiln or a press. A machine in
trouble that has lasted wears a mark over its head, and so does a belt whose load has nowhere to
go. Plans change how things look as well as how they run: gatherers get rakes and then barrows,
second- and third-tier machines wear brass, belts are waxed and then turn to rollers, pylons grow,
crates grow, the depot gains a flywheel. The depot is the back of the workshop the town sees from
the front: the same planks, stone foot, chimney and brass wheel.

**Building.** With a mouse: pick a tool (the dock, or a number key) and a ghost of it follows the
pointer, with corners in gold where it can go and in coral, with the reason, where it cannot;
click to set it down. A drag with the belt lays a run that follows the pointer and is shown before
the button is let go; a run that ends beside the depot turns to face it. `R` turns, `E` is the
spade, a right-click takes away, `Q` takes up the tool from the thing pointed at, `Z` undoes, `Esc`
puts away. With nothing in hand a drag moves the view, the wheel zooms, and a click asks about a
thing. With a finger, dragging always moves the view and two fingers zoom, so nothing is built by
accident: a tap aims, and a second tap or the Build button builds. A belt is laid from two taps,
start and end, with the router's run shown before it is laid; tapping a machine to start from
begins the run where that machine hands things on.

**Asking.** Everything in the yard is a card in the kit's one card system (`card.ts`, registered
in `ui/card.ts`): resting the mouse on a thing shows its card, clicking pins it, and a tap (or a
finger kept on it, with a tool in hand) pins it as a sheet along the bottom, with the yard moved
so the thing stays in view above it. A thing named inside a card opens its own card in its place,
with a back arrow.

- _A thing_ (in an order's lines, the depot's books, a machine's recipes, riding a belt, lying in
  the ground): its step, what it is made from and in which machine and how long one takes, what
  it goes into, what orders and the depot pay for one, and the orders on the board still asking
  for it with how many they are owed. One from the ground says where it comes from instead, and
  which plots have it.
- _A machine_ (in the dock, a plan, a recipe): what it does, what it can make, its draw, pace,
  price and key. One standing in the yard adds what it is doing and holds, and what can be done:
  pin a recipe, tip out, shut a crate, turn, take up another, take away.
- _A plot, a plan, an order_: what it holds, changes or wants, every thing and machine in it a
  thing. Land that is not the yard's is a plot's card, and sells itself from it.

The orders panel's lines, the depot's books and the plans tree are built from the kit's `thing`.

**The yard's books.** Always in view: the purse, power as drawn and given with a bar, and the
order in hand. Four panels: the orders (the story's, and the board's standing orders with swap and
hand over), the plans as the small tree they are, what the depot has taken in and what the yard
makes an hour, and the second shift. The power plaque opens a fifth, which says where the power
comes from and where it goes.

**Moments.** A story order filled: the yard's own gnome carries a crate out of the depot and
through the gate, Coins fly to the purse, and a notice says what was paid, what it opened and what
is asked for next. A standing order filled: a gnome waddles to the gate and waits (Pipwick in his
blue hat for his own orders, one of the town's gnomes for anybody else's, saying whom it is for);
handing over (from the panel, or by tapping him) sends the crate across, pays, and he carries it
off over his head. Whoever walks about the yard is one of the yard's gnomes (`actors.ts`), drawn
from the gatherer's pictures with a two-step waddle. A plot bought: the
cleared ground opens out from its signpost and the undergrowth falls away. A second shift: the
bell, a green pennant on the depot's roof, and the depot shines green while it lasts. Coming back
after five minutes or more: a letter on paper says what the yard did, and pays the till into the
purse as it is put away.

**Teaching.** `teach.ts` looks at the yard and says what the next small thing to try is, and where:
the first gatherer, the mill, the belt, the first planks arriving, a pylon towards the ore, a
bench. After that it speaks up once each for the board, a shortage of power, and a jammed machine.
It has no screen in it and is tested.

**Keeping.** The yard is kept in the browser (`works.save.v2`) a moment after every change, every
few seconds, and when the page is put away or the town says it is closing. The Coins are the kit's
one purse. `?fresh` in the address starts the yard over, once.

**In the town.** Inside the town's frame the page says `ready` once it has drawn, `leave` from the
doorway button in the corner, and `news` when a story order is filled or the first Beacon or
clockwork crab is made. Opened alone it plays just the same.

## How it is put together

| File                              | What it holds                                                               |
| --------------------------------- | --------------------------------------------------------------------------- |
| `sim/index.ts`                    | everything a screen needs from the rules, in one import                     |
| `sim/content/*.ts`                | the tables: things, recipes, machines, plots, plans, the story, the shift   |
| `sim/land.ts`, `sim/world.ts`     | the ground put together from the plots; the yard as data                    |
| `sim/build.ts`                    | building, taking away, turning, tipping out; buying plots and plans         |
| `sim/power.ts`, `sim/step.ts`     | where power reaches; one tick of the yard                                   |
| `sim/orders.ts`, `sim/clock.ts`   | the depot, the story, the board; the wall clock and catching up             |
| `sim/route.ts`, `sim/save.ts`     | the shortest clear run for a belt; a yard as text, and back                 |
| `sim/status.ts`                   | what a thing is doing, in a sentence, and whether it is in trouble          |
| `main.ts`                         | the stage: opening the yard, the canvas, the loop, the handles for review   |
| `state.ts`                        | what the screen's parts share: the yard, the view, the tool in hand         |
| `yard.ts`                         | finding and keeping the yard, the clock, Coins to and from the purse        |
| `scene.ts`, `layout.ts`           | drawing a frame; what is worked out from the layout and kept                |
| `art/*.ts`                        | the art: ground, nature, belts, machines, things                            |
| `camera.ts`, `input.ts`           | where the member is looking; mouse, keys and fingers                        |
| `zoom.ts`                         | how far the view zooms, for the camera and for the zoom kept between visits |
| `tools.ts`                        | setting down, runs of belt, turning, taking away, undo, buying land, plans  |
| `teach.ts`                        | the next nudge, worked out from the yard                                    |
| `events.ts`, `actors.ts`, `fx.ts` | the yard's moments; who walks about; sparks, dust, smoke and rising words   |
| `sound.ts`                        | the yard's own sounds, and its working murmur                               |
| `ui/card.ts`                      | what every thing, machine, tile, plot, plan and order says, as kit cards    |
| `ui/*.ts`                         | the purse and notices, the top bar, the dock, panels, the letter            |
| `sheet.ts`, `sheets.ts`           | the art laid out with names: `?sheet=machines`, `?sheet=items`              |
| `yards/*.json`                    | yards kept part-way through the story, for looking at the game at a stage   |
| `review/balance.ts`               | the story played by script; pacing and payback tables                       |

A tick has three parts: power is reckoned, then gatherers gather and machines make and things on
belts move along their tile, then every tile hands on what it has finished with, each tile after
the tile it hands to, so a full belt moves as one. Who hands to whom, and in what order, depends
only on what stands where, so it is worked out once (`rewire`) and kept until the yard is changed.

## Driving the rules from a screen

```ts
import { build, claim, collect, create, drain, load, power, refusal, runTo, save } from "./sim/index.ts";

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

## Looking at it from outside

`window.works` has handles for taking pictures of the game and trying it by script. `stage(name)`
loads a yard: `"new"` (with a number, that many story orders already done), or one of the kept
yards `"small"`, `"short"`, `"mid"`, `"large"`. `hold(true)` stops the clock so that only `run(ticks)`
moves the yard and `skip(seconds)` the screen. `pick(tool)`, `aim(x, y)`, `tap(x, y)`, `drag(x0, y0,
x1, y1)` with `drop()`, `confirm()`, `build`, `remove`, `plot(id)` and `plan(id)` act as a member
would; `finger(true)` makes the screen behave as for a touch. `open(panel)`, `card(x, y)` and
`close()` show things; `look(x, y)` and `zoom(by)` move the view. `purse(coins, leaf)` sets the
purse, `boost(minutes)` starts a second shift, `away(hours)` pretends the member has been gone,
`fill(slot)` fills a standing order, `taught(ids)` says which lessons are already taken.
`page(x, y)` is where a tile is on the page, `rider(x, y)` what is riding a belt there, `where(kind)` where a kind of thing stands, `state()`
a summary, and `bench()` the milliseconds one tick and one frame take, averaged over a hundred.

The screenshot driver is the kit's (`packages/kit/tools/drive.ts`):

```sh
bun run build
bun ../../packages/kit/tools/drive.ts "http://works.test/?fresh" <out-dir> <steps.json> dist
```

## Pacing

`bun review/balance.ts` plays the story through on the real map: for each order it buys what the
order cannot be made without, builds one line for each thing asked for (found by trying layouts on
paper and keeping the tidiest that works), and runs the yard until the order is filled. It prints
what each thing is worth, how long each order takes, what the yard earns an hour, what the board
pays for tending it, what the quickening plans add to a line, and what each plot is for. `--map`
shows the yard after every order. Its player stands a waterwheel when the yard is a little short of
power and has a bank, and a boiler with a gatherer to feed it when it is a lot short.

As the tables stand, the first order is filled about three minutes in from an empty purse, the
fourth runs a little short of power (which is when the boiler's plan comes up), the Beacon at just
under three hours wants two waterwheels beside the boiler and the bigger flywheel, and the last
order is filled at about four and a quarter hours of play.

## Where the shape comes from

A factory that feeds the rest of the game, a depot everything is anchored on, power carried by
pylons and standing orders are the genre's. Nothing of any other game's content is here: the
things, the machines, the map, the numbers, the orders and the words are the guild's own.

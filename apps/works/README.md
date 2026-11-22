# The Works

The yard behind the guild's workshop: the building with the chimney in Guild Town, and where Coins
come from. Gatherers pick things up off the forest floor, belts carry them, machines make goods of
them, and the depot in the middle takes everything in. The guild's raid parties, the Treasury, the
crab pond, the town's own and the guild's creatures ask for things, and the yard makes them. Nothing here fells a living
tree: wood is deadfall.

The rules are the package `@sequoia-leaf/yard` (`packages/yard`), with a README of their own that
says what is in the yard and how it runs. Nothing in there touches the page. Everything here is the
screen: the yard drawn in the town's pixel art, and an interface for building it with a mouse or a
finger.

```sh
bun run dev                      # with hot reload
bun run build                    # dist/
bun test                         # the teaching, and the screen's own small questions
bun review/balance.ts            # plays the whole story by script and prints the pacing
bun review/balance.ts --yards    # the same, and keeps a few yards part-way through in packages/yard/src/yards/
```

## On the guild's server

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
| `review/balance.ts`               | the story played by script; pacing and payback tables                       |

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

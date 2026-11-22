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

## On Leaf

The yard is Leaf's: its clock, its till and its Coins (the root README's play service). The page
awaits the kit's `start()`, opens the yard from Leaf (`openPlay("works", …)`) and holds a copy of
it, a yard with no seed, so that it hangs no order of its own. Without a Leaf it shows the kit's
cards, as the battler does. It keeps nothing of the game in the browser; only `works.screen.v1`
(the lessons taken, the zoom) stays.

Everything the member does is done to the copy at once with the shared rules (`yard.ts`, `doNow`)
and sent with the tick the copy stood at; a command the rules refuse is said so and not sent. Each
frame, if Leaf has answered since the last, the copy becomes Leaf's yard with every command still
unanswered done again on top, each at its own tick; then the copy is run on to Leaf's tick now: the
tick Leaf last gave, and one for each tenth of a second since, never earlier than one already
shown. A copy more than a minute behind (a tab put away) is not run on: the page sends `collect`
and shows Leaf's yard when it comes. News (a story order done, an order filled) comes from the
copy's own stepping, and is not told again when the same ticks are stepped once more. Swapping,
handing over and buying a plan leave a place on the board empty until Leaf hangs the next order
there; a place the board would have filled sends `collect`, so Leaf does.

**Coins.** The number the Works shows, and what a price is checked against, is the purse's (Leaf's
ledger) and the whole Coins in the copy's till, as Leaf will count them. A command that changes
Coins shows what it expects at once (`heardCoins`), and the purse asks Leaf for the true number
after the answer (`refreshCoins`). The till is paid in (`collect`) once a minute while it holds a
whole Coin, when the letter about a time away is put away, and when the member leaves by the back
button. The second shift's button shows itself closed: it costs Leaf, which nothing in town spends
yet.

## The screen

**The picture.** The yard is drawn the way the town is: small, one art pixel to a pixel, sixteen to
a tile, then blown up to the screen by a whole number (the same number the town would use in the
same window, so a tile here is as big as a tile there). All of the art is drawn in code when the
page opens, from the kit's palette: `art/ground.ts` paints the floor a pixel at a time, once as the
yard keeps it and once as the forest left it, and the frame shows the first wherever the yard owns
the land; `art/machines.ts` builds every machine in every pose its work puts it in; `art/belts.ts`
makes a belt tile out of arms, one to each side it joins, with slats that march the way things
travel, and a bar across a way out that is shut; `art/items.ts` types out the twenty-three things as tiny pictures.

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
go. A splitter has a brass arrowhead on each way out that leads somewhere, and on a way that is shut
a short bar across that edge, red at its ends and pale in the middle, so that it is told from every
colour a line can be given. Plans change how things look as well as how they run: gatherers get rakes and then barrows,
second- and third-tier machines wear brass, belts are waxed and then turn to rollers, pylons grow,
crates grow, the depot gains a flywheel. The depot is the back of the workshop the town sees from
the front: the same planks, stone foot, chimney and brass wheel.

**Building.** With a mouse: pick a tool (the dock, or a number key) and a ghost of it follows the
pointer, with corners in gold where it can go and in coral, with the reason, where it cannot;
click to set it down. A drag with the belt lays a run that follows the pointer and is shown before
the button is let go; a run that ends beside the depot turns to face it. `R` turns, `E` is the
spade, a right-click takes away, `Q` takes up the tool from the thing pointed at, `Z` undoes, `Esc`
puts away. `C` is the brush (with an area marked, `C` copies it): with it in hand the line over the dock shows six colours and none, and
a click on a belt (or a drag across the yard) gives its whole line the one chosen. With nothing in hand a drag moves the view, the wheel zooms, and a click asks about a
thing. With a finger, dragging always moves the view and two fingers zoom, so nothing is built by
accident: a tap aims, and a second tap or the Build button builds. The click a browser makes after
a finger's tap on the yard is stopped, so the tap that opens a card presses nothing on it. A belt is laid from two taps,
start and end, with the router's run shown before it is laid; tapping a machine to start from
begins the run where that machine hands things on.

**Many pieces at once.** Select (the dock, or `F`) marks out an area: a drag with a mouse, two taps
on opposite corners with a finger. Every piece in it is lit gold on its tile with a gold line where
the marked pieces end, and the area itself is a line of dashes; a tunnel is in only with both its
mouths, and the depot never. The line over the dock then says how many pieces and what they cost,
with Move (`M`), Copy (`C`), Remove (`Del`) and Save. Move and Copy put the pieces in hand as one
ghost that follows the pointer, drawn as they would stand, belts joined to each other and to the
lines already there: gold over each piece that can go, coral over each that cannot, and the reason
for the first of those over it. `R` turns the whole of it. A click sets it down (a finger aims
with a tap, then Build), all of it or none, and it lands in a wave of dust out from the pointer.
Moved pieces stay marked where they now stand; a copy stays in hand for another. A moved, copied
or kept piece has the colour it had, and the ghost shows it. With nothing
marked the line shows the yard's three blueprints, each a small picture of its layout with its size
and its price now; pressing one puts it in hand as a copy is. Save asks which place, and a kept one
asks to be pressed again before it is replaced; a blueprint in hand has a bin, which asks too.
`Z` undoes a move, a copy or a removal as one step, and a splitter's way shut or opened.

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
  pin a recipe, tip out, shut a crate, turn, take up another, take away. A splitter's card has its
  three ways out round its picture, as they lie in the yard: each says Open, Shut, or No belt (open,
  with nothing to take from it), and a press shuts or opens it. A visitor sees them and has nothing
  to press.
- _A plot, a plan, an order_: what it holds, changes or wants, every thing and machine in it a
  thing. Land that is not the yard's is a plot's card, and sells itself from it.

The orders panel's lines, the depot's books and the plans tree are built from the kit's `thing`.

**The yard's books.** Always in view: the purse, power as drawn and given with a bar, and the
order in hand. Four panels: the orders (the story's, and the board's standing orders with swap and
hand over), the plans as the small tree they are, what the depot has taken in and what the yard
makes an hour, and the second shift. The power plaque opens a fifth, which says where the power
comes from and where it goes. "Top yards" (`ui/board.ts`) reads Leaf's board for the Works when it
opens and each minute while it is open: the twenty yards that have earned the most Coins, each
owner with their face and name as "Who is about" shows them (the kit's `faceFor`), and the
member's own row lit, or after a divider when they are not among the twenty.

**Moments.** A story order filled: the yard's own gnome carries a crate out of the depot and
through the gate, Coins fly to the purse, and a notice says what was paid, what it opened and what
is asked for next. A standing order filled: a gnome waddles to the gate and waits (Pipwick in his
blue hat for his own orders, one of the town's gnomes for anybody else's, saying whom it is for);
handing over (from the panel, or by tapping him) sends the crate across, pays, and he carries it
off over his head. Whoever walks about the yard is one of the yard's gnomes (`actors.ts`), drawn
from the gatherer's pictures with a two-step waddle. A plot bought: the
cleared ground opens out from its signpost and the undergrowth falls away. Coming back after five
minutes or more: Leaf's yard carries what it worked out while nobody watched (how long, and what
the till gained), a letter on paper says so, and putting it away pays the till into the purse.

**Teaching.** `teach.ts` looks at the yard and says what the next small thing to try is, and where:
the first gatherer, the mill, the belt, the first planks arriving, a pylon towards the ore, a
bench. After that it speaks up once each for the board, for Select when the yard first holds more
than 60 pieces, for a shortage of power, and for a jammed machine.
It has no screen in it and is tested.

**In the town.** Inside the town's frame the page says `ready` once it has drawn, `leave` from the
doorway button in the corner, and `news` when a story order is filled or the first Beacon or
clockwork crab is made. Opened alone it plays just the same.

## How it is put together

| File                              | What it holds                                                               |
| --------------------------------- | --------------------------------------------------------------------------- |
| `main.ts`                         | the stage: opening the yard, the canvas, the loop, the handles for review   |
| `state.ts`                        | what the screen's parts share: the yard, the view, the tool in hand         |
| `yard.ts`                         | the yard on Leaf: the copy, commands, each frame's catching up, the Coins   |
| `scene.ts`, `layout.ts`           | drawing a frame; what is worked out from the layout and kept                |
| `art/*.ts`                        | the art: ground, nature, belts, machines, things                            |
| `camera.ts`, `input.ts`           | where the member is looking; mouse, keys and fingers                        |
| `zoom.ts`                         | how far the view zooms, for the camera and for the zoom kept between visits |
| `tools.ts`                        | setting down, runs of belt, many pieces at once, undo, buying land, plans   |
| `teach.ts`                        | the next nudge, worked out from the yard                                    |
| `events.ts`, `actors.ts`, `fx.ts` | the yard's moments; who walks about; sparks, dust, smoke and rising words   |
| `sound.ts`                        | the yard's own sounds, and its working murmur                               |
| `ui/card.ts`                      | what every thing, machine, tile, plot, plan and order says, as kit cards    |
| `ui/*.ts`                         | the purse and notices, the top bar, the dock, panels, the letter            |
| `sheet.ts`, `sheets.ts`           | the art laid out with names: `?sheet=machines`, `?sheet=items`              |
| `review/balance.ts`               | the story played by script; pacing and payback tables                       |

## Looking at it from outside

`window.works` has handles for taking pictures of the game and trying it by script. `stage(...ops)`
stages a moment in the yard on the play server on this machine (`apps/api/test/play.ts`, through
`POST /test/play/works`) and takes it: `{ yard: "new" }` or one of the kept yards `"small"`,
`"short"`, `"mid"`, `"large"`; `{ away: minutes }`, a time nobody watched; `{ fill: n }`, the nth
standing order filled. `hold(true)` stops the screen running the yard on, `skip(seconds)` moves
only the screen, and `time(frames)` draws so many frames and says how many milliseconds each took. `pick(tool)`, `aim(x, y)`, `tap(x, y)`, `drag(x0, y0, x1, y1)` with `drop()`,
`confirm()`, `build`, `remove`, `plot(id)` and `plan(id)` act as a member would, sending to Leaf;
`finger(true)` makes the screen behave as for a touch, and `tap` is then a finger's tap, with Select
in hand too. `open(panel)`, `card(x, y)` and `close()`
show things; `look(x, y)` and `zoom(by)` move the view; `taught(ids)` says which lessons are already
taken. `page(x, y)` is where a tile is on the page, `rider(x, y)` what is riding a belt there,
`where(kind)` where a kind of thing stands, and `state()` a summary.

The screenshot driver is the kit's (`packages/kit/tools/drive.ts`), against the play server, signed
in as its Tester:

```sh
bun build index.html --outdir /tmp/play/works
bun ../api/test/play.ts 4000 /tmp/play &
bun ../../packages/kit/tools/drive.ts "http://127.0.0.1:4000/sign-in?return_to=http%3A%2F%2F127.0.0.1%3A4000%2Fplay%2Fworks%2F" <out-dir> <steps.json>
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

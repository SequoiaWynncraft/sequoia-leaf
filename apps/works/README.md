# The Works

The yard behind the guild's workshop: the building with the chimney in Guild Town, and where Coins
come from. Gatherers pick things up off the forest floor, belts carry them, machines make goods of
them, and the depot in the middle takes everything in. The guild's raid parties, the Treasury, the
crab pond, the town's own and the guild's creatures ask for things, and the yard makes them. Nothing here fells a living
tree: wood is deadfall.

The rules are the package `@sequoia-leaf/factory` (`packages/factory`), the second design, with a
README of their own that says what is in the yard, how it runs and what to read for which kind of
work. Nothing in there touches the page. Everything here is the screen: the yard drawn in the town's
pixel art, and an interface for building it with a mouse or a finger.

The page holds the rules' yard as it is: flat arrays, one number for each tile (`y.kind[i]`,
`y.dir[i]`) and side tables for what some pieces hold. It reads them where it draws and where it
decides, and makes no object for each piece or tile, keeps none and rebuilds none: what it works out
from the layout (`layout.ts`) and what it remembers of a piece between frames (`scene.ts`) are flat
arrays by tile too. Things, kinds, plots and goals are numbers throughout, as the rules number them;
names are used only on the wire (the rules write and read it: `writeCommand`, `readView`,
`readNotes`, `readAnswer`) and where art and words are looked up, once, into lists by number
(`art/items.ts`, `art/index.ts`, the rules' `ITEM_INFO` and `KIND_INFO`). The page shows tiers 0 and
1 as the first design did; every grade is drawn as the first. One list says which kinds the page
draws and builds (`DRAWN`, in `state.ts`), and the dock, the pick (`Q`) and the drawing read it: the
Study, the cart stop and the sorter, which no tier shown yet builds, are not on it, so each is a plain
post with nothing of a belt about it, and a card that says what it is. Nothing on the page writes to
its yard but the rules: pieces in hand are drawn from a yard that shares everything with the real
one but its own few arrays (`asIf`, in `layout.ts`), and the orders Leaf hung are put on the board
by the rules' `hear`. A side table's row is read only through the rules' `holderOf` and `tunnelOf`.

```sh
bun run dev                      # with hot reload
bun run build                    # dist/
bun test                         # the teaching, the yard on Leaf, and the screen's own small questions
```

## On Leaf

The yard is Leaf's: its clock, its till and its Coins (the root README's play service). The page
awaits the kit's `start()`, opens the yard from Leaf (`openPlay("works", …)`) and holds a copy of
it, a yard with no seed, so that it hangs no order of its own. Without a Leaf it shows the kit's
cards, as the battler does. It keeps nothing of the game in the browser; only `works.screen.v1`
(the lessons taken, the zoom) and `works.view.v1` (which view of the yard's sheet was last used) stay.

Everything the member does is done to the copy at once with the shared rules (`yard.ts`, `doNow`)
and sent with the tick the copy stood at; a command the rules refuse is said so and not sent. The
rules are asked there with the purse as it is at that moment, so whatever costs more Coins than there
are (a piece, a run, a copy, a blueprint, a put-back, a plot) is refused with their sentence however
long ago it was aimed: `doNow` is the one place a price is judged before it is sent. With
each command sent the page keeps the copy's tick and check just after it. Leaf answers a batch with
its clock, its yard's tick and check after it, and the orders it hung in the last minute, not the
yard (the rules' README; each order is passed over if the copy has it already). When Leaf did what the copy did, at the same tick, the checks are
compared; alike, the copy only puts on its board the orders Leaf hung that are new to it, each a
few seconds before it counts (ids only go up: one under the copy's `serial` it has had, and may
have swapped out or handed over since). Otherwise (checks that differ, a command Leaf turned down
or did at another tick, an order heard of after it began to count, a tab away over a minute, a yard
staged from outside) the page takes Leaf's yard. Meanwhile the yard takes no input, at one gate
(`gate`): as it begins, whatever the member had under way is put away, as `Esc` puts it away, and
no press, move, click, wheel or key goes past the window to the yard, the dock, the panels or the
letter (a press or key let go still passes, so nothing stays held); the copy stands still. What the
page had already handed to the kit goes to Leaf and is answered;
then it asks for Leaf's yard, and again every two seconds while that fails for a moment (what ends
the page at the opening ends it here too, with the same screens); the copy is then Leaf's yard.
Should that take more than a second, the line over the dock says the yard is catching up with the
guild's server. Checks that differ are a fault in the rules or the check: the page counts them
(`works.state().differences`) and tells Leaf the tick as it asks, and Leaf logs it, once a minute
at most. Each frame
the copy is run on to Leaf's tick now: the tick Leaf last gave, and one for each tenth of a second
since, never earlier than one already shown. A copy more than a minute behind (a tab put away) is
not run on: the page asks Leaf for its yard, which Leaf has run on meanwhile, and shows that when it
comes; away for less than five minutes, there is no letter. A copy standing still (its owner away eight hours) holds Leaf's tick
with it from the frame it stops in until the member acts, as Leaf does. News (a node finished, an order filled) comes from the
copy's own stepping, and is not told again when the same ticks are stepped once more. Swapping and
handing over leave a place on the board empty until Leaf's answer, with the next order, comes; a
place the board would have filled (when the board goes up) sends `collect`, so Leaf does. A new
order shows faint in the list until it counts.

**Coins.** The number the Works shows, and what a price is checked against, is the purse's (Leaf's
ledger) and the whole Coins in the copy's till, as Leaf will count them. A command that changes
Coins shows what it expects at once (`heardCoins`), and the purse asks Leaf for the true number
after the answer (`refreshCoins`). The till is paid in (`collect`) once a minute while it holds a
whole Coin, when the letter about a time away is put away, and when the member leaves by the back
button.

## The screen

**The picture.** The yard is drawn the way the town is: small, one art pixel to a pixel, sixteen to
a tile. The page shows that small canvas itself, and its styles enlarge each of its pixels to a
whole number of the screen's (the same number the town would use in the same window, so a tile here
is as big as a tile there), on a screen of any pixel ratio. The view zooms in three steps from that
size and out as far as one screen pixel for each of the yard's, where any screen shows the whole
map. Zoomed out past the forest there is only dusk, which is the page's own background, so the
picture is never bigger than the ground and the lamplight that falls past it. The words over the
yard (what someone says, a nudge, why a piece cannot go, what rises from a spot) are on a second
canvas the size of the screen, written again only when they change; every press on the yard lands
on it. All of the art is drawn in code when the
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
and kept; what is worked out from the yard's layout (belt shapes, lines, fences, signposts) is kept
by what it reads (`layout.ts`): what stands on each tile (kind, way, span, shut ways, colour), the
plots owned and the goals done, which say what is open. A change is counted in one place, `yard.ts`
(`S.rev`): a command done, a yard taken from Leaf, and a goal finished as the copy runs on. When it
has moved the layout compares the yard with what it was worked out from, so the till collected, an
order handed over or a node taken costs no layout, and Leaf's yard taken standing the same keeps it.
The lines between pylons are kept while the pylons power reaches are the same.

Most of a frame is what the last one showed, and a browser charges for each thing drawn, so
`scene.ts` keeps what stays and draws what moved:

- _The floor_ is one picture as big as the ground, painted again when a plot is cleared.
- _Belts_ of one shape, way and colour are one outline, and the tile for this step of the march
  fills all of them in one go. The splitters' arrowheads and the joiners' tops are laid the same way
  over what is carried.
- _What stands up_ is listed every frame as before, but drawn on a kept picture as big as the
  ground. Each tile's worth of it has a sum of what stands over it; where the sum is not last
  frame's (another pose, a step, something come or gone), that tile is wiped and the parts of the
  things over it are drawn again, far to near. A still yard draws nothing; a busy one, a few tiles.
- _The lines between pylons_ are kept as dark pixels and laid faint in one go. A line's glint is
  cut out of the kept line where it is now and put back where it was.
- _Pools of light_ are kept at each size they are laid down at, and not enlarged every frame.

What is carried, the dusk and the lights are drawn every frame. The kept pictures are made again if
the browser took their memory back, or when the page comes back from being put away.

**Zoomed far out.** A trouble mark is its own size down to a third of the natural size, where the
view used to stop, and is enlarged beyond that (`markSize` in `zoom.ts`), so that it is as big on
the screen as it was there.

**Further out still: the plan.** Past one screen pixel for each of the yard's the camera has two
steps more, 8 and then 4 screen pixels to a tile (`FAR`, in `zoom.ts`), and at those the frame is
not the picture but the yard's plan (`plan.ts`, laid by `far.ts`): no gnomes, nothing one by one on
the belts, no lantern light. A step is offered only while the plots the yard owns are not whole in
view, clear of the interface, at the step before (`farSteps`): a yard of one plot has neither, and
a window that shows the whole yard at 8 pixels a tile goes no further. The picture is then a screen
pixel to each of its own, the camera stands on whole screen pixels (`seenFrom`, in `state.ts`), and
a step in or out keeps the place under the pointer or the fingers where it is, as every other step
does. What is being pointed at or is about to be built is drawn over the plan as boxes of tiles
(the aim and why it cannot go, a run of belt, the area and the pieces marked with Select, the pieces
in hand, where power reaches), so building and Select work there as they do near.

**The plan** is the whole land in one picture at a whole number of pixels to a tile, painted from the
yard's arrays by one painter (`paintPlan`): the yard's ground, plots for sale (dim) and land not for
sale (dark), with the line where land changes hands; what lies in the ground, quietly, in each
thing's own colour; belts and tunnels as lines on a dark bed, with brass where a line parts or meets
and stone at a tunnel's mouth; machines and gatherers as blocks by kind, a pylon as a lamp; the
depot as its nine tiles with a pale line round them; and, laid over the picture, a square on each
cart stop and a diamond on each Study, larger than their tile. A line is the colour it was painted;
unpainted, the colour of the thing it carries; empty, wood. What a line carries is what was last
seen on each of its tiles, handed on down the line to tiles that have shown nothing yet and
forgotten a minute after it was last seen, so a line is one colour along its length and not a dot
for each thing on it (`plan.test.ts`). A plan keeps one number for each tile, everything that tile's
picture is painted from, and paints again only the tiles whose number has changed: when what stands
changes (`S.rev`) and once for each second of the yard's clock. It is used at 8 and 4 pixels for the
far steps and at 3 for the map, each kept only while it is shown.

**What things look like.** A gatherer is a gnome who bends and lifts, and sits down asleep when no
power reaches him. A mill shows the face of its work: a saw, a kiln or a press. A machine in
trouble that has lasted wears a mark over its head, and so does a belt whose load has nowhere to
go. A splitter has a brass arrowhead on each way out that leads somewhere, and on a way that is shut
a short bar across that edge, red at its ends and pale in the middle, so that it is told from every
colour a line can be given. Pylons grow once they reach further, crates once they hold more, and the
depot gains a flywheel once it gives more power. Every grade of a piece is drawn as the first, for
now (the art for grades, rakes and barrows, brass and rollers among it, is kept for that). The depot
is the back of the workshop the town sees from the front: the same planks, stone foot, chimney and
brass wheel.

**Building.** With a mouse: pick a tool (the dock, or a number key) and a ghost of it follows the
pointer, with corners in gold where it can go and in coral, with the reason, where it cannot;
click to set it down. A drag with the belt lays a run that follows the pointer and is shown before
the button is let go; a run that ends beside the depot turns to face it. What is aimed (the piece
and why it cannot go, its price, a tunnel's far mouth, a run, the pieces held with Select as they
would stand) is kept while the pointer stays on its tile, and worked out again for the same tile when
the yard or the Coins to hand change under it (`keepAim`, asked each frame and by each press): a key,
a card's button, an undo or Leaf's yard taken. `R` turns, `E` is the
spade, a right-click takes away, `Q` takes up the tool from the thing pointed at, `Z` undoes, `Esc`
puts away. `M` is the map (with an area marked, `M` moves it) and `I` what the yard makes and needs. `C` is the brush (with an area marked, `C` copies it): with it in hand the line over the dock shows six colours and none, and
a click on a belt (or a drag across the yard) gives its whole line the one chosen. With nothing in hand a drag moves the view, the wheel zooms, and a click asks about a
thing. With a finger, dragging always moves the view and two fingers zoom, so nothing is built by
accident: a tap aims, and a second tap or the Build button builds. The click a browser makes after
a finger's tap on the yard is stopped, so the tap that opens a card presses nothing on it. A belt is laid from two taps,
start and end, with the router's run shown before it is laid; tapping a piece to start from begins
the run on the tile ahead of it: where a machine hands things on, or a splitter's way ahead.

**Many pieces at once.** Select (the dock, or `F`) marks out an area: a drag with a mouse, two taps
on opposite corners with a finger. Every piece in it is lit gold on its tile with a gold line where
the marked pieces end, and the area itself is a line of dashes; a tunnel is in only with both its
mouths, and the depot never. The line over the dock then says how many pieces and what they cost,
with Move (`M`), Copy (`C`), Remove (`Del`) and Save. Move and Copy put the pieces in hand as one
ghost that follows the pointer, drawn as they would stand, belts joined to each other and to the
lines already there: gold over each piece that can go, coral over each that cannot, and the reason
for the first of those over it. `R` turns the whole of it. A click sets it down (a finger aims
with a tap, then Build), all of it or none, and it lands in a wave of dust out from the pointer.
A move, a copy and a blueprint each go to Leaf as one command, whatever their size: a copy sets down
what stands on the tiles it was taken up from, as the rules' `copy` does. Only putting back what was
taken away (`Z` after a removal) stands pieces, at most 160 to a command (all of it is checked first,
and each command is all or none).
Moved pieces stay marked where they now stand; a copy stays in hand for another. A moved, copied
or kept piece has the colour it had, and the ghost shows it. With nothing
marked the line shows the yard's blueprints, as many places as it has unlocked, each a small picture of its layout with its size
and its price now; pressing one puts it in hand as a copy is. Save asks which place, and a kept one
asks to be pressed again before it is replaced; a blueprint in hand has a bin, which asks too.
`Z` undoes a move, a copy or a removal as one step, and a splitter's way shut or opened.

**Asking.** Everything in the yard is a card in the kit's one card system (`card.ts`, registered
in `ui/card.ts`). A card is its print: what it shows of the yard and the purse, as plain values
(`ui/prints.ts`), drawn by `ui/cards.ts`, which reaches no yard (its buttons are the page's tools,
handed in). The card that is up is drawn again exactly when its print differs, so it shows nothing it
is not kept by; the panels and the top bar's parts are kept the same way (`shows`, in `ui/parts.ts`). Resting the mouse on a
thing shows its card, clicking pins it, and a tap (or a
finger kept on it, with a tool in hand) pins it as a sheet along the bottom, with the yard moved
so the thing stays in view above it. A thing named inside a card opens its own card in its place,
with a back arrow.

- _A thing_ (in an order's lines, the depot's books, a machine's recipes, riding a belt, lying in
  the ground): its step, what it is made from and in which machine and how long one takes, what
  it goes into, what orders and the depot pay for one, and the orders on the board still asking
  for it with how many they are owed. One from the ground says where it comes from instead, and
  which plots have it.
- _A machine_ (in the dock, a node's unlocks, a recipe): what it does, what it can make, its draw, pace,
  price and key. One standing in the yard adds what it is doing and holds, and what can be done:
  pin a recipe, tip out, shut a crate, turn, take up another, take away. A splitter's card has its
  three ways out round its picture, as they lie in the yard: each says Open, Shut, or No belt (open,
  with nothing to take from it), and a press shuts or opens it. A visitor sees them and has nothing
  to press. The depot's card says that each thing that arrives pays 1% of its worth, and its
  buttons open the orders, the projects, and what the yard makes and needs.
- _A plot, an order_: what it holds or wants, every thing and machine in it a thing. Land that is
  not the yard's is a plot's card, and sells itself from it.
- _A node_ (a lesson, a project or a commission; the node in hand is `order:story`): who asks and
  what they say, what it wants and has been given, what it unlocks, and for a project that may be
  taken, a button that takes it in hand.

The orders panel's lines, the depot's books and the projects are built from the kit's `thing`.

**The yard's books.** Always in view: the purse, power as drawn and given with a bar, and the
node in hand: its kind ("Lesson 2 of 4", "Tier 1 project", "Tier 1 commission"), who asks, and what
it wants and has been given. Lessons come into hand by themselves, and after the last of a tier its
commission. Panels: the orders (the node in hand, and the board's standing orders with swap and
hand over), the projects, and the yard's sheet (below), which is the depot's panel. The power
plaque opens one more, which says where the power comes from and where it goes. Projects, and its
button, are there only once tier 1 is open: it lists the projects and the commission that may be
taken up now, each with what it wants, what it has been given and what it unlocks, and a button that
takes it in hand (the one in hand is marked); a commission that is not ready yet, with what it still
needs; and then those done. "Top yards" (`ui/board.ts`) reads Leaf's board for the Works when it
opens and each minute while it is open: the twenty yards that have earned the most Coins, each
owner with their face and name as "Who is about" shows them (the kit's `faceFor`), and the
member's own row lit, or after a divider when they are not among the twenty.

**The yard's sheet** (`ui/views.ts`) is one panel with three views and a row to move between them,
for finding the way round a yard too large to see; it opens on the view last used. It is the right-hand
panel on a wide screen and a full sheet on a phone. In a yard of one plot it is the depot's panel
and nothing more: its third view alone, under the depot's button. With the second plot the button
becomes the yard's (a map), wears the count of pieces in trouble, and the sheet has all three. A
count sits on its button's corner and a longer one widens outward, past the corner, so it hides no
more of the picture; from three digits it is set small. On a phone the yard's button leads its row,
which ends at the screen's edge, so that its count has room there; the others' counts widen inward
there, so that the edge never cuts one.

- _Map._ The whole land as a plan at 3 pixels to a tile, a whole number of screen pixels to each of
  its own, with a mark fading and coming back on every piece in trouble, the part of the yard on
  screen as a frame, and its price on each plot for sale. A tap goes there; on a piece in trouble, or
  within a finger's reach of one, it goes to that piece and pins its card. On a phone the sheet
  closes; beside the yard it stays, and a drag moves the camera with it. A tap on land that is not
  the yard's opens the plot's card, as a tap on the land does.
- _Trouble._ Every piece in trouble in groups by what is wrong, the largest first, each with how
  many pieces and their kinds as pictures. What is wrong is the rules' own sentence for the piece
  (`status`) as far as its first stop: "Full of planks and waiting for ingots", "Nowhere to send its
  stone", "No power here", "Out of fuel". Over the groups, when power as a whole is short, one row
  with what is used, what is made and the speed that leaves. With nothing wrong: "Nothing is wrong."
  A tap on a group goes to its first piece and pins its card, and a bar stays while the member walks
  the group: what is wrong, which of how many, back, on, and a way out. On a phone the sheet gives
  way to the bar, under the top row; beside the yard the bar sits at the head of the panel.
- _Makes and needs._ A row for each thing the yard can make, needs, or has had reach the depot:
  what its pieces can make a minute and what they need a minute (the rules' `flow`, of what stands,
  kept for a second of the yard's clock), and what reached the depot in the last minute. What the
  yard needs more of than it can make is first, the largest shortfall first, its need in coral and
  "Short by 20" under its name. Under the things, the yard's totals as rows of numbers: Coins from
  orders, Coins from the depot, goals done of how many, side orders handed over.

**What reached the depot is counted** (`arrivals.ts`), not estimated. The depot's books are a running
total for each thing; the page keeps a ring of those totals, a row for each second of the yard's own
clock, and the last minute is the newest row less the row 600 ticks before it. It does not begin
again when the yard is changed, and needs no warm-up. For the first minute after the page opens (or
after a yard that ran on unseen is taken) it gives what it has seen as a minute's worth, and the view
says over how many seconds. A number a minute is whole from ten up and to one decimal under ten.

**Trouble** (`trouble.ts`) is the rules' to say (`condition`, which makes nothing): every tile is
asked once for each second of the yard's clock and when what stands changes, and not at all in a
yard of one plot unless a plan is up. A piece is listed once its trouble has lasted a second and a
half, and stays listed until it has been out of trouble for six seconds, so that a boiler that runs
out of fuel every few seconds is one steady line; a change to the yard drops at once whatever it
mended. The count, the marks on the map and the far steps, and the list are all that one look.

**A table of numbers** (`ui/table.ts`) is the one part that lays out rows with numbers beside them:
what a row is about at the left, taking the room there is, and each number in a column of one fixed
width, right-aligned under the column's name. Rows share the table's columns, so everything lines
up. It keeps its rows by key and writes a number again only where it differs, so a number that
changes each second moves nothing and loses no press. The third view's two tables, the row for
power and the list of trouble (whose rows are cards to press) are all it.

**Moments.** The node in hand filled: the yard's own gnome carries a crate out of the depot and
through the gate, Coins fly to the purse, and a notice says what was paid, what it unlocked (each
new piece, tool, recipe and plot for sale with what it is for), what it left in the town, and the
node now in hand. A standing order filled: a gnome waddles to the gate and waits (Pipwick in his
blue hat for his own orders, one of the town's gnomes for anybody else's, saying whom it is for);
handing over (from the panel, or by tapping him) sends the crate across, pays, and he carries it
off over his head. Whoever walks about the yard is one of the yard's gnomes (`actors.ts`), drawn
from the gatherer's pictures with a two-step waddle. A plot bought: the
cleared ground opens out from its signpost and the undergrowth falls away. Coming back after five
minutes or more: Leaf's yard carries what Leaf counted while its owner was away (how long it worked,
the Coins it earned, what the depot took in), and a letter on paper says so (the five things taken
in most, and the orders waiting to be handed over); putting it away pays the till into the purse.

**Teaching.** `teach.ts` looks at the yard and says what the next small thing to try is, and where,
keyed on the lesson in hand: the first gatherer, the mill, the belt, the first planks arriving (the
first lesson); a pylon towards the ore (the second); a bench (the third). After that it speaks up
once each for the board, for Select when the yard has it and first holds more than 60 pieces, for a
shortage of power, and for a jammed machine.
It has no screen in it and is tested.

**In the town.** Inside the town's frame the page says `ready` once it has drawn, `leave` from the
doorway button in the corner, and `news` when the node in hand is filled or the first Beacon or
clockwork crab is made. Opened alone it plays just the same.

## How it is put together

| File                              | What it holds                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `main.ts`                         | the stage: opening the yard, the canvas, the loop, the handles for review             |
| `state.ts`                        | what the screen's parts share: the yard, the view, the tool in hand                   |
| `yard.ts`                         | the yard on Leaf: the copy, commands, each frame's catching up, the Coins             |
| `scene.ts`, `layout.ts`           | drawing a frame; what is worked out from the layout and kept                          |
| `art/*.ts`                        | the art: ground, nature, belts, machines, things                                      |
| `camera.ts`, `input.ts`           | where the member is looking; mouse, keys and fingers                                  |
| `zoom.ts`                         | how far the view zooms, for the camera and for the zoom kept between visits           |
| `plan.ts`, `far.ts`               | the yard as a plan, kept and painted where it changed; a frame at the far steps       |
| `trouble.ts`                      | which pieces are in trouble, looked for once a second, and in groups by what is wrong |
| `arrivals.ts`, `flows.ts`         | what reached the depot in the last minute, counted; what the yard makes and needs     |
| `tools.ts`                        | setting down, runs of belt, many pieces at once, undo, land, taking a node            |
| `teach.ts`                        | the next nudge, worked out from the yard                                              |
| `events.ts`, `actors.ts`, `fx.ts` | the yard's moments; who walks about; sparks, dust, smoke and rising words             |
| `sound.ts`                        | the yard's own sounds, and its working murmur                                         |
| `ui/card.ts`                      | every thing, machine, tile, plot, node and order as a kit card, kept by print         |
| `ui/prints.ts`, `ui/cards.ts`     | what each card prints of the yard and the purse; each card drawn from that            |
| `ui/*.ts`                         | the purse and notices, the top bar, the dock, panels, the letter                      |
| `ui/views.ts`, `ui/table.ts`      | the yard's sheet (map, trouble, makes and needs); the one table of numbers            |
| `sheet.ts`, `sheets.ts`           | the art laid out with names: `?sheet=machines`, `?sheet=items`                        |
| `review/bench.ts`                 | the page with a generated yard of its own, for timing a frame of a large one          |

## Looking at it from outside

`window.works` has handles for taking pictures of the game and trying it by script. `stage(...ops)`
stages a moment in the yard on the play server on this machine (`apps/api/test/play.ts`, through
`POST /test/play/works`) and takes it: `{ yard: "new" }` or one of the yards the rules' test yards
build with commands (`staged` in `packages/factory/test/yards.ts`): `"small"` (the first two
lessons done), `"short"` (the last lesson in hand, short of power), `"mid"` (every node of tiers 0 and 1 done,
tier 2 open, the board up, plots bought, a painted line and a splitter), `"large"` (every node of
tiers 0 to 2 done, and the generator's pieces on every plot the slice sells); each a yard the rules
could have made, every goal finished and paid by them; `{ away: minutes }`, its owner away that long
and the yard run every tick meanwhile; `{ fill: n }`, the nth standing order filled; `{ feed: true }`,
what the node in hand still wants sent to the depot, so that Leaf finishes it as in play (the page
takes Leaf's yard after, so the moment is not shown); `{ text: "..." }`,
any yard as its kept text. A step within the same yard keeps the lessons taken. `hold(true)` stops the screen
running the yard on, and `hold(true, lead, at)` shows it `lead` of the way into its next tick with
the screen's clock at `at` seconds, so a picture can be taken twice the same; `skip(seconds)` moves
only the screen. `pick(tool)`, `aim(x, y)`, `tap(x, y)`, `drag(x0, y0, x1, y1)` with `drop()`,
`confirm()`, `build`, `remove` and `plot(id)` act as a member would, sending to Leaf, and `act(command)`
does any command as the wire has it, read as Leaf reads one (`readCommand`), through `doNow`
(`after(command)` does the same and then the frame after it, and says what each took, by part); kinds,
plots and commands go by their names here, as on the wire;
`finger(true)` makes the screen behave as for a touch, and `tap` is then a finger's tap, with Select
in hand too. `open(panel)`, `card(x, y)` and `close()`
show things; `look(x, y)` and `zoom(by)` move the view; `taught(ids)` says which lessons are already
taken. `page(x, y)` is where a tile is on the page, `rider(x, y)` what is riding a belt there,
`where(kind)` where a kind of thing stands, `trouble()` the tiles of the pieces in trouble as the
yard's sheet counts them, and `state()` a summary (among it the node in hand, the
goals done, the tier, `differences`, and `reads`, how many times the copy has become Leaf's yard as
read, the opening included).

**How long a frame takes.** `works.bench(frames, hz)` does that many frames' work one after another,
as if the screen showed `hz` of them a second (60 unless said), and gives back what one took:
`{ ms, picture, pieces }`. `ms` is milliseconds by part: `page` (the page's own bookkeeping, and the
yard's ticks), `floor`, `belts`, `standing`, `dusk`, `marks` (the parts of `drawYard`), `words`, and
`flush`: a browser may put off the drawing it was asked for, and `bench` takes the picture after
each frame to have it done and counted (the words' picture and the scaling to the screen are not in
it). At the two far steps the parts are `page`, `plan` (the plan brought up to date and laid),
`marks`, `words` and `flush`. It runs a copy of the yard on a clock of its own, so every run begins alike and the yard is as it
was afterwards. `picture` is the picture's size in the yard's pixels and
`pieces` how many pieces are on screen. Nothing is timed while nobody asks.

    works.zoom(-40); works.look(24, 18); works.bench(300)

A yard larger than the guild's land holds (the rules' generator at about 5,500 pieces on 7 by 7
plots) cannot come from Leaf. `review/bench.ts` hands the page one of its own and opens nothing from
Leaf (`S.alone`): it is the page's entry with that file in place of `src/main.ts`, built as
`sed 's#./src/main.ts#./review/bench.ts#' index.html > bench.html` and
`bun build bench.html --outdir <site>/works-bench`, and opened at
`/play/works-bench/bench.html?pieces=5500`. Commands there (`act`, `after`) are done to that yard by
the rules and sent nowhere, and its member has Coins enough for anything: `after` is what a tap costs
on it, a frame after a real command.

With `?meter` in the address, a corner of the page says, each second: the frames a second the
screen reaches, the longest frame, and the same parts as milliseconds a frame. There `until free`
is how long after a frame's work the page next gets a turn: the browser's own work on the frame,
and anything else it had waiting. The frames a second say how it looks; the parts say where the
page's own time goes. A browser shows no more frames a
second than the screen has, so the parts say how much room is left.

The screenshot driver is the kit's (`packages/kit/tools/drive.ts`), against the play server, signed
in as its Tester:

```sh
bun build index.html --outdir /tmp/play/works
bun ../api/test/play.ts 4000 /tmp/play &
bun ../../packages/kit/tools/drive.ts "http://127.0.0.1:4000/sign-in?return_to=http%3A%2F%2F127.0.0.1%3A4000%2Fplay%2Fworks%2F" <out-dir> <steps.json>
```

## Pacing

The second design is balanced with the rules' planner, not by playing the story through:
`bun plan.ts` in `packages/factory` prints, for every thing the slice can make, one machine's output a
minute and the line that feeds one flat out (the rules' README, "The planner").

## Where the shape comes from

A factory that feeds the rest of the game, a depot everything is anchored on, power carried by
pylons and standing orders are the genre's. Nothing of any other game's content is here: the
things, the machines, the map, the numbers, the orders and the words are the guild's own.

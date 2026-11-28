# The Works

The yard behind the guild's workshop: the building with the chimney in Guild Town, and where Coins
come from. Gatherers pick things up off the forest floor, belts carry them, machines make goods of
them, and the depot in the middle takes everything in. Nothing here fells a living tree: wood is
deadfall.

The rules are `@sequoia-leaf/factory` (`packages/factory`, with a README of its own). Everything here
is the screen: the yard drawn in the town's pixel art, and an interface for building it with a mouse
or a finger. Each module's header says what it does and why; this file says where to look, and what
must hold.

```sh
bun run dev                      # with hot reload
bun run build                    # dist/
bun test                         # the screen's own questions, the yard on a stand-in Leaf
```

## What to read for which work

| Work on                                     | Read                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| opening, the loop, the canvas               | `main.ts`                                                                          |
| the yard on Leaf: commands, catching up     | `yard.ts`, `sync.ts` (the link and the room as values), `test/fake-leaf.ts`        |
| a visit (`?of=<player>`)                    | `yard.ts` (`Follow`), `visit.test.ts`                                              |
| what is in hand, drags, Escape              | `hand.ts` (one value, one `step`), `tools.ts`, `input.ts`                          |
| building, runs, Select, blueprints, undo    | `tools.ts`, `undos.ts`; `doNow` (`yard.ts`) is the one place a price is judged     |
| the line over the dock, the dock            | `ui/dock.ts` (a print of the hand)                                                 |
| a kind of piece: picture, card, lamps, map  | `kinds/<kind>.ts` (one module a kind, listed in `kinds/index.ts`), `kinds/kind.ts` |
| a piece of more than one tile on the page   | `big.ts` (its box, drawn once from its own tile; its ways out; its marks)          |
| drawing a frame                             | `scene.ts` (`drawYard`, a layer at a time), `lamps.ts`, `layout.ts`, `art/*.ts`    |
| the graphics card, the ground on it         | `@sequoia-leaf/kit/painter.ts` (boxes, the atlas, sheets, layers), `floor.ts`      |
| the far steps and the map                   | `plan.ts`, `far.ts`, `zoom.ts`, `camera.ts`                                        |
| cards                                       | `ui/card.ts`, `ui/refs.ts`, `ui/prints.ts` (what a card prints), `ui/cards.ts`     |
| a goal anywhere, the tier's screen          | `ui/goal.ts`, `ui/standing.ts`, `ui/tier.ts`, `ui/research.ts`                     |
| the yard's sheet: map, trouble, makes/needs | `ui/views.ts`, `ui/table.ts`, `trouble.ts`, `walk.ts`, `flows.ts`, `arrivals.ts`   |
| numbers a minute on a card                  | `ui/numbers.ts`                                                                    |
| lessons and nudges                          | `teach.ts` (`nudge`, and `stepLessons` for when one is taken)                      |
| moments, walkers, sparks, sounds            | `events.ts`, `actors.ts`, `fx.ts`, `sound.ts`                                      |
| you in your yard: walking, the view, reach  | `figure/you.ts`, `figure/character.ts`, `figure/follow.ts`, `figure/reach.ts`      |
| the letter, the top bar, notices, panels    | `ui/letter.ts`, `ui/hud.ts`, `ui/notes.ts`, `ui/panels.ts`, `ui/board.ts`          |

## What must hold

- **The yard is Leaf's.** The page holds a copy run by the same rules (`S.world`) and sends what the
  member does as commands, each done to the copy at once (`doNow`). Only the rules write to a yard:
  pieces in hand are drawn from a yard that shares everything with the real one but its own few
  arrays (`asIf`), and orders Leaf hung go on the board by the rules' `hear`.
- **Flat arrays, numbers throughout.** The page reads the rules' arrays where it draws and decides;
  it makes no object for each piece or tile. Things, kinds, plots and goals are numbers; names are
  used only on the wire and where art and words are looked up.
- **The rules count changes.** `y.rev` moves with every command done and every goal finished.
  Whatever is worked out from the yard and kept (the layout, the plan, trouble, flows, an aim) is kept
  by the yard object and `y.rev`, and nothing else.
- **The link to Leaf is one value** (`sync.ts`): closed, in step, giving way to Leaf's yard, or ended.
  While it gives way the yard takes no input (`gate`). Every page of a yard is in the yard's room on
  Leaf; the owner's page lets its own batches go and takes Leaf's yard when another of its pages
  acted. A check that differs is told to Leaf as a fault only when no other page's batch came
  between (Leaf's revision one past the last the page knew). Live keeps one connection for a player,
  so of the owner's pages only the last opened is in the room.
- **What is in hand is one value** (`hand.ts`), moved only by `step`. A drag belongs to the hand
  variant that began it, so it ends whenever the hand moves on: a put-away, a lost press, a blur.
  Escape steps back one stage of whatever is in hand.
- **Undo undoes only what Leaf did** (`undos.ts`, one value), and only while what it touched stands
  as it was just after. Pressed before Leaf has answered, it waits for Leaf, then undoes or says why not.
- **The mouse points at what is under it now** (`input.ts`): worked out again when the yard moves
  under it, and resting on nothing while it moves, so no card comes up for what passes beneath.
- **The kit's pinned card is the one source of the tile the yard marks** (`S.picked` reads it). Taking
  up a tool closes it, and so does taking away what it is about.
- **Prices are judged in one place:** `doNow`, with the purse as it is at that moment.
- **A part of the interface shows only what its print holds** (`shows`, in `ui/parts.ts`): cards,
  panels, the top bar and the line over the dock are drawn again exactly when their print differs.
- **The graphics card draws the yard (WebGL2), every frame whole.** The art is what the painters draw
  on canvases, copied to the card's atlas the first time each picture is drawn, so a picture is not
  painted on again once it has been drawn. Each layer of a frame draws what can show, by how far it
  reaches: pieces by their tiles with a margin, lamps by their light (`lamps.ts`). A piece that
  stands is listed (`put`) and drawn far to near; what is as near is drawn in the order listed.
- **No frame shows ground that is not painted.** The ground is kept whole on the card (`floor.ts`):
  what a view lacks is painted before the frame is drawn, and the rest ahead of need in the time
  frames have left. When the card takes everything back (`webglcontextlost`) nothing is drawn until
  it returns; then the painter makes its own things again and the ground is painted again (`wipe`).
- **A lesson is taken only when it is learnt** (`stepLessons`), never because something hid it.
- **A kind of piece is one module here and one in the rules** (`kinds/new-kind.test.ts` adds a
  throwaway one and fails if anything else must change). How a kind looks, lights and reads is asked
  of its module (`pageOf`).
- **Nothing in `src/` reaches `review/` or `test/`** (`shipped.test.ts`): the page ships without them.

The screen keeps only its own settings in the browser: `works.screen.v1` (the lessons taken, the
zoom, the grade chosen for each kind), `works.view.v1` (the yard's sheet's last view),
`works.folds.v1` (what is folded: lists, goal cards, the card in the corner) and `works.card.v1` (a
card has been pinned from the yard, so the line over the dock stops saying how).

## Looking at it from outside

A review page is the page's own entry with a file of `review/` in place of `src/main.ts`, built and
served by the play server on this machine (`apps/api/test/play.ts`):

```sh
sed 's#./src/main.ts#./review/tour.ts#' index.html > tour.html
bun build tour.html --outdir <site>/works-tour      # then /play/works-tour/tour.html
```

- `review/tour.ts`: the page with handles on `window.works` (`review/handles.ts`) for the screenshot
  tours (the kit's `packages/kit/tools/drive.ts`): `stage(...)` stages a moment on the play server
  (`POST /test/play/works`, `stage-works.ts`) and takes it; `pick`, `grade`, `aim`, `tap`, `drag`,
  `drop`, `confirm`, `build`, `remove`, `plot`, `act` and `after` act as a member would; `hold` and
  `skip` move only the screen; `open`, `card`, `close`, `look` and `zoom` show things; `state()` sums
  the page up (the hand, the lessons, `differences`, `reads`, a visit's following); `bench(frames)`
  times a frame by part; `shot()` draws a frame and gives the yard's picture as a PNG; `holds()`
  says what the graphics card keeps for it, in bytes.
- `review/bench.ts`: the page with a generated yard of its own (`?pieces=5500`), for timing a frame
  of a yard larger than the guild's land holds. It opens nothing from Leaf (`S.alone`).
- `review/gallery.ts`: a yard with every graded piece at each grade, working and not.
- `review/sheet-page.ts`: the art laid out with names (`?sheet=machines`, `items`, `grades`).
- `?meter` on any page: frames a second, the longest frame, and milliseconds a frame by part (the
  layers are the page's own work on them; the card's is in `until free`).

The second design is balanced with the rules' planner, not by playing the story through: `bun plan.ts`
in `packages/factory`.

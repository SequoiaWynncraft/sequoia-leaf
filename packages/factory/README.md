# The Works on flat data

Today's rules of the Works (`packages/yard`), exactly, with the yard laid flat: numbers in typed
arrays and a few small records, nothing for each piece and no string for each thing. It is the
footing the second design builds on. Nothing serves or draws it yet; its tests prove it is the same
game as today's.

## What to read for which kind of work

| To work on                                                                 | Read                                                                          |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| what things, machines, recipes, plots, plans, the story and the askers are | `src/content/*.ts` (data only)                                                |
| how a name becomes a number, and the numbers' types                        | `src/tables.ts`                                                               |
| what a yard holds, and its side tables                                     | `src/yard.ts`, then `src/land.ts`                                             |
| one tick                                                                   | `src/tick.ts`, `src/wire.ts` (who hands to whom), `src/power.ts`              |
| building, removing, turning, plots and plans                               | `src/build.ts`; many pieces at once: `src/pieces.ts`; colours: `src/lines.ts` |
| orders, the story, the board, the till                                     | `src/orders.ts`, `src/clock.ts`                                               |
| Leaf's game: commands, Coins, time, the view                               | `src/game.ts`                                                                 |
| keeping a yard, and the check                                              | `src/codec.ts`, `src/bytes.ts`, `src/check.ts`                                |
| the route for a run of belt; what a piece is doing                         | `src/route.ts`; `src/status.ts`                                               |
| proving it is today's game                                                 | `test/sides.ts` (the picture and the pair), then the tests                    |
| what it costs                                                              | `bench.ts`, and `test/big.test.ts` for the budgets                            |

```sh
bun test                       # the side-by-side harness and the budgets
bun bench.ts [real-yard.json]  # times and sizes beside today's yard
```

## The yard

A tile is `y * w + x`. Every array below is indexed by the tile, and holds `NONE` (255) for
nothing:

| Array  | Type  | What it holds                                                               |
| ------ | ----- | --------------------------------------------------------------------------- |
| `kind` | Uint8 | what stands there                                                           |
| `dir`  | Uint8 | the way it faces: 0 east, 1 south, 2 west, 3 north                          |
| `item` | Uint8 | what a belt, splitter, joiner or tunnel mouth carries                       |
| `prog` | Uint8 | how far across its tile, in eighths                                         |
| `via`  | Uint8 | the side it was handed in from, 1 + a way, or 0 (only for drawing)          |
| `tint` | Uint8 | a line's colour, 0 to 6                                                     |
| `turn` | Uint8 | a splitter's next way out, a joiner's next way in                           |
| `shut` | Uint8 | a splitter's shut ways, a bit each                                          |
| `free` | Uint8 | 1 for one of the pieces a new yard has to hand                              |
| `span` | Int8  | a tunnel's tiles under: positive at the way-in mouth, negative at the other |
| `row`  | Int32 | the piece's row in a side table, or -1                                      |
| `lit`  | Uint8 | 1 where power reaches                                                       |

Side tables have a row for each piece that needs one, kept packed (a removed row takes the last):

- **holders**, for gatherers, mills, benches, workshops, crates and boilers: `out`, `making`,
  `recipe` (things, Uint8), `work` (Float64, ticks at the plain pace), `idle`, `open`, `fuel`,
  `kinds` (Uint8), `count` (Uint16), and `stock`, how many of each thing (Uint16, 23 a row);
- **tunnels**, for each way-in mouth: `under` (thing, Uint8) and `along` (eighths, Uint8), three a row;
- **blueprints**: each one's pieces as 9 bytes a piece.

The plumbing (`wire`) is worked out once after a change: four lists of tiles, sized by what
stands (the order things are handed on in, the tiles that carry, the machines that work, the
boilers in reach), and for each tile the sides it takes things in from, a bit each. A tick runs
down those lists and nothing else, and makes nothing.

Beside them, plain records: the clock, the till, the story, the board's orders, plots and plans
owned (in the order bought), what is open (a bit for each kind, plot and plan), the depot's books
(a Float64 count of each thing).

**Units.** Progress across a tile and under the ground is whole eighths: belts move 2, 3 or 4
eighths a tick, so every value play makes is exact. Work and the Coins in the till stay the
JavaScript numbers today's rules make them: when power is short a machine works at
`supply / demand` of its pace, which no whole unit holds exactly, and the till adds a hundredth of a
thing's worth at a time in floating point; whole units would change when a machine finishes and
when a Coin is paid in.

## Keeping a yard

`encode` writes a JSON record of the yard's numbers and orders, as today's `save` does, with its
pieces packed into bytes (`cells`, in base64) and its blueprints the same. A piece is a few bytes:
the gap since the last piece, its kind and way and whether it carries something, the thing and its
progress, then only the parts that are not as new. `decode` refuses a record of the wrong shape or
version whole, and builds every piece again through the rules (`vouch`), so anything that could not
have come about by playing is left out, as today's `load` leaves it out.

`check` is one pass over the yard into 32 bits, for Leaf and the page to compare their copies. It
leaves out the seed, Leaf's clock and the letter, and a machine's note that it found nothing to
start on, which is worked out again; a yard read back gives the same check.

## The harness

`test/sides.ts` gives both rules one picture of a yard: every part of every piece, and every number
of the yard, exactly. A `Pair` takes the same command off the wire into both and compares the
answers (refusals, Coins, notes) and the pictures. The tests run it on a new yard, on every yard in
`packages/yard/src/yards`, on today's working yard, on random play (`test/random.ts`), on the
story played by script (`test/story.ts`, after `apps/works/review/balance.ts`), on time away, on a
yard of about 6,000 pieces made by the scale study's generator (`test/gen.ts`, built with commands,
so the same commands build it again on today's rules), and on the codec.

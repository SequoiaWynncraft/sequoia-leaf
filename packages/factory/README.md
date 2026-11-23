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
| proving it is today's game                                                 | `test/sides.ts` (the comparison and the pair), then the tests                 |
| what it costs                                                              | `bench.ts`, and `test/budgets.test.ts` for the budgets                        |

```sh
bun test                       # the side-by-side harness and the budgets (about half a minute)
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

Side tables have a row for each piece that needs one, kept packed (a removed row takes the last),
and grow by half when full:

- **holders**, for gatherers, mills, benches, workshops, crates and boilers: `out`, `making`,
  `recipe` (things, Uint8), `work` (Float64, ticks at the plain pace), `idle`, `open`, `fuel`,
  `kinds` (Uint8), `count` (Uint16), and `stock`, how many of each thing (Uint16, 23 a row);
- **tunnels**, for each way-in mouth: `under` (thing, Uint8) and `along` (eighths, Uint8), three a row;
- **blueprints**: each one's pieces as 9 bytes a piece (kept in fewer, below).

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
pieces packed into bytes (`cells`, in base64) and each blueprint the same. The pieces' bytes begin
with how many there are; a piece is a few bytes: the gap since the last piece, its kind and way and
whether it carries something, the thing and its progress, then only the parts that are not as new.
A blueprint's piece is its kind, x, y and way, then only the parts it keeps. `decode` refuses whole
a record of the wrong shape or version, and pieces' bytes cut short, left over, with a part it does
not know or with a count past what the tables allow; it builds every piece again through the rules
(`vouch`), so anything that could not have come about by playing is left out, as today's `load`
leaves it out.

`check` is one pass over the yard into 32 bits, for Leaf and the page to compare their copies: every
part of the yard the rules read. It leaves out what only Leaf holds (the seed, its clock, the
letter), news, what is worked out again (what is open, rates, power, the plumbing, a machine's idle
note) and which row of a side table holds a piece's parts; a yard read back gives the same check.
`test/codec.test.ts` changes every other part of a yard in turn, and fails on one added unmixed.

## The harness

`test/sides.ts` reads both rules without changing either (`differs`): the land they stand on, every
number of the yard, every part of every tile, that the flat yard's side tables agree with its tiles,
and power and the plumbing, read where a yard holds them and worked out on copies where it does not.
A `Pair` gives both the same command off the wire, compares the answers (refusals, Coins, notes), and
compares the yards after every command, done or refused, and every 100 ticks. Where a command names
an area or a blueprint, each rules choose and place its pieces from their own yard (`Pair.choose`);
some go through Leaf's play service (`Pair.apply`), ahead of its lead and in the yard's past.

One difference is allowed, in one direction: today's yard colours a line by following its plumbing,
so after a paint, or a piece set down beside a colour, it may hold power and the plumbing worked out
where the flat yard, which follows the pieces, holds neither. Neither outcome differs.

The tests run pairs on a new yard, on every yard in `packages/yard/src/yards`, on today's working
yard, on random play (`test/random.ts`, which counts what took effect and fails if a kind of
command, piece or plan never did), on the story played by script (`test/story.ts`, after
`apps/works/review/balance.ts`), on time away, on a shut crate filled by two feeders, on refusals
followed by a tick taken cold, on a yard of about 6,000 pieces made by the scale study's generator
(`test/gen.ts`, built with commands, then built again by them on today's rules and compared after
each of its 82,749 commands, power worked out on copies after every thousandth), and on the codec.

## Budgets

Held by `test/budgets.test.ts`, at about 6,000 pieces on 112 by 84 tiles unless said:

- memory, every array a yard reaches but its land: under 400 KB; a yard of nothing but crates, as
  many as the land holds: under 1 MB;
- kept: packed, three full blueprints included, under 40 KB; as the store keeps it, UTF-8 text,
  under 56 KB;
- allocation: a tick of a yard whose plumbing is worked out, in which no order is filled, allocates
  nothing (no collection in a thousand ticks, and no byte, on a yard that takes things in and one that
  does not); and nothing the tick calls, in any file, makes an array, object, closure, string or
  iterator, but the plumbing worked out again and an order filled (`test/calls.ts`);
- work: a tick reads as many numbers for the same pieces on maps of two sizes;
- time: the median tick under 2 ms.

Measured beside them and printed: the first tick after a change, and a tick that fills an order.

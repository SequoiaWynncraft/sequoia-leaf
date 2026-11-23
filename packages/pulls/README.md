# Pulls, as rules

The pull game's rules (`@sequoia-leaf/pulls`), with no page in them: plain data and plain functions,
type-checked without the page's library or Bun's. `PULLS` (`src/game.ts`) is the `Game` Leaf's play
service holds each player's pulls with.

```sh
bun test
```

`src/wire.ts` reads what Leaf sends a page back into these types: the view, a command's notes, and
the banners route's answer.

## What is won

Seven rarities (`RARITIES`), each with its colour, in three tiers: filler (Leafkin, Sapling, Sprite),
mid (Dryad, Druid) and top (Treant, Yggdrasil). Every prize (`PRIZES`) is one of The Little Raid's
figures (`figure:<id>`) or a banner's headliner (`headliner:<banner>`). A figure's rarity is its
price in the raid (`tier` in `packages/raid`), so a figure added there is in a pool:

| Rarity    | Figures                                       |
| --------- | --------------------------------------------- |
| Leafkin   | every figure of price 1                       |
| Sapling   | every figure of price 2                       |
| Sprite    | every figure of price 3                       |
| Dryad     | of price 4: all but the two that are Druid    |
| Druid     | of price 4: Crab #40 and the Apothecary Gnome |
| Treant    | every figure of price 5                       |
| Yggdrasil | a banner's headliner                          |

Which member a banner's headliner is, Leaf reads from its `banner_people` table; nothing about
them is in this package.

What a prize is, once won, is the other games' to say, from the award (`pull:<prize>`): the town
puts a figure in the camp's Storage once (its thing `figure-<id>`), and for a `headliner:` the
banner's statue (`statue-<banner>`). A second copy of a prize brings nothing but its Seeds.

Before the pools gave figures they gave the town's things (`thing:<id>`) and the raid table's looks
(`look:<id>`). `EARLIER` lists those with the rarity each had. None is in a pool or to be had for
Seeds, and the page counts none among a pool's prizes; what a player won of them is still held, is
named in their history, and is awarded as before (the camp has the thing, the raid's table owns the
look).

## Pools

`grove` is always open, and its top tier is the Treant figures. A banner (`BANNERS`) is open
from `from` until `until` by Leaf's clock, and its top tier adds its headliner.

## One pull

`draw` does one pull on a kind of pool's counters (`grove`'s, or the one all banners share) and the
state's stream. Every number it uses is in `RATES`, the table the page shows players. A `pull`
command stirs Leaf's dice into the stream first, then draws `n` times, and asks Leaf for `n` × 1,000
Leaf (one spend, keyed by the pulls made before it) or uses free pulls.

## The state

`have` (copies of each prize), the two counters, `seeds`, `free` (waiting, and when the next falls
due), `history` (the last 200 pulls), `pulls` (ever) and `rng`. `advance` adds the free pulls
fallen due, one every 24 hours, at most 7 waiting; nothing else changes with time. The page is
shown everything but `rng`, and the banners open now.

A stored state is read in two layers. The shape is checked first, and anything else is refused; it
names no number of `RATES`, no banner and no prize. Then the state is brought under today's content
and numbers, and nothing is refused: a counter past certainty is certain on the next pull, free
pulls past the most wait as the most, a longer history keeps its last pulls, and a prize or pool
these rules do not know (a banner retired, its headliner, a figure gone from the raid) is kept as it
was won. Only the Treasury's wares, which went before any of this, are dropped. `stored/` holds
states as Leaf stores them, frozen; `src/stored.test.ts` fails if a change stops one reading. `awards` is `pull:<prize>` for each prize held; `standing` is the number of different prizes, with
pulls ever and top-tier prizes won; each top-tier prize is logged as `pulls_top`.

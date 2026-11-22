# Pulls, as rules

The pull game's rules (`@sequoia-leaf/pulls`), with no page in them: plain data and plain functions,
type-checked without the page's library or Bun's. `PULLS` (`src/game.ts`) is the `Game` Leaf's play
service holds each player's pulls with.

```sh
bun test
```

## What is won

Seven rarities (`RARITIES`), each with its colour, in three tiers: filler (Leafkin, Sapling, Sprite),
mid (Dryad, Druid) and top (Treant, Yggdrasil). Every prize (`PRIZES`) is something another game
already has, named by kind: `thing:` (the town's), `look:` (the raid table's), `ware:` (the
Treasury's), or `headliner:<banner>`. Filler is the market's stall stock by price, read from the
town's catalogue, so it follows the catalogue. Which member a banner's headliner is, Leaf reads from
its `banner_people` table; nothing about them is in this package.

## Pools

`grove` is always open, and its top tier is the three Treant prizes. A banner (`BANNERS`) is open
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

`awards` is `pull:<prize>` for each prize held; `standing` is the number of different prizes, with
pulls ever and top-tier prizes won; each top-tier prize is logged as `pulls_top`.

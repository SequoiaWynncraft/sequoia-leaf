# The Little Raid (grey-box)

An auto battler for the guild, as a plain prototype: a party of spirits goes on a small raid of its
own. It exists to find out whether the loop is good to play before any art is made for it.

```sh
bun run dev      # with hot reload
bun run build    # dist/
bun test         # the simulation's rules
```

A run is eight short rounds. Each one is a turn at the stall (take spirits along, feed them, line
them up) and then a fight the line has by itself against a wave of forest trouble, with a boss at
the end and a few hearts to lose on the way. Friendly bouts are the same run against guild-mates'
saved parties, with nothing at stake. There is no ladder, nothing carries over between runs, and
nothing to come back for daily. The rules themselves are in the game: tap anyone to read what they do.

## How it is put together

- `src/cast.ts` is the content as plain tables: the twelve spirits, the forest's trouble, the snacks,
  and the waves round by round. Tuning the game is editing this file.
- `src/sim.ts` is the whole game with no screen in it: the stall, the line, and the fight. A fight
  is worked out all at once from the two lines and a seed, into a tape of what happened, so it is
  the same every time, is tested (`src/sim.test.ts`), and could later be checked by a server.
- `src/main.ts` draws it and plays the tape back on a clock of its own, which can be sped up,
  paused or skipped. `src/draw.ts` is how everyone looks: plain shapes and faces, drawn in code.

Guild-mates' parties do not exist yet. Until they do, a friendly bout meets the party a plain
shopper in `sim.ts` would have built from a seed, under a made-up name.

## The rebuild

`src/game/` is the game being rebuilt as a board-and-shop auto battler: a hex board, a rolling
stall, traits, three of a kind, items, boons, fifteen rooms. It has no screen in it yet, and its
own README says how it works and how a screen is meant to drive it. `bun test` runs its tests with
the old ones. `review/balance.ts` now plays whole runs of the new game with bots of different habits
and prints how far each gets (`bun review/balance.ts 200 0`).

## Looking at the old page without playing

The page puts a handle on `window.battler` for driving it from a script: headless browsers draw
about a frame a second, so `battler.tick(ms)` moves the fight's clock by hand, and
`battler.until("Spark")` plays on to a named moment. The lists in `review/steps-*.json` take the
screenshots with the driver in the sibling app:

```sh
bun run build && bun ../works/review/drive.ts "http://battler.test/" <out-dir> review/steps-fight.json dist
```

## Where the shape comes from

A stall phase and then a fight that plays itself, a short line that fights front first, and three
of a kind becoming one stronger are the genre's, best known from Super Auto Pets. Nothing of that
game's content is here: the spirits, the trouble, the abilities and the numbers are the guild's own.

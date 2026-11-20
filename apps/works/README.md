# The Works (grey-box)

A factory game for the guild, as a plain prototype: the simulation and the tools to build with, and
no art yet. It exists to find out whether the loop is good before anything is drawn for it.

```sh
bun run dev      # with hot reload
bun run build    # dist/
bun test         # the simulation's rules
```

## What is in it

- Miners on deposits (wood, ore, stone), belts, refineries (one thing in, one out), assemblers (two
  different things in, one out), splitters, and a depot in the middle that takes everything and pays.
- Power: it reaches out from the depot, and pylons carry it further. A machine out of power stops.
- Orders from the guild, one after another; filling one pays and unlocks the next machine.
- The factory is saved in the browser and is run on while you are away.

`src/sim.ts` is the whole game as plain data and functions moved on a tick at a time (ten a
second), with no screen in it, so it is tested (`src/sim.test.ts`) and can later be checked by a
server. `src/main.ts` draws it on a canvas and holds the tools.

## Where the shape comes from

The idea of a factory that feeds the rest of the game, a core that everything is anchored on, power
carried by pylons, one pooled depot and standing orders is the genre's, most recently Arknights:
Endfield's. Nothing of that game's content is here: the materials, the orders and the look are the
guild's own.

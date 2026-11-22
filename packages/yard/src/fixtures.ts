/** Yards for the tests to try the rules on. Nothing here is part of the game. */
import { build, buyPlan, buyPlot } from "./build.ts";
import type { Raw } from "./content/items.ts";
import { type Kind, KINDS } from "./content/machines.ts";
import { create } from "./create.ts";
import type { Dir } from "./grid.ts";
import { bareLand } from "./land.ts";
import { stand } from "./pieces.ts";
import { route } from "./route.ts";
import { step } from "./step.ts";
import { at, type Building, type World } from "./world.ts";

export interface Bare {
  readonly w?: number;
  readonly h?: number;
  readonly water?: readonly string[];
  readonly trunks?: readonly string[];
}

/**
 * A bare patch 24 tiles by 12 with the depot at (12, 6), every machine open, no orders on the board,
 * no pieces to hand, and deposits where a test wants them.
 */
export function bare(deposits: Readonly<Record<string, Raw>> = {}, opts: Bare = {}): World {
  const w = create({ land: bareLand(opts.w ?? 24, opts.h ?? 12, deposits, opts.water, opts.trunks) });
  w.open.kinds = new Set(KINDS);
  // Nothing to hand: on a bare patch everything costs what the tables say.
  w.spare = {};
  return w;
}

/** Gives every tile power, whatever the pylons say. */
export function lit(w: World): World {
  w.power.fill(1);
  w.wire = null;
  return w;
}

/** Builds with all the Coins in the world, and fails the test if the yard refuses. */
export function put(w: World, kind: Kind, x: number, y: number, dir: Dir = 0, span?: number): Building {
  const did = build(w, kind, x, y, dir, Infinity, span);
  const b = w.cells[at(w, x, y)];
  if (!did.ok || !b) throw new Error(`could not build a ${kind} at ${x},${y}: ${did.ok ? "nothing there" : did.why}`);
  return b;
}

/** Lays belts in a straight line from one tile to another, both included, pointing along the line. */
export function belts(w: World, x0: number, y0: number, x1: number, y1: number): void {
  const dir: Dir = x1 > x0 ? 0 : x1 < x0 ? 2 : y1 > y0 ? 1 : 3;
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let k = 0; k <= n; k++) put(w, "belt", x0 + Math.sign(x1 - x0) * k, y0 + Math.sign(y1 - y0) * k, dir);
}

/** Lays the shortest run of belt from a tile to a thing, and fails the test if there is no way. */
export function run(w: World, from: readonly [number, number], to: readonly [number, number]): void {
  const legs = route(w, from, to);
  if (!legs || !stand(w, legs, Infinity).ok) throw new Error(`no way from ${from.join(",")} to ${to.join(",")}`);
}

export function steps(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(w);
}

/** The building on a tile, failing the test if there is none. */
export function on(w: World, x: number, y: number): Building {
  const b = w.cells[at(w, x, y)];
  if (!b) throw new Error(`nothing stands at ${x},${y}`);
  return b;
}

/**
 * A working yard on the guild's own land, a dozen orders into the story: planks, tools, engines and
 * pots on their way to the depot, with a boiler to keep them going. For trying the clock and the
 * save against something like a real yard.
 */
export function workingYard(seed = 7): World {
  const w = create({ seed, story: 12 });
  for (const id of ["boiler", "rakes", "workshop", "tunnel"] as const) buyPlan(w, id, Infinity);
  buyPlot(w, "bank", Infinity);
  // Planks, straight to the depot.
  put(w, "gatherer", 20, 15, 0);
  put(w, "mill", 21, 15, 0);
  run(w, [22, 15], [23, 17]);
  // Deadfall for the boiler.
  put(w, "gatherer", 19, 16, 1);
  put(w, "boiler", 19, 17, 0);
  // Tools: planks from the south-east drift and ingots from the corner seam meet at a bench.
  put(w, "pylon", 28, 15);
  put(w, "gatherer", 28, 21, 3);
  put(w, "mill", 28, 20, 3);
  put(w, "gatherer", 30, 14, 2);
  put(w, "mill", 29, 14, 1);
  put(w, "bench", 28, 17, 2);
  run(w, [28, 19], [28, 17]);
  run(w, [29, 15], [28, 17]);
  // Engines: the tools go on to a second bench, which hands its engines to the depot.
  put(w, "bench", 26, 16, 1);
  run(w, [26, 17], [25, 17]);
  run(w, [27, 17], [26, 16]);
  // Gears for them, from a second ingot line and bricks from the far corner.
  put(w, "bench", 26, 13, 1);
  run(w, [26, 14], [26, 16]);
  put(w, "gatherer", 29, 12, 2);
  put(w, "mill", 28, 12, 2);
  run(w, [27, 12], [26, 13]);
  // Pots from the clay bank, a long way off, with pylons to carry power out to it.
  put(w, "pylon", 17, 19);
  put(w, "pylon", 14, 21);
  put(w, "gatherer", 12, 20, 0);
  put(w, "mill", 13, 20, 0);
  run(w, [14, 20], [23, 19]);
  // The bricks have to get past the pots, and go under them.
  put(w, "pylon", 19, 22);
  put(w, "gatherer", 18, 21, 0);
  put(w, "mill", 19, 21, 0);
  run(w, [20, 21], [26, 13]);
  return w;
}

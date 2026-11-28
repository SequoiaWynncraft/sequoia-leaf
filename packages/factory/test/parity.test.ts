/**
 * A yard saved and read back plays on as the yard it was kept from (`codec.ts`): whatever the tick
 * keeps for itself (the plumbing, which tiles wait) is worked out again from what is kept, and changes
 * nothing. Yards of every shape, with rings and without: staged yards, the generated one, tier 7's ring
 * of growers, tier 8's launch yard (charged cells crossing beats, kept between them), rings built at random with crates, splitters, sorters, joiners and tunnels, and Sol's ring
 * of a splitter taking things in by a side and a shut crate off it. Each is run to a tick picked at
 * random, kept and read back, and both run on, one check each tick, for 2,000 ticks; then again from
 * another tick. Any engine the yards hand on by must keep this.
 */
import { expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { beforeReach } from "./goals.ts";
import { ringOfGrowers } from "./growers.ts";
import { launchYard } from "./launchyard.ts";
import { rng } from "./random.ts";
import { randomRing } from "./randomring.ts";
import { bare } from "./ringyard.ts";
import { generated, must, staged } from "./yards.ts";

/** The way from one tile to the next beside it. */
const dirTo = ([x, z]: readonly number[], [a = 0, b = 0]: readonly number[]): number =>
  a > (x ?? 0) ? 0 : b > (z ?? 0) ? 1 : a < (x ?? 0) ? 2 : 3;

/** Sol's ring (tier 7's third review): a splitter taking things in by a side, a shut crate off a splitter put first, full but for a tile. */
function solsRing(): F.Yard {
  const y = bare();
  const set = (kind: string, x: number, z: number, dir: number): void => must(y, { do: "build", kind, x, y: z, dir });
  const path = (points: readonly (readonly [number, number])[]): void =>
    points.slice(0, -1).forEach((p, n) => set("belt", p[0], p[1], dirTo(p, points[n + 1] ?? p)));
  path([
    [3, 1],
    [3, 2],
    [3, 3],
    [3, 4],
    [3, 5],
    [4, 5],
    [5, 5],
  ]);
  set("splitter", 5, 5, 0);
  F.setIn(y, 5, 5, 1, true);
  F.setFirst(y, 5, 5, 0);
  path([
    [6, 5],
    [7, 5],
    [8, 5],
    [9, 5],
  ]);
  set("splitter", 7, 5, 0);
  set("crate", 7, 4, 3);
  F.setOpen(y, 7, 4, false);
  F.setFirst(y, 7, 5, 1);
  path([
    [5, 6],
    [6, 6],
    [7, 6],
    [8, 6],
    [9, 6],
    [9, 5],
  ]);
  path([
    [9, 5],
    [9, 4],
    [9, 3],
    [8, 3],
    [7, 3],
    [6, 3],
    [5, 3],
    [5, 4],
    [5, 5],
  ]);
  for (let i = 0; i < y.kind.length; i++)
    if (F.carries(y.kind[i] ?? F.NONE) && i !== F.at(y, 5, 6)) {
      y.item[i] = F.item("plank");
      y.prog[i] = 8;
    }
  F.changed(y);
  return y;
}

/** Runs a yard to a tick, keeps a copy and reads it back, and runs both on: the first tick their checks differ, or -1. */
function apart(y: F.Yard, ticks: number): number {
  const copy = F.decode(F.encode(y), y.land);
  if (!copy) throw new Error("the yard does not read back");
  for (let k = 1; k <= ticks; k++) {
    F.step(y);
    F.step(copy);
    if (F.check(y) !== F.check(copy)) return y.tick;
  }
  return -1;
}

const SHAPES: readonly [string, () => F.Yard][] = [
  ["staged mid", () => staged("mid")],
  ["staged large", () => staged("large")],
  ["generated", () => beforeReach(generated().y)],
  ["tier 7's ring of growers", ringOfGrowers],
  ["tier 8's launch yard, charged cells crossing beats", launchYard],
  ["Sol's ring", solsRing],
  ...Array.from({ length: 12 }, (_, k): [string, () => F.Yard] => [`random ring ${k + 1}`, () => randomRing(k + 1).y]),
];

test("a yard kept and read back at any tick plays on as the yard it was kept from, every tick, rings or not", () => {
  const r = rng(7);
  const seen = SHAPES.map(([name, make]) => {
    const y = make();
    const at: number[] = [];
    for (let time = 0; time < 2; time++) {
      const until = y.tick + 1 + Math.floor(r() * 400);
      while (y.tick < until) F.step(y);
      at.push(apart(y, 2000));
    }
    return `${name}: ${at.join(" ")}`;
  });
  expect(seen).toEqual(SHAPES.map(([name]) => `${name}: -1 -1`));
}, 120_000);

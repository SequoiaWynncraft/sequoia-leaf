/**
 * The new pieces: a cart stop takes things from any side and they have reached the depot at once,
 * as many stops as the yard has unlocked; a sorter, in at the back, sends the one thing it is set to
 * out to its left and everything else ahead, and with nothing set is a belt. And a blueprint, set
 * down by naming its place.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { give, must } from "./yards.ts";

const plank = F.item("plank");
const brick = F.item("brick");
const yard = (tier = 4): F.Yard => F.create({ land: bareLand(15, 9, [], [12, 4]), tier, seed: 1 });

/** A shut crate at (x, y), to catch what comes; its row. */
function sink(y: F.Yard, x: number, z: number): number {
  must(y, { do: "build", kind: "crate", x, y: z, dir: 0 });
  must(y, { do: "crate", x, y: z, open: false });
  return y.row[F.at(y, x, z)] ?? -1;
}
/** A crate at (x, y) facing a way, letting out what it is given. */
function source(y: F.Yard, x: number, z: number, dir: number, things: readonly (readonly [F.Item, number])[]): void {
  must(y, { do: "build", kind: "crate", x, y: z, dir });
  const r = y.row[F.at(y, x, z)] ?? -1;
  for (const [n, c] of things) for (let k = 0; k < c; k++) F.put(y.holders, r, n);
}
const run = (y: F.Yard, ticks: number): void => {
  for (let k = 0; k < ticks; k++) F.step(y);
};

describe("a cart stop", () => {
  test("takes things in from any side, and each has reached the depot at once", () => {
    const y = yard();
    must(y, { do: "build", kind: "stop", x: 3, y: 4, dir: 0 });
    source(y, 2, 4, 0, [[plank, 3]]);
    source(y, 3, 3, 1, [[brick, 2]]);
    source(y, 3, 5, 3, [[brick, 2]]);
    const till = y.till;
    run(y, 40);
    expect([y.depot[plank], y.depot[brick]]).toEqual([3, 4]);
    expect(y.till - till).toBe(7 * (F.ARRIVAL[plank] ?? 0));
    expect(F.status(y, F.at(y, 3, 4))?.state).toBe("giving");
  });

  test("a yard may stand only as many as it has unlocked", () => {
    expect(give(yard(3), { do: "build", kind: "stop", x: 3, y: 4, dir: 0 })).toMatchObject({
      why: "The cart stop is not unlocked yet",
    });
    const y = yard();
    must(y, { do: "build", kind: "stop", x: 3, y: 4, dir: 0 });
    expect(give(y, { do: "build", kind: "stop", x: 5, y: 4, dir: 0 })).toMatchObject({
      refused: "cannot_build",
      why: "The yard may have 1 cart stop",
    });
    must(y, { do: "build", kind: "stop", x: 3, y: 4, dir: 1 });
    must(y, { do: "remove", x: 3, y: 4 });
    const two = [5, 6].map((x) => ({ kind: "stop", x, y: 4, dir: 0, span: 0 }));
    expect(give(y, { do: "stand", pieces: two })).toMatchObject({ refused: "cannot_stand" });
    expect(y.kind[F.at(y, 5, 4)]).toBe(F.NONE);
  });
});

/** A sorter on (4, 4) facing east, fed from behind; what reaches the crates ahead and to its left. */
function sorted(item: string | null): { ahead: number[]; left: number[] } {
  const y = yard();
  must(y, { do: "build", kind: "sorter", x: 4, y: 4, dir: 0 });
  if (item !== null) must(y, { do: "sort", x: 4, y: 4, item });
  must(y, { do: "build", kind: "belt", x: 3, y: 4, dir: 0 });
  must(y, { do: "build", kind: "belt", x: 5, y: 4, dir: 0 });
  must(y, { do: "build", kind: "belt", x: 4, y: 3, dir: 3 });
  const ahead = sink(y, 6, 4);
  const left = sink(y, 4, 2);
  source(y, 2, 4, 0, [
    [plank, 5],
    [brick, 4],
  ]);
  run(y, 200);
  const holds = (r: number): number[] => [F.held(y.holders, r, plank), F.held(y.holders, r, brick)];
  return { ahead: holds(ahead), left: holds(left) };
}

describe("a blueprint", () => {
  test("is set down by naming its place, the corner and the turns, in one command that is all or none, whatever its size: 400 pieces", () => {
    const y = F.create({ land: bareLand(48, 30, [], [44, 4]), tier: 4, seed: 1 });
    for (let z = 2; z < 22; z++)
      for (let x = 1; x < 21; x++) expect(F.build(y, F.BELT, x, z, 0, Infinity).ok).toBe(true);
    must(y, { do: "saveBlueprint", slot: 2, tiles: F.within(y, 1, 2, 20, 21) });
    const belts = (): number => y.kind.filter((k) => k === F.BELT).length;
    const did = give(y, { do: "placeBlueprint", slot: 2, x: 22, y: 2, turns: 1 });
    if ("refused" in did) throw new Error(did.why);
    expect([belts(), y.dir[F.at(y, 22, 2)]]).toEqual([800, 1]);
    expect((did.coins ?? []).reduce((sum, c) => sum - c.amount, 0)).toBe(400);
    // Where one of its pieces cannot stand, off the map, none does.
    expect(give(y, { do: "placeBlueprint", slot: 2, x: 30, y: 12, turns: 0 })).toMatchObject({
      refused: "cannot_place_blueprint",
      why: "That is off the map",
    });
    expect(give(y, { do: "placeBlueprint", slot: 1, x: 22, y: 2, turns: 0 })).toMatchObject({
      refused: "cannot_place_blueprint",
      why: "There is no blueprint there",
    });
    expect(belts()).toBe(800);
  });
});

describe("a sorter", () => {
  test("sends the one thing it is set to out to its left, and everything else ahead", () => {
    expect(sorted("plank")).toEqual({ ahead: [0, 4], left: [5, 0] });
    expect(sorted("brick")).toEqual({ ahead: [5, 0], left: [0, 4] });
  });

  test("with nothing set it is a belt", () => {
    expect(sorted(null)).toEqual({ ahead: [5, 4], left: [0, 0] });
  });

  test("takes things in only from behind; is set by its own command; keeps what it is set to when read back", () => {
    const y = yard();
    must(y, { do: "build", kind: "sorter", x: 4, y: 4, dir: 0 });
    source(y, 4, 5, 3, [[plank, 2]]);
    run(y, 40);
    expect(y.item[F.at(y, 4, 4)]).toBe(F.NONE);
    must(y, { do: "build", kind: "belt", x: 7, y: 7, dir: 0 });
    expect(give(y, { do: "sort", x: 7, y: 7, item: "plank" })).toMatchObject({ refused: "not_a_sorter" });
    must(y, { do: "sort", x: 4, y: 4, item: "brick" });
    const back = F.decode(F.encode(y), y.land);
    expect(back?.set[F.at(back, 4, 4)]).toBe(brick);
    expect(back && F.keptAt(back, F.at(back, 4, 4))).toEqual({ recipe: brick });
  });
});

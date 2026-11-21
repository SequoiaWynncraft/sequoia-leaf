import { describe, expect, test } from "bun:test";

import { KIND } from "./content/machines.ts";
import { bare, belts, lit, on, put, steps } from "./fixtures.ts";
import { lay, route, runCost } from "./route.ts";
import { at, type World } from "./world.ts";

/** A bare patch where tunnels have not been opened. */
const flat = (...args: Parameters<typeof bare>): World => {
  const w = bare(...args);
  w.open.kinds.delete("tunnel");
  return w;
};

describe("finding a way for a belt", () => {
  test("the shortest run to the depot ends beside it, pointing in", () => {
    const w = flat();
    const legs = route(w, [5, 6], [12, 6]);
    expect(legs?.map((l) => [l.x, l.y, l.dir])).toEqual([5, 6, 7, 8, 9, 10].map((x) => [x, 6, 0]));
    expect(legs?.every((l) => l.kind === "belt")).toBe(true);
    // Any side of the depot will do: from above, the run comes down onto its top.
    expect(route(w, [12, 1], [12, 6])?.map((l) => [l.x, l.y, l.dir])).toEqual([1, 2, 3, 4].map((y) => [12, y, 1]));
  });
  test("it goes round what is in the way, and what it lays carries", () => {
    const w = lit(flat({ "3,6": "ore" }, { water: ["7,5", "7,6", "7,7"], trunks: ["9,6"] }));
    put(w, "gatherer", 3, 6);
    const legs = route(w, [4, 6], [12, 6]);
    if (!legs) throw new Error("no way");
    expect(legs.length).toBe(10);
    expect(lay(w, legs, 100)).toEqual({ ok: true, cost: 10 * KIND.belt.cost });
    steps(w, 300);
    expect(w.depot.ore ?? 0).toBeGreaterThan(15);
  });
  test("a run to a machine comes in at a side it takes things from, never at its way out", () => {
    const w = flat();
    put(w, "mill", 6, 3, 2);
    // Straight on would arrive at the mill's way out, so the run steps aside and comes in from above.
    const legs = route(w, [2, 3], [6, 3]);
    const last = legs?.at(-1);
    expect(last ? [last.x, last.y] : null).not.toEqual([5, 3]);
    expect(legs?.length).toBe(6);
    // A splitter is only fed from behind.
    put(w, "splitter", 6, 8, 0);
    const fed = route(w, [8, 8], [6, 8])?.at(-1);
    expect(fed ? [fed.x, fed.y, fed.dir] : null).toEqual([5, 8, 0]);
    // Things that take nothing cannot be reached.
    put(w, "pylon", 18, 2);
    expect(route(w, [16, 2], [18, 2])).toBeNull();
  });
  test("a run to a belt joins it from behind or the side", () => {
    const w = flat();
    belts(w, 4, 4, 8, 4);
    const legs = route(w, [6, 1], [6, 4]);
    expect(legs?.map((l) => [l.x, l.y, l.dir])).toEqual([
      [6, 1, 1],
      [6, 2, 1],
      [6, 3, 1],
    ]);
    // From ahead of its end it has to come round.
    const round = route(w, [10, 4], [8, 4])?.at(-1);
    expect(round ? [round.x, round.y] : null).not.toEqual([9, 4]);
  });
  test("a run to clear ground ends on it", () => {
    const w = flat();
    expect(route(w, [2, 2], [4, 3])?.length).toBe(4);
    expect(route(w, [2, 2], [2, 2])).toEqual([{ kind: "belt", x: 2, y: 2, dir: 0, span: 0 }]);
  });
  test("there is no way through a wall, off the map, or from a tile that is taken", () => {
    const w = flat({}, { water: Array.from({ length: 12 }, (_, y) => `7,${y}`) });
    expect(route(w, [2, 6], [12, 6])).toBeNull();
    expect(route(w, [-1, 6], [12, 6])).toBeNull();
    expect(route(w, [7, 6], [12, 6])).toBeNull();
    put(w, "belt", 9, 6);
    expect(route(w, [9, 6], [12, 6])).toBeNull();
  });
  test("with tunnels open it goes under the stream, and under a line that crosses its way", () => {
    const w = lit(bare({ "2,6": "ore" }, { water: Array.from({ length: 12 }, (_, y) => `7,${y}`) }));
    put(w, "gatherer", 2, 6);
    const legs = route(w, [3, 6], [12, 6]);
    if (!legs) throw new Error("no way");
    expect(legs.filter((l) => l.kind === "tunnel")).toEqual([{ kind: "tunnel", x: 6, y: 6, dir: 0, span: 1 }]);
    expect(runCost(w, legs)).toBe(5 * KIND.belt.cost + KIND.tunnel.cost);
    expect(lay(w, legs, 4)).toEqual({ ok: false, why: "Not enough Coins" });
    expect(w.cells[at(w, 3, 6)]).toBeNull();
    expect(lay(w, legs, 99).ok).toBe(true);
    expect(on(w, 8, 6).span).toBe(-1);
    steps(w, 300);
    expect(w.depot.ore ?? 0).toBeGreaterThan(15);
    expect(route(w, [3, 2], [12, 6], { tunnels: false })).toBeNull();
  });
  test("a plain way round is taken when it is nearly as short as digging", () => {
    const w = bare({}, { trunks: ["6,6"] });
    const legs = route(w, [3, 6], [12, 6]);
    expect(legs?.some((l) => l.kind === "tunnel")).toBe(false);
    expect(legs?.length).toBe(9);
  });
  test("a run that would have to double back into its own tunnel mouth finds another way or none", () => {
    // A pocket: the only way out of (5, 3) is east, and the only way on from there is down under a wall of belts.
    const w = bare({}, { h: 9 });
    for (let x = 2; x <= 9; x++) if (x !== 6) put(w, "pylon", x, 2);
    put(w, "pylon", 4, 3);
    put(w, "pylon", 7, 3);
    put(w, "pylon", 7, 1);
    put(w, "pylon", 5, 1);
    for (let x = 2; x <= 9; x++) put(w, "pylon", x, 4);
    put(w, "pylon", 6, 0);
    const legs = route(w, [5, 3], [6, 7]);
    const tiles = (legs ?? []).map((l) => `${l.x},${l.y}`);
    expect(new Set(tiles).size).toBe(tiles.length);
    if (legs) {
      expect(lay(w, legs, 999).ok).toBe(true);
      // Everything it said it would build is there.
      for (const l of legs) expect(on(w, l.x, l.y).kind).toBe(l.kind);
    }
    // And laying refuses a run that crosses itself, whoever made it.
    const twice = [
      { kind: "belt", x: 12, y: 1, dir: 0, span: 0 },
      { kind: "belt", x: 12, y: 1, dir: 1, span: 0 },
    ] as const;
    expect(lay(w, twice, 999)).toEqual({ ok: false, why: "That run crosses itself" });
  });
  test("laying is all or nothing", () => {
    const w = flat();
    const legs = route(w, [2, 2], [12, 6]);
    if (!legs) throw new Error("no way");
    put(w, "pylon", legs[3]?.x ?? 0, legs[3]?.y ?? 0);
    expect(lay(w, legs, 999)).toEqual({ ok: false, why: "Something is here already" });
    expect(w.cells.filter((b) => b?.kind === "belt").length).toBe(0);
  });
});

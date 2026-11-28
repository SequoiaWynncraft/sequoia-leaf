/**
 * Where a figure may stand in a yard (`footing.ts`): what is walked over and what is walked round,
 * and a figure that something is built on put on the nearest clear ground.
 */
import { describe, expect, test } from "bun:test";

import { EDGE, IN_THE_WAY, OUTSIDE, TILE_PX, WATER } from "../src/footing.ts";
import * as F from "../src/index.ts";
import { learn } from "./goals.ts";
import { near } from "./near.ts";
import { buying, must } from "./yards.ts";

/** The middle of a tile as far east and south of the depot, in pixels of the art. */
const mid = (dx: number, dy: number): F.Place => {
  const { x, y } = near(dx, dy);
  return { x: x * TILE_PX + 8, y: y * TILE_PX + 8 };
};
/** A yard at tier 4, where everything the slice builds is open. */
const yard = (): F.Yard => F.create({ seed: 3, tier: 5 });
/** Why a figure's feet do not fit at the middle of a tile as far from the depot, or null. */
const why = (y: F.Yard, dx: number, dy: number): string | null => {
  const p = mid(dx, dy);
  return F.unsound(F.yardSolid(y), p.x, p.y);
};
/** The tile a point is on, as far east and south of the depot. */
const tileOf = (p: F.Place): [number, number] => [
  Math.floor(p.x / TILE_PX) - F.LAND.depot[0],
  Math.floor(p.y / TILE_PX) - F.LAND.depot[1],
];

describe("what a figure walks over", () => {
  test("a belt, a splitter, a joiner, a sorter and a tunnel's mouths lie flat and are walked over", () => {
    const y = yard();
    must(y, { do: "build", kind: "belt", ...near(-6, 2), dir: 0 });
    must(y, { do: "build", kind: "splitter", ...near(-5, 2), dir: 0 });
    must(y, { do: "build", kind: "joiner", ...near(-4, 2), dir: 0 });
    must(y, { do: "build", kind: "sorter", ...near(-3, 2), dir: 0 });
    must(y, { do: "build", kind: "tunnel", ...near(-6, 4), dir: 0 });
    for (const x of [-6, -5, -4, -3]) expect(why(y, x, 2)).toBeNull();
    expect(why(y, -6, 4)).toBeNull();
    // The straight way along the belts is clear.
    const [a, b] = [mid(-6, 2), mid(-3, 2)];
    expect(F.blocked(F.yardSolid(y), a.x, a.y, b.x, b.y)).toBeNull();
  });

  test("a mill stands up and is walked round: the way across it is blocked, a way beside it is not", () => {
    const y = yard();
    must(y, { do: "build", kind: "mill", ...near(-4, 2), dir: 0 });
    expect(why(y, -4, 2)).toBe(IN_THE_WAY);
    const [a, b] = [mid(-5, 2), mid(-3, 2)];
    expect(F.blocked(F.yardSolid(y), a.x, a.y, b.x, b.y)).toBe(IN_THE_WAY);
    const [c, d] = [mid(-5, 3), mid(-3, 3)];
    expect(F.blocked(F.yardSolid(y), c.x, c.y, d.x, d.y)).toBeNull();
  });

  test("the depot, the stream, a standing redwood, land not bought and the map's edge are solid", () => {
    const y = yard();
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) expect(why(y, ox, oy)).toBe(IN_THE_WAY);
    // The Long Meadow, south of the yard, is not the yard's until it is bought; its redwood stands 2 west and 15 south of the depot.
    expect(why(y, -4, 12)).toBe(OUTSIDE);
    must(y, buying(y, "meadow"));
    expect(why(y, -4, 12)).toBeNull();
    expect(why(y, -2, 15)).toBe(IN_THE_WAY);
    learn(y, F.goal("felling"));
    must(y, { do: "fell", ...near(-2, 15), price: F.fellPrice(y) });
    expect(why(y, -2, 15)).toBeNull();
    must(y, buying(y, "stream"));
    const stream = F.plot("stream");
    const wet = y.land.water.findIndex((w, i) => w === 1 && y.land.plots[y.land.plot[i] ?? F.NONE]?.plot === stream);
    expect(wet).toBeGreaterThanOrEqual(0);
    expect(why(y, (wet % y.land.w) - F.LAND.depot[0], Math.floor(wet / y.land.w) - F.LAND.depot[1])).toBe(WATER);
    expect(F.yardSolid(y).at(-1, 40)).toBe(EDGE);
    expect(F.yardSolid(y).at(40, y.land.h * TILE_PX)).toBe(EDGE);
  });
});

describe("a ford", () => {
  test("is walked over as ground, and is the stream to everything else: nothing is built on it", () => {
    const y = yard();
    for (const plot of ["grove", "seam"]) must(y, buying(y, plot));
    const seam = F.LAND.plots.findIndex((p) => p.plot === F.plot("seam"));
    const i = F.LAND.ford.findIndex((f, t) => f === 1 && F.LAND.plot[t] === seam);
    const [x, z] = [i % F.LAND.w, Math.floor(i / F.LAND.w)];
    expect([F.LAND.water[i], why(y, x - F.LAND.depot[0], z - F.LAND.depot[1])]).toEqual([1, null]);
    expect(F.refusal(y, F.BELT, x, z, Infinity)).toBe("Nothing can be built on the stream");
    // Beside it, the stream is as it was.
    expect(why(y, x - F.LAND.depot[0], z - F.LAND.depot[1] - 1)).toBe(WATER);
  });
});

describe("a figure something is built on", () => {
  test("is put on the nearest clear ground, off the tile and within a tile of it", () => {
    const y = yard();
    const at = mid(-4, 2);
    const solid = F.yardSolid(y);
    expect(F.freed(solid, at.x, at.y)).toEqual(at);
    // What is solid says it may have changed, so that nobody keeps what was worked out from it before.
    const version = solid.version();
    must(y, { do: "build", kind: "mill", ...near(-4, 2), dir: 0 });
    expect(solid.version()).not.toBe(version);
    const out = F.freed(F.yardSolid(y), at.x, at.y);
    expect(F.unsound(F.yardSolid(y), out.x, out.y)).toBeNull();
    expect(tileOf(out)).not.toEqual([-4, 2]);
    expect(Math.hypot(out.x - at.x, out.y - at.y)).toBeLessThanOrEqual(TILE_PX);
  });

  test("shut in on every side, it is put past what shuts it in", () => {
    const y = yard();
    for (let x = -5; x <= -3; x++)
      for (let z = 1; z <= 3; z++)
        if (x !== -4 || z !== 2) must(y, { do: "build", kind: "crate", ...near(x, z), dir: 0 });
    must(y, { do: "build", kind: "mill", ...near(-4, 2), dir: 0 });
    const at = mid(-4, 2);
    const out = F.freed(F.yardSolid(y), at.x, at.y);
    expect(F.unsound(F.yardSolid(y), out.x, out.y)).toBeNull();
    const [ox, oy] = tileOf(out);
    expect(Math.max(Math.abs(ox + 4), Math.abs(oy - 2))).toBe(2);
  });

  test("places are kept to sixteenths of a pixel", () => {
    expect(F.kept(1.03)).toBe(1);
    expect(F.kept(1.04)).toBe(1.0625);
    expect(F.kept(-0.5)).toBe(-0.5);
  });
});

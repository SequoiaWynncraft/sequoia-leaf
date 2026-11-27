/**
 * Where a figure may stand in a yard (`footing.ts`): what is walked over and what is walked round,
 * and a figure that something is built on put on the nearest clear ground.
 */
import { describe, expect, test } from "bun:test";

import { EDGE, IN_THE_WAY, OUTSIDE, TILE_PX, WATER } from "../src/footing.ts";
import * as F from "../src/index.ts";
import { must } from "./yards.ts";

/** The middle of a tile, in pixels of the art. */
const mid = (x: number, y: number): F.Place => ({ x: x * TILE_PX + 8, y: y * TILE_PX + 8 });
/** A yard at tier 4, where everything the slice builds is open. */
const yard = (): F.Yard => F.create({ seed: 3, tier: 4 });
/** Why a figure's feet do not fit at the middle of a tile, or null. */
const why = (y: F.Yard, x: number, z: number): string | null => {
  const p = mid(x, z);
  return F.unsound(F.yardSolid(y), p.x, p.y);
};

describe("what a figure walks over", () => {
  test("a belt, a splitter, a joiner, a sorter and a tunnel's mouths lie flat and are walked over", () => {
    const y = yard();
    must(y, { do: "build", kind: "belt", x: 18, y: 20, dir: 0 });
    must(y, { do: "build", kind: "splitter", x: 19, y: 20, dir: 0 });
    must(y, { do: "build", kind: "joiner", x: 20, y: 20, dir: 0 });
    must(y, { do: "build", kind: "sorter", x: 21, y: 20, dir: 0 });
    must(y, { do: "build", kind: "tunnel", x: 18, y: 22, dir: 0 });
    for (const x of [18, 19, 20, 21]) expect(why(y, x, 20)).toBeNull();
    expect(why(y, 18, 22)).toBeNull();
    // The straight way along the belts is clear.
    const [a, b] = [mid(18, 20), mid(21, 20)];
    expect(F.blocked(F.yardSolid(y), a.x, a.y, b.x, b.y)).toBeNull();
  });

  test("a mill stands up and is walked round: the way across it is blocked, a way beside it is not", () => {
    const y = yard();
    must(y, { do: "build", kind: "mill", x: 20, y: 20, dir: 0 });
    expect(why(y, 20, 20)).toBe(IN_THE_WAY);
    const [a, b] = [mid(19, 20), mid(21, 20)];
    expect(F.blocked(F.yardSolid(y), a.x, a.y, b.x, b.y)).toBe(IN_THE_WAY);
    const [c, d] = [mid(19, 21), mid(21, 21)];
    expect(F.blocked(F.yardSolid(y), c.x, c.y, d.x, d.y)).toBeNull();
  });

  test("the depot, the stream, a standing redwood, land not bought and the map's edge are solid", () => {
    const y = yard();
    const [dx, dy] = F.LAND.depot;
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) expect(why(y, dx + ox, dy + oy)).toBe(IN_THE_WAY);
    // The Long Meadow, south of the yard, is not the yard's until it is bought; its redwood stands at 22, 33.
    expect(why(y, 20, 30)).toBe(OUTSIDE);
    must(y, { do: "buyPlot", plot: "meadow" });
    expect(why(y, 20, 30)).toBeNull();
    expect(why(y, 22, 33)).toBe(IN_THE_WAY);
    must(y, { do: "fell", x: 22, y: 33 });
    expect(why(y, 22, 33)).toBeNull();
    must(y, { do: "buyPlot", plot: "stream" });
    const stream = F.plot("stream");
    const wet = y.land.water.findIndex((w, i) => w === 1 && y.land.plots[y.land.plot[i] ?? F.NONE]?.plot === stream);
    expect(wet).toBeGreaterThanOrEqual(0);
    expect(why(y, wet % y.land.w, Math.floor(wet / y.land.w))).toBe(WATER);
    expect(F.yardSolid(y).at(-1, 40)).toBe(EDGE);
    expect(F.yardSolid(y).at(40, y.land.h * TILE_PX)).toBe(EDGE);
  });
});

describe("a figure something is built on", () => {
  test("is put on the nearest clear ground, off the tile and within a tile of it", () => {
    const y = yard();
    const at = mid(20, 20);
    expect(F.freed(F.yardSolid(y), at.x, at.y)).toEqual(at);
    must(y, { do: "build", kind: "mill", x: 20, y: 20, dir: 0 });
    const out = F.freed(F.yardSolid(y), at.x, at.y);
    expect(F.unsound(F.yardSolid(y), out.x, out.y)).toBeNull();
    expect(Math.floor(out.x / TILE_PX) !== 20 || Math.floor(out.y / TILE_PX) !== 20).toBe(true);
    expect(Math.hypot(out.x - at.x, out.y - at.y)).toBeLessThanOrEqual(TILE_PX);
  });

  test("shut in on every side, it is put past what shuts it in", () => {
    const y = yard();
    for (let x = 19; x <= 21; x++)
      for (let z = 19; z <= 21; z++) if (x !== 20 || z !== 20) must(y, { do: "build", kind: "crate", x, y: z, dir: 0 });
    must(y, { do: "build", kind: "mill", x: 20, y: 20, dir: 0 });
    const at = mid(20, 20);
    const out = F.freed(F.yardSolid(y), at.x, at.y);
    expect(F.unsound(F.yardSolid(y), out.x, out.y)).toBeNull();
    expect(Math.max(Math.abs(Math.floor(out.x / TILE_PX) - 20), Math.abs(Math.floor(out.y / TILE_PX) - 20))).toBe(2);
  });

  test("places are kept to sixteenths of a pixel", () => {
    expect(F.kept(1.03)).toBe(1);
    expect(F.kept(1.04)).toBe(1.0625);
    expect(F.kept(-0.5)).toBe(-0.5);
  });
});

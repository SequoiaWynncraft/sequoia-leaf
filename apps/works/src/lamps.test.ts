/**
 * The lamplight is power's reach: a lamp is listed by how far its light reaches the view, never by
 * which pieces the view draws, so panning past a pylon never switches its light on and off.
 */
import { describe, expect, test } from "bun:test";

import { build, create, litOf, PYLON, REACH, refusal, type Yard } from "@sequoia-leaf/factory";

import { TILE } from "./art/belts.ts";
import { lampsIn } from "./lamps.ts";

/** A joined pylon near the depot: its tile. */
function pylon(y: Yard): { x: number; y: number } {
  const [cx, cy] = y.land.depot;
  for (let r = 3; r < 8; r++)
    for (let z = cy - r; z <= cy + r; z++)
      for (let x = cx - r; x <= cx + r; x++)
        if (refusal(y, PYLON, x, z, Infinity) === null && build(y, PYLON, x, z, 0, Infinity).ok)
          if (litOf(y)[z * y.land.w + x] === 1) return { x, y: z };
  throw new Error("no pylon");
}

const never = (): boolean => false;

describe("the lamps", () => {
  test("a pylon off the view to its left, within its reach, lights the view; one beyond it is not listed", () => {
    const y = create({ seed: 3, tier: 1 });
    const p = pylon(y);
    const reach = ((REACH.pylon * y.open.reach) / 10_000) * TILE * 1.2;
    const at = (lamps: ReturnType<typeof lampsIn>) => lamps.filter((l) => l.reach && l.x === p.x * TILE + 8);
    // The view begins three tiles right of the pylon: none of its drawn tiles is the pylon's.
    const near = { x: (p.x + 3) * TILE, y: (p.y - 6) * TILE, w: 20 * TILE, h: 13 * TILE };
    expect(3 * TILE).toBeLessThan(reach);
    expect(at(lampsIn(y, { x: 0, y: 0 }, near, 1, never, never))).toHaveLength(1);
    // A view so far right that the pylon's light cannot reach it.
    const far = { ...near, x: p.x * TILE + reach + 3 * TILE };
    expect(at(lampsIn(y, { x: 0, y: 0 }, far, 1, never, never))).toHaveLength(0);
  });
});

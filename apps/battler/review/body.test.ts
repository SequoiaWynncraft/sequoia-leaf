/**
 * A banner's member on the rig (`rig.ts` in the figures) is the same person the town draws: at rest
 * from the front, pixel for pixel the town's front walking frame (`bake` in the kit's `skin.ts`), for
 * the review's stand-in (gaz's look) and for made-up looks; and posed, each arm and leg is still the
 * whole piece, as wide as it was, never a line.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { REST, RIG, rigPic, type Stance } from "@sequoia-leaf/figures/rig.ts";
import { onPaper, pixelsOf } from "@sequoia-leaf/kit/paper.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { bake, FOOT_X, FOOT_Y, FRAME_H, FRAME_W, lookFor, paintSkin } from "@sequoia-leaf/kit/skin.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { mageSheet } from "./mage.ts";

let putBack = (): void => undefined;
beforeAll(() => {
  putBack = onPaper();
});
afterAll(() => putBack());

/** The pixels of a picture as `#rrggbbaa`, clear ones as "", by where they are from the feet. */
function byFeet(c: HTMLCanvasElement, fx: number, fy: number): Map<string, string> {
  const px = pixelsOf(c);
  const out = new Map<string, string>();
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if ((px[i + 3] ?? 0) === 0) continue;
      const hex = [...px.subarray(i, i + 4)].map((n) => n.toString(16).padStart(2, "0")).join("");
      out.set(`${x - fx},${y - fy}`, hex);
    }
  return out;
}

/** How many pixels differ between two pictures stood on the same spot. */
function differing(a: Map<string, string>, b: Map<string, string>): number {
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys].filter((k) => a.get(k) !== b.get(k)).length;
}

/** A skin with nothing but its arms, or its legs, in one colour: what the rig draws of it is those limbs and their edge. */
function onlyLimbs(which: "arms" | "legs"): ReturnType<typeof bake> {
  const { c, g } = makeCanvas(64, 64);
  if (which === "arms") R(g, 40, 20, 16, 12, "#30c060");
  else R(g, 0, 20, 16, 12, "#30c060");
  return bake(c);
}
/** The limb's own pixels in a posed picture: how many, and how many lie in a solid two-by-two square of them. */
function limbPixels(c: HTMLCanvasElement): { all: number; solid: number } {
  const px = pixelsOf(c);
  const on = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < c.width && y < c.height && px[(y * c.width + x) * 4 + 1] === 0xc0;
  let all = 0;
  let solid = 0;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      if (!on(x, y)) continue;
      all++;
      const square = (dx: number, dy: number): boolean => on(x + dx, y) && on(x, y + dy) && on(x + dx, y + dy);
      if (square(1, 1) || square(-1, 1) || square(1, -1) || square(-1, -1)) solid++;
    }
  return { all, solid };
}

/** Each angle from `from` to `to`, as the stance `pose` gives for it. */
function turns(from: number, to: number, pose: (a: number) => Partial<Stance>): Stance[] {
  return Array.from({ length: to - from + 1 }, (_, i) => Object.assign({}, REST, pose(from + i)));
}

describe("a banner's member on the rig", () => {
  const skins = {
    "the stand-in (gaz's look)": mageSheet,
    "a made-up look with a hood": () => paintSkin({ ...lookFor("Glacade"), style: "hood", sleeves: "short" }),
    "a made-up look with a cap": () => paintSkin({ ...lookFor("echoluu"), style: "cap", detail: "belt" }),
  };

  for (const [name, sheet] of Object.entries(skins))
    test(`stands at rest as the town draws them, pixel for pixel: ${name}`, () => {
      const body = bake(sheet());
      const town = body.frames[0]?.[0];
      if (!town) throw new Error("No front frame");
      expect([town.width, town.height]).toEqual([FRAME_W, FRAME_H]);
      const rest = byFeet(rigPic(body, REST), RIG.ax, RIG.ay);
      expect(rest.size).toBeGreaterThan(150);
      expect(differing(rest, byFeet(town, FOOT_X, FOOT_Y))).toBe(0);
    });

  test("swings each arm and leg at its joint as the whole piece, as wide at any angle as at rest", () => {
    const arms = onlyLimbs("arms");
    const legs = onlyLimbs("legs");
    // Every angle each is held at, two limbs at once where they never cross each other.
    const poses: [string, ReturnType<typeof bake>, Stance[]][] = [
      ["arms out, front", arms, turns(0, 8, (a) => ({ arm: a, offArm: a }))],
      ["an arm across, front", arms, turns(-3, 0, (a) => ({ arm: a }))],
      ["arms, side", arms, turns(-8, 7, (a) => ({ view: "side", arm: a, offArm: a }))],
      ["legs, front", legs, turns(0, 4, (a) => ({ leg: a, offLeg: a }))],
      ["legs, side", legs, turns(-3, 3, (a) => ({ view: "side", leg: a, offLeg: a }))],
    ];
    for (const [what, body, stances] of poses) {
      const atRest = limbPixels(rigPic(body, { ...REST, view: stances[0]?.view ?? "front" })).all;
      for (const s of stances) {
        const { all, solid } = limbPixels(rigPic(body, s));
        const seen = `${what}, arm ${s.arm} leg ${s.leg}: ${all} pixels, ${solid} in solid squares, ${atRest} at rest`;
        // As much of it as at rest (a piece turned covers about as many pixels), and thick all along:
        // drawn as lines, a limb at a slant had a third of its pixels in solid squares.
        expect(Math.abs(all - atRest), seen).toBeLessThanOrEqual(atRest * 0.2);
        expect(solid / all, seen).toBeGreaterThanOrEqual(0.6);
      }
    }
  });
});

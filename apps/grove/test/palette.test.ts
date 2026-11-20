import { describe, expect, test } from "bun:test";

import { CAST } from "../src/art/cast/cast.ts";
import { buildLut, C, ix, PALETTE_SIZE, R, WORLD_RAMPS } from "../src/engine/palette.ts";
import { compose, Light, Surface } from "../src/engine/raster.ts";

const lum = (c: readonly number[]): number => (c[0] ?? 0) + (c[1] ?? 0) + (c[2] ?? 0);

describe("one palette for the world and the cast", () => {
  test("draws every cast sprite in the character ramps", () => {
    for (const m of CAST)
      for (const f of [...m.idle, ...m.happy, ...Object.values(m.poses).flat()])
        for (const v of f.sprite.data) if (v) expect(v).toBeGreaterThanOrEqual(WORLD_RAMPS * 8);
  });

  test("keeps every index inside the table", () => {
    for (const m of CAST) for (const v of m.portrait.data) expect(v).toBeLessThan(PALETTE_SIZE);
  });

  test("gives a character twin its world ramp's dusk colours", () => {
    const dusk = buildLut("dusk", "normal", "#fdd36f");
    expect(dusk.rgb(ix(C.CRAB, 4))).toEqual(dusk.rgb(ix(R.CRAB, 4)));
  });

  test("lights characters a step brighter than the world at night, so they read", () => {
    const night = buildLut("night", "normal", "#fdd36f");
    expect(lum(night.rgb(ix(C.CRAB, 4)))).toBeGreaterThan(lum(night.rgb(ix(R.CRAB, 4))));
  });

  test("shows fire in the same colours on a character as in the world", () => {
    for (const time of ["dusk", "day", "night"] as const) {
      const lut = buildLut(time, "normal", "#fdd36f");
      for (let k = 0; k < 4; k++) expect(lut.levels[k]?.[ix(C.FIRE, 5)]).toBe(lut.levels[k]?.[ix(R.FIRE, 5)]);
    }
  });

  test("composes world and cast in one pass, the cast untouched by a rarity's light", () => {
    const s = new Surface(2, 1);
    s.set(0, 0, ix(R.MOSS, 4));
    s.set(1, 0, ix(C.CRAB, 4));
    const light = new Light(2, 1);
    const rare = new Light(2, 1);
    rare.data.fill(3);
    const lut = buildLut("dusk", "normal", "#fdd36f");
    const lit = new Uint32Array(2);
    const plain = new Uint32Array(2);
    compose(s, light, lut, lit, rare, [255, 0, 0]);
    compose(s, light, lut, plain);
    expect(lit[0]).not.toBe(plain[0]);
    expect(lit[1]).toBe(plain[1]);
  });
});

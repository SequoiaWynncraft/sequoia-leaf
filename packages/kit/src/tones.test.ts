import { describe, expect, test } from "bun:test";

import { CORAL, GOLD, SKY, WATER } from "./palette.ts";
import { lightOf, strongTones } from "./tones.ts";

/** A picture of so many solid pixels of each colour. */
const picture = (...of: readonly (readonly [r: number, g: number, b: number, pixels: number])[]): number[] =>
  of.flatMap(([r, g, b, pixels]) => Array.from({ length: pixels }, () => [r, g, b, 255]).flat());

describe("a picture's own colours", () => {
  test("are its strong tones on the palette, the one there is most of first", () => {
    // A crimson cloak with purple trim, teal hair, a gold collar, brown boots and a dark robe.
    const tones = strongTones(
      picture(
        [138, 0, 16, 800],
        [75, 3, 167, 130],
        [16, 158, 133, 110],
        [255, 216, 0, 12],
        [101, 66, 52, 200],
        [15, 8, 38, 60],
      ),
    );
    expect(tones).toEqual([
      [SKY[4], CORAL],
      [SKY[2], SKY[3]],
      [WATER[2], WATER[3]],
      [GOLD[0], GOLD[2]],
    ]);
  });

  test("leave out greys, browns, a stray pixel and whatever is see-through", () => {
    expect(strongTones(picture([120, 120, 120, 500], [101, 66, 52, 500], [255, 0, 0, 3]))).toEqual([]);
    expect(strongTones([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0])).toEqual([]);
  });

  test("are told light from dark", () => {
    expect(lightOf(GOLD[2])).toBeGreaterThan(lightOf(WATER[3]));
    expect(lightOf(SKY[2])).toBeLessThan(lightOf(WATER[2]));
  });
});

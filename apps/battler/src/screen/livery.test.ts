import { describe, expect, test } from "bun:test";

import { CORAL, GOLD, SKY, WATER } from "@sequoia-leaf/kit/palette.ts";
import { PALE, type Tone } from "@sequoia-leaf/kit/tones.ts";

import { liveryFrom } from "./livery.ts";

const RED: Tone = [SKY[4], CORAL];
const PURPLE: Tone = [SKY[2], SKY[3]];
const TEAL: Tone = [WATER[2], WATER[3]];
const GILT: Tone = [GOLD[0], GOLD[2]];

describe("a figure's own colours", () => {
  test("play their parts: the strongest is most of a thing, the lightest burns in it, the darkest edges it", () => {
    expect(liveryFrom([RED, PURPLE, TEAL, GILT])).toEqual({ main: RED, trim: PURPLE, core: GILT, spark: TEAL });
    expect(liveryFrom([TEAL, RED])).toEqual({ main: TEAL, trim: TEAL, core: RED, spark: RED });
  });

  test("are paper for a skin with no strong colour", () => {
    expect(liveryFrom([])).toEqual({ main: PALE, trim: PALE, core: PALE, spark: PALE });
  });
});

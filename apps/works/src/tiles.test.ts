/** What the picture asks of a tile's piece: which way it faces, where a thing came in, and what a tunnel's hood hides. */
import { expect, test } from "bun:test";

import { at, build, create, TUNNEL } from "@sequoia-leaf/factory";
import { xy } from "@sequoia-leaf/factory/test/near.ts";

import { cameFrom, dirAt, hooded } from "./tiles.ts";

test("a tunnel's hoods hide the half of each mouth toward the other, where a thing goes under and comes up", () => {
  const y = create({ seed: 5, tier: 3 });
  expect(build(y, TUNNEL, ...xy(-4, -2), 0, Infinity, { span: 2 }).ok).toBe(true);
  const [inMouth, outMouth] = [at(y, ...xy(-4, -2)), at(y, ...xy(-1, -2))];
  expect([y.kind[outMouth], dirAt(y, inMouth)]).toEqual([TUNNEL, 0]);
  // Going in: seen on the near half, gone under the hood past the middle.
  expect([0.2, 0.5, 0.7].map((p) => hooded(y, inMouth, p))).toEqual([false, false, true]);
  // Coming up from under the ground: under the hood until the middle, then seen.
  expect([0.2, 0.5, 0.7].map((p) => hooded(y, outMouth, p))).toEqual([true, false, false]);
  // Handed into the far mouth from a side: rides in along the side arm, never under the hood.
  y.via[outMouth] = 1 + 3;
  expect([0.2, 0.5, 0.7].map((p) => hooded(y, outMouth, p))).toEqual([false, false, false]);
  // A thing on it came in at its back (west), unless it was handed in from a side.
  expect(cameFrom(y, inMouth)).toBe(2);
  y.via[inMouth] = 1 + 3;
  expect(cameFrom(y, inMouth)).toBe(3);
});

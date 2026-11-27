/**
 * A finger's run of belt and the assembler, a piece of 3 by 3 tiles, facing every way: a run started
 * on any of its tiles starts on the tile past its way out; a run ended on any of its tiles ends at the
 * nearest tile-side that takes things in. Each is laid, and Leaf's yard is the page's.
 */
import { describe, expect, test } from "bun:test";

import {
  at,
  BELT,
  build,
  create,
  type Dir,
  DX,
  DY,
  encode,
  kind,
  pieceOf,
  takes,
  type Yard,
} from "@sequoia-leaf/factory";
import { xy } from "@sequoia-leaf/factory/test/near.ts";

import { opened, until, useFakeLeaf } from "../test/fake-leaf.ts";
import { S } from "./state.ts";
import { confirm, setTool, tapBelt } from "./tools.ts";
import { runOut } from "./ways.ts";
import { differences } from "./yard.ts";

useFakeLeaf();

const ASSEMBLER = kind("assembler");

/** A yard with tier 5's research done and an assembler at (-6, -4) facing `d`. */
function hall(d: Dir): Yard {
  const y = create({ seed: 5, tier: 6 });
  if (!build(y, ASSEMBLER, ...xy(-6, -4), d, Infinity).ok) throw new Error("no hall");
  return y;
}

/** The tile past the way out of an assembler on (x, y) facing `d`: the middle of its front, one on. */
const pastFront = (y: Yard, d: Dir): number => at(y, ...xy(-6 + 2 * (DX[d] ?? 0), -4 + 2 * (DY[d] ?? 0)));

describe("a finger's run and the assembler", () => {
  for (const d of [0, 1, 2, 3] as const) {
    test(`facing ${["east", "south", "west", "north"][d]}, starts past its way out from any of its tiles`, async () => {
      const y = hall(d);
      for (const [dx, dz] of [
        [0, 0],
        [-1, -1],
        [1, 1],
      ] as const)
        expect(runOut(y, at(y, ...xy(-6 + dx, -4 + dz)))).toBe(pastFront(y, d));
      const fake = await opened(y, 10_000);
      S.finger = true;
      setTool(BELT);
      tapBelt(...xy(-6, -4));
      tapBelt(...xy(2, -5));
      expect(S.run?.why).toBeNull();
      const first = S.run?.legs[0];
      expect(first ? at(S.world, first.x, first.y) : -1).toBe(pastFront(S.world, d));
      expect(confirm()).toBe(true);
      await until(() => fake.leaf.posts >= 1);
      expect(S.world.kind[pastFront(S.world, d)]).toBe(BELT);
      expect(differences()).toBe(0);
      expect(encode(S.world)).toBe(encode({ ...fake.leaf.yard, seed: null }));
    });

    test(`facing ${["east", "south", "west", "north"][d]}, a run ended on any of its tiles goes into a side that takes things in`, async () => {
      const y = hall(d);
      const fake = await opened(y, 10_000);
      S.finger = true;
      setTool(BELT);
      tapBelt(...xy(2, -5));
      tapBelt(...xy(-6, -4));
      expect(S.run?.why).toBeNull();
      const last = S.run?.legs.at(-1);
      if (!last) throw new Error("no run");
      const into = at(S.world, last.x + (DX[last.dir] ?? 0), last.y + (DY[last.dir] ?? 0));
      expect(pieceOf(S.world, into)).toBe(at(S.world, ...xy(-6, -4)));
      expect(takes(S.world, into, at(S.world, last.x, last.y))).toBe(true);
      expect(confirm()).toBe(true);
      await until(() => fake.leaf.posts >= 1);
      expect(differences()).toBe(0);
      expect(encode(S.world)).toBe(encode({ ...fake.leaf.yard, seed: null }));
    });
  }
});

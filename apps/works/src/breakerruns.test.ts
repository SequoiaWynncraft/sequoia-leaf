/**
 * A finger's run of belt and the breaker, a piece of 2 by 2 tiles whose way out is the left tile of
 * its front, facing every way: a run started on any of its tiles starts on the tile past its way out;
 * a run ended on any of its tiles ends at the nearest tile-side that takes things in. Each is laid,
 * and Leaf's yard is the page's. The shared code is the assembler's (`ways.ts`, `route.ts`).
 */
import { describe, expect, test } from "bun:test";

import {
  at,
  BELT,
  BREAKER,
  build,
  create,
  type Dir,
  DX,
  DY,
  encode,
  outsOf,
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

/** A yard with tier 5's research done and a breaker on (-6, -4), its own tile, facing `d`. */
function breaker(d: Dir): Yard {
  const y = create({ seed: 5, tier: 6 });
  if (!build(y, BREAKER, ...xy(-6, -4), d, Infinity).ok) throw new Error("no breaker");
  return y;
}

/** The tile past the breaker's way out, as the rules have its way out. */
function pastOut(y: Yard): number {
  const own = at(y, ...xy(-6, -4));
  const out = outsOf(y, own)[0];
  if (!out) throw new Error("no way out");
  const [x, z] = xy(-6 + out.dx + (DX[out.way] ?? 0), -4 + out.dy + (DY[out.way] ?? 0));
  return at(y, x, z);
}

describe("a finger's run and the breaker", () => {
  for (const d of [0, 1, 2, 3] as const) {
    const facing = ["east", "south", "west", "north"][d];
    test(`facing ${facing}, starts past its way out from any of its tiles`, async () => {
      const y = breaker(d);
      for (const [dx, dz] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const)
        expect(runOut(y, at(y, ...xy(-6 + dx, -4 + dz)))).toBe(pastOut(y));
      const fake = await opened(y, 10_000);
      S.finger = true;
      setTool(BELT);
      tapBelt(...xy(-5, -3));
      tapBelt(...xy(2, -5));
      expect(S.run?.why).toBeNull();
      const first = S.run?.legs[0];
      expect(first ? at(S.world, first.x, first.y) : -1).toBe(pastOut(S.world));
      expect(confirm()).toBe(true);
      await until(() => fake.leaf.posts >= 1);
      expect(S.world.kind[pastOut(S.world)]).toBe(BELT);
      expect(differences()).toBe(0);
      expect(encode(S.world)).toBe(encode({ ...fake.leaf.yard, seed: null }));
    });

    test(`facing ${facing}, a run ended on any of its tiles goes into a side that takes things in`, async () => {
      const y = breaker(d);
      const fake = await opened(y, 10_000);
      S.finger = true;
      setTool(BELT);
      tapBelt(...xy(2, -5));
      tapBelt(...xy(-5, -3));
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

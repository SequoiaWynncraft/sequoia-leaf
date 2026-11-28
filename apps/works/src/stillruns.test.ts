/**
 * A finger's run of belt and the still, a piece of 3 by 3 tiles with three ways out along its front,
 * each sending one thing: a run started on a tile of its front starts past that tile's way out, so the
 * middle one gives a line of creosote; started on any other of its tiles, past its first (left) way
 * out. Each is laid, and Leaf's yard is the page's.
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
  isItem,
  itemName,
  kind,
  outsOf,
} from "@sequoia-leaf/factory";
import { xy } from "@sequoia-leaf/factory/test/near.ts";

import { opened, until, useFakeLeaf } from "../test/fake-leaf.ts";
import { S } from "./state.ts";
import { confirm, setTool, tapBelt } from "./tools.ts";
import { runOut } from "./ways.ts";
import { differences } from "./yard.ts";

useFakeLeaf();

const STILL = kind("still");
/** The still's own tile, the middle of its box, from the depot. */
const OWN = [-6, -4] as const;

/** Each way out of the still facing `d`, from its left: its tile from the still's own tile, the tile past it, and what it sends. */
function ways(d: Dir): { tile: readonly [number, number]; past: readonly [number, number]; sends: string }[] {
  const y = create({ seed: 5, tier: 7 });
  if (!build(y, STILL, ...xy(...OWN), d, Infinity).ok) throw new Error("no still");
  return outsOf(y, at(y, ...xy(...OWN))).map((o) => ({
    tile: [OWN[0] + o.dx, OWN[1] + o.dy] as const,
    past: [OWN[0] + o.dx + (DX[o.way] ?? 0), OWN[1] + o.dy + (DY[o.way] ?? 0)] as const,
    sends: isItem(o.only) ? itemName(o.only) : "anything",
  }));
}

describe("a finger's run and the still", () => {
  for (const d of [0, 1, 2, 3] as const) {
    const facing = ["east", "south", "west", "north"][d];
    test(`facing ${facing}, starts past the way out of the front tile tapped, and past its left one from any other tile`, () => {
      const y = create({ seed: 5, tier: 7 });
      expect(build(y, STILL, ...xy(...OWN), d, Infinity).ok).toBe(true);
      const out = ways(d);
      expect(out.map((o) => o.sends)).toEqual(["pitch", "creosote", "spirit"]);
      for (const o of out) expect(runOut(y, at(y, ...xy(...o.tile)))).toBe(at(y, ...xy(...o.past)));
      const left = out[0];
      if (!left) throw new Error("no ways out");
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          const tile = [OWN[0] + dx, OWN[1] + dz] as const;
          if (out.some((o) => o.tile[0] === tile[0] && o.tile[1] === tile[1])) continue;
          expect(runOut(y, at(y, ...xy(...tile)))).toBe(at(y, ...xy(...left.past)));
        }
    });
  }

  test("a run tapped from its middle tile is laid from past its middle way out, the creosote's, as Leaf lays it", async () => {
    const y = create({ seed: 5, tier: 7 });
    expect(build(y, STILL, ...xy(...OWN), 0, Infinity).ok).toBe(true);
    const middle = ways(0)[1];
    if (!middle) throw new Error("no middle way out");
    const fake = await opened(y, 10_000);
    S.finger = true;
    setTool(BELT);
    tapBelt(...xy(...middle.tile));
    tapBelt(...xy(middle.past[0] + 6, middle.past[1]));
    expect(S.run?.why).toBeNull();
    const first = S.run?.legs[0];
    expect(first ? [first.x, first.y] : null).toEqual(xy(...middle.past));
    expect(confirm()).toBe(true);
    await until(() => fake.leaf.posts >= 1);
    expect(S.world.kind[at(S.world, ...xy(...middle.past))]).toBe(BELT);
    expect(differences()).toBe(0);
    expect(encode(S.world)).toBe(encode({ ...fake.leaf.yard, seed: null }));
  });
});

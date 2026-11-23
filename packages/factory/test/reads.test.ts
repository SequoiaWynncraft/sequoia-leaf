/**
 * What a screen reads of a yard, the same in both: the route for a run of belt between any two
 * tiles, what every piece is doing in a sentence and how many it turns out a minute, and what
 * Leaf reads for the standings and the camp.
 */
import { describe, expect, test } from "bun:test";

import * as Y from "@sequoia-leaf/yard";

import * as F from "../src/index.ts";
import { Player, rng } from "./random.ts";
import { type Pair, pairOf } from "./sides.ts";

const yards = async (): Promise<[string, Pair][]> => {
  const names = ["small", "mid", "large"];
  const texts = await Promise.all(
    names.map((n) => Bun.file(new URL(`../../yard/src/yards/${n}.json`, import.meta.url)).text()),
  );
  return names.map((n, k): [string, Pair] => {
    const pair = pairOf(texts[k] ?? "");
    pair.run(2000, 2000);
    return [n, pair];
  });
};

/** What a status says, with things by name. */
const said = (s: Y.Status | F.Status | null): unknown =>
  s && {
    ...s,
    spare: typeof s.spare === "number" ? F.itemName(s.spare) : s.spare,
    missing: s.missing?.map((k) => (typeof k === "number" ? F.itemName(k) : k)),
  };

describe("what a screen reads", () => {
  test("every piece's status and rate, before and after random play", async () => {
    for (const [name, pair] of await yards())
      for (let round = 0; round < 2; round++) {
        const { yard, flat } = pair;
        for (let i = 0; i < yard.cells.length; i++) {
          expect(said(F.status(flat, i))).toEqual(said(Y.status(yard, i)));
          expect(F.rate(flat, i)).toBe(Y.rate(yard, i));
        }
        new Player(pair, 31 + round).play(150, name);
      }
  }, 30_000);

  test("the route between any two tiles, over ground and under it", async () => {
    let found = 0;
    for (const [name, pair] of await yards()) {
      const r = rng(name.length * 101);
      const { w, h } = pair.yard.land;
      for (let k = 0; k < 300; k++) {
        const from = [Math.floor(r() * w), Math.floor(r() * h)] as const;
        const to = [Math.floor(r() * w), Math.floor(r() * h)] as const;
        const tunnels = r() < 0.7;
        const a = Y.route(pair.yard, from, to, { tunnels });
        const b = F.route(pair.flat, from, to, { tunnels });
        expect(b?.map((l) => ({ kind: F.kindName(l.kind), x: l.x, y: l.y, dir: l.dir, span: l.span })) ?? null).toEqual(
          a,
        );
        if (a) found++;
      }
    }
    expect(found).toBeGreaterThan(100);
  }, 30_000);

  test("the standing, the awards, and what finished orders left in town", async () => {
    for (const [, pair] of await yards()) {
      expect(F.FACTORY.standing?.(pair.flat)).toEqual(Y.WORKS.standing?.(pair.yard));
      expect(F.FACTORY.awards?.(pair.flat)).toEqual(Y.WORKS.awards?.(pair.yard));
      expect(F.townGifts(pair.flat)).toEqual(Y.townGifts(pair.yard));
    }
  });
});

/**
 * The heart of it: today's yard and the flat yard, side by side, are the same game.
 */
import { describe, expect, test } from "bun:test";

import * as Y from "@sequoia-leaf/yard";
import { workingYard } from "@sequoia-leaf/yard/fixtures.ts";

import * as F from "../src/index.ts";
import { Player } from "./random.ts";
import { Pair, pairOf } from "./sides.ts";

const YARDS = ["small", "short", "mid", "large"] as const;
const yardText = (name: string): Promise<string> =>
  Bun.file(new URL(`../../yard/src/yards/${name}.json`, import.meta.url)).text();

describe("a new yard", () => {
  test("is the same yard in both, and stays so", () => {
    const pair = new Pair(Y.create({ seed: 7 }), F.create({ seed: 7 }));
    pair.same("new");
    pair.run(1000);
  });
});

describe("the reference yards", () => {
  for (const name of YARDS)
    test(`${name} reads into both as the same yard and runs 20,000 ticks the same`, async () => {
      const pair = pairOf(await yardText(name));
      pair.same(`${name} read`);
      pair.run(20_000, 100, name);
      expect(pair.compared).toBeGreaterThanOrEqual(201);
      // Standing orders filled on the way are handed over, the rest swapped, and it runs on.
      for (let round = 0; round < 3; round++) {
        const board = pair.yard.board.map((o) => ({ id: o.id, filled: Y.isFilled(o.want, o.filled) }));
        for (const o of board) pair.do({ do: o.filled ? "handOver" : "swap", order: o.id }, `${name} board`);
        pair.do({ do: "collect" }, `${name} collect`);
        pair.same(`${name} after the board`);
        pair.run(7000, 100, name);
      }
    });
});

describe("random play", () => {
  const starts: [string, () => Promise<Pair>][] = [
    ["a new yard", async () => new Pair(Y.create({ seed: 11 }), F.create({ seed: 11 }))],
    [
      "a yard twelve orders in",
      async () => new Pair(Y.create({ seed: 12, story: 12 }), F.create({ seed: 12, story: 12 })),
    ],
    [
      "a yard with the story done",
      async () => new Pair(Y.create({ seed: 13, story: 20 }), F.create({ seed: 13, story: 20 })),
    ],
    ["the mid yard", async () => pairOf(await yardText("mid"))],
    ["the large yard", async () => pairOf(await yardText("large"))],
    ["today's working yard", async () => pairOf(Y.save(workingYard(5)))],
  ];
  for (const [name, start] of starts)
    for (const seed of [1, 2, 3])
      test(`${name}, seed ${seed}: the same refusals, the same Coins, the same yards`, async () => {
        const pair = await start();
        new Player(pair, seed * 7919 + name.length).play(800, `${name} seed ${seed}`);
        expect(pair.commands).toBe(800);
      });
});

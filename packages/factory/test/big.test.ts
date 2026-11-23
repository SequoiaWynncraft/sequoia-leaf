/**
 * A working yard of about 6,000 pieces on 112 by 84 tiles, made by the scale study's generator with
 * commands on the flat rules, built again by the same commands on today's rules and compared after
 * every one of them, then run 3,000 ticks the same.
 */
import { expect, test } from "bun:test";

import * as Y from "@sequoia-leaf/yard";

import * as F from "../src/index.ts";
import { type Gen, generate } from "./gen.ts";
import { makeLand } from "./land.ts";
import { expectSame, landOf, Pair } from "./sides.ts";

const land = makeLand(7, 7, 7);
const flatLand = landOf(land);
let made: Gen | null = null;
const gen = (): Gen => (made ??= generate(flatLand, 6000));

test("the generated yard, built by the same commands on today's rules and compared after every one, is the yard the generator made, and runs 3,000 ticks the same", () => {
  const g = gen();
  // After every command each yard's power and plumbing are compared as it holds them; worked out
  // afresh on copies where it holds none, after every thousandth (each costs about a millisecond).
  const pair = new Pair(
    Y.create({ land, story: 20, seed: 1758855484 }),
    F.create({ land: flatLand, story: 20, seed: 1758855484 }),
    { copiesEvery: 1000 },
  );
  const t0 = performance.now();
  g.commands.forEach((c, k) => pair.do(c, `command ${k}`));
  expect(pair.compared).toBe(g.commands.length);
  expect(pair.commands).toBeGreaterThan(50_000);
  expectSame(pair.yard, g.y, { kept: true });
  pair.run(3000, 100, "running");
  console.log(
    `${pair.commands} commands, compared after each, and ${pair.ticks} ticks: ${(performance.now() - t0).toFixed(0)} ms`,
  );
}, 120_000);

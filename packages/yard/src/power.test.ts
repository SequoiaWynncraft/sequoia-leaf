import { describe, expect, test } from "bun:test";

import { bare, workingYard } from "./fixtures.ts";
import { repower } from "./power.ts";
import { reopen, type World } from "./world.ts";

/** FNV-1a over which tiles have power. */
const hash = (power: Uint8Array): number => power.reduce((h, p) => Math.imul(h ^ p, 16777619), 2166136261) >>> 0;

/** The same yard with taller pylons, whether or not the story has opened them yet. */
function tall(w: World): World {
  w.plans.push("tallpylons");
  reopen(w);
  repower(w);
  return w;
}

describe("where power reaches", () => {
  // Measured when distances were still taken with Math.hypot, before they were compared as squares.
  test("each fixture yard's power map is as it was, with and without taller pylons", () => {
    expect([bare, workingYard].map((make) => [hash(make().power), hash(tall(make()).power)])).toEqual([
      [1074620613, 1074620613],
      [1159396729, 1927558942],
    ]);
  });
});

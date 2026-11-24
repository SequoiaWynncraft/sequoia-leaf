import { expect, test } from "bun:test";

import { makeGround } from "@sequoia-leaf/town/map/grid.ts";

import { makeActor, seatFree } from "./actors.ts";
import { makeApart } from "./crowd.ts";
import type { Actor, Seat } from "./game.ts";

test("whoever a place draws apart is who its seats are kept from: in a camp, the players live in it too", () => {
  const ground = makeGround(16, 16, () => 9);
  const there: Actor[] = [];
  makeApart(ground, () => there);
  const log: Seat = { x: 40, y: 40, dir: 0, from: { x: 40, y: 49 }, at: "fire", taken: false };
  expect(seatFree(log, null, ground)).toBe(true);
  // Somebody live in the camp sits there; the seat's own `taken` knows nothing of them.
  there.push(makeActor({ name: "Pipwick", rank: "", level: 1, voice: 1 }, null, 40, 40, false));
  expect(seatFree(log, null, ground)).toBe(false);
});

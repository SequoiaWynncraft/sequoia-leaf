import { describe, expect, test } from "bun:test";

import {
  allReached,
  boxOf,
  type Camp,
  canPlace,
  CGH,
  CGW,
  COSY,
  freeSpot,
  KIND,
  newCamp,
  petsOf,
  taken,
  trayList,
  turned,
} from "./camp.ts";
import { isThing, thingOf, THINGS, turnsOf } from "./things.ts";

const fresh = (): Camp => newCamp();
const at = (camp: Camp, id: string) => camp.placed.find((p) => p.id === id);
const add = (camp: Camp, id: string, x: number, y: number): number => {
  const n = camp.placed.length + 100;
  camp.placed.push({ n, id, x, y, t: 0, s: 0 });
  return n;
};

describe("setting things down", () => {
  test("nothing goes on top of another thing, in the trees, or on the trail", () => {
    const camp = fresh();
    const fire = at(camp, "fire-ring");
    if (!fire) throw new Error("no fire");
    expect(canPlace(camp.placed, "stump", fire.x, fire.y, 0)).toBe("taken");
    expect(canPlace(camp.placed, "stump", 1, 1, 0)).toBe("off");
    expect(canPlace(camp.placed, "stump", 45, 26, 0)).toBe("trail");
    // A rug may lie under a seat, but not under another rug.
    expect(canPlace(camp.placed, "rug-moss", fire.x + 5, fire.y, 0)).toBe("ok");
  });

  test("nothing may shut the cabin, the mailbox or the signpost in", () => {
    const camp = fresh();
    const box = at(camp, "mailbox");
    const cabin = at(camp, "cabin");
    if (!box || !cabin) throw new Error("no mailbox");
    add(camp, "stump", box.x - 1, box.y);
    add(camp, "stump", box.x + 1, box.y);
    add(camp, "stump", box.x, box.y - 1);
    expect(allReached(camp.placed)).toBe(true);
    expect(canPlace(camp.placed, "stump", box.x, box.y + 1, 0)).toBe("shut");
    // The cabin wants the square before its door.
    expect(canPlace(camp.placed, "stump", cabin.x + 6, cabin.y + 3, 0)).toBe("shut");
  });

  test("an arch and a string of lights stop a walker only at their ends", () => {
    const on = taken([{ id: "arch", x: 20, y: 30, t: 0 }]);
    expect([20, 21, 22].map((x) => on.solid[30 * CGW + x])).toEqual([1, 0, 1]);
    expect([20, 21, 22].map((x) => on.stand[30 * CGW + x])).toEqual([0, 0, 0]);
    expect(taken([]).solid.length).toBe(CGW * CGH);
  });

  test("turning lays a fence the other way about its middle, and leaves a mailbox alone", () => {
    const camp = fresh();
    const n = add(camp, "picket", 30, 31);
    const fence = turned(camp.placed, n);
    const thing = thingOf("picket");
    expect(fence?.t).toBe(1);
    expect(fence && thing && boxOf({ id: "picket", ...fence }, thing)).toEqual({ x0: 30, y0: 30, x1: 30, y1: 31 });
    expect(turned(camp.placed, at(camp, "mailbox")?.n ?? -1)).toBeNull();
    expect(turned(camp.placed, 999)).toBeNull();
  });

  test("every thing in the catalogue can stand somewhere in an empty yard, every way round", () => {
    for (const t of THINGS)
      for (let turn = 0; turn < turnsOf(t); turn++) expect(freeSpot([], t.id, { x: 24, y: 24 }, turn)).not.toBeNull();
    expect(isThing("cabin")).toBe(true);
  });

  test("the tray is listed in the catalogue's order", () => {
    expect(trayList({ tray: { stump: 1, "log-seat": 2 } })).toEqual([
      { id: "log-seat", n: 2 },
      { id: "stump", n: 1 },
    ]);
  });
});

describe("who lives in a camp", () => {
  test("the first pet is the one chosen, and nobody before", () => {
    const camp = fresh();
    expect(petsOf(camp)).toEqual([]);
    camp.first = "cat";
    expect(petsOf(camp)).toEqual(["cat"]);
  });

  test("a cosy camp brings a second, and greeting three of the town's callers a third", () => {
    const camp = fresh();
    camp.first = "fox";
    while (camp.placed.length < COSY) {
      const spot = freeSpot(camp.placed, "stump", { x: 30, y: 32 });
      if (!spot) throw new Error("no room");
      add(camp, "stump", spot.x, spot.y);
    }
    expect(petsOf(camp)).toEqual(["fox", "glorp"]);
    camp.greeted = KIND;
    expect(petsOf(camp)).toEqual(["fox", "glorp", "cat"]);
  });

  test("greeting brings the next in line even before the camp is cosy", () => {
    const camp = fresh();
    camp.first = "cat";
    camp.greeted = KIND;
    expect(petsOf(camp)).toEqual(["cat", "glorp"]);
  });
});

import { describe, expect, test } from "bun:test";

import {
  at,
  build,
  coreAt,
  COST,
  create,
  type Item,
  load,
  ORDERS,
  remove,
  repower,
  save,
  step,
  TICKS,
  type World,
} from "./sim.ts";

/** A bare plot with money to spare and deposits where a test wants them. */
const plot = (dep: Record<string, Item> = {}): World => {
  const w = create(24, 12);
  w.deposit.fill(null);
  w.coins = 10_000;
  w.unlocked.push("assembler", "splitter");
  for (const [k, item] of Object.entries(dep)) {
    const [x, y] = k.split(",").map(Number);
    w.deposit[at(w, x!, y!)] = item;
  }
  return w;
};
const run = (w: World, ticks: number): void => {
  for (let i = 0; i < ticks; i++) step(w);
};

describe("carrying", () => {
  test("a miner's wood rides a belt into the depot and is paid for", () => {
    const w = plot({ "7,6": "wood" });
    const [cx] = coreAt(w);
    build(w, "miner", 7, 6, 0);
    for (let x = 8; x < cx - 1; x++) build(w, "belt", x, 6, 0);
    const before = w.coins;
    run(w, 200);
    expect(w.depot.wood ?? 0).toBeGreaterThan(10);
    expect(w.coins).toBe(before + (w.depot.wood ?? 0));
  });
  test("a thing on a belt takes its time: one tile every few ticks, never further", () => {
    const w = plot();
    for (let x = 2; x < 8; x++) build(w, "belt", x, 2, 0);
    w.cells[at(w, 2, 2)]!.item = "ore";
    run(w, TICKS.belt * 3);
    const where = [2, 3, 4, 5, 6, 7].find((x) => w.cells[at(w, x, 2)]!.item);
    expect(where).toBe(5);
  });
  test("a full belt moves as one and loses nothing", () => {
    const w = plot();
    for (let x = 2; x < 9; x++) build(w, "belt", x, 2, 0);
    for (let x = 2; x < 8; x++) Object.assign(w.cells[at(w, x, 2)]!, { item: "ore", prog: 1 });
    step(w);
    expect([2, 3, 4, 5, 6, 7, 8].map((x) => (w.cells[at(w, x, 2)]!.item ? 1 : 0)).join("")).toBe("0111111");
  });
  test("two belts facing each other pass nothing", () => {
    const w = plot();
    build(w, "belt", 2, 2, 0);
    build(w, "belt", 3, 2, 2);
    Object.assign(w.cells[at(w, 2, 2)]!, { item: "ore", prog: 1 });
    run(w, 20);
    expect(w.cells[at(w, 2, 2)]!.item).toBe("ore");
  });
  test("a splitter shares what it gets between its ways out", () => {
    const w = plot({ "2,5": "ore" });
    w.power.fill(1);
    build(w, "miner", 2, 5, 0);
    build(w, "belt", 3, 5, 0);
    build(w, "splitter", 4, 5, 0);
    for (let x = 5; x < 9; x++) build(w, "belt", x, 5, 0);
    for (let y = 4; y > 0; y--) build(w, "belt", 4, y, 3);
    for (let y = 6; y < 10; y++) build(w, "belt", 4, y, 1);
    run(w, 400);
    const count = (cells: [number, number][]): number => cells.filter(([x, y]) => w.cells[at(w, x, y)]!.item).length;
    expect(
      count([
        [5, 5],
        [6, 5],
        [7, 5],
        [8, 5],
      ]),
    ).toBeGreaterThan(0);
    expect(
      count([
        [4, 4],
        [4, 3],
        [4, 2],
        [4, 1],
      ]),
    ).toBeGreaterThan(0);
    expect(
      count([
        [4, 6],
        [4, 7],
        [4, 8],
        [4, 9],
      ]),
    ).toBeGreaterThan(0);
  });
});

describe("making", () => {
  test("a refinery turns wood to planks, and an assembler planks and ingots to tools", () => {
    const w = plot({ "3,2": "wood", "3,4": "ore" });
    w.power.fill(1);
    build(w, "miner", 3, 2, 0);
    build(w, "refinery", 4, 2, 0);
    build(w, "belt", 5, 2, 1);
    build(w, "miner", 3, 4, 0);
    build(w, "refinery", 4, 4, 0);
    build(w, "belt", 5, 4, 3);
    build(w, "assembler", 5, 3, 0);
    for (let x = 6; x < 10; x++) build(w, "belt", x, 3, 0);
    run(w, 400);
    expect([6, 7, 8, 9].some((x) => w.cells[at(w, x, 3)]!.item === "tool")).toBe(true);
  });
  test("a machine without power does nothing; a pylon joined to the depot gives it power", () => {
    const w = plot({ "1,1": "wood" });
    build(w, "miner", 1, 1, 0);
    build(w, "belt", 2, 1, 0);
    run(w, 100);
    expect(w.cells[at(w, 2, 1)]!.item).toBeNull();
    const [cx, cy] = coreAt(w);
    build(w, "pylon", cx - 7, cy - 3, 0);
    build(w, "pylon", 3, 2, 0);
    expect(w.power[at(w, 1, 1)]).toBe(1);
    run(w, 100);
    expect(w.cells[at(w, 2, 1)]!.item).toBe("wood");
  });
  test("a pylon on its own, out of reach of the depot, carries nothing", () => {
    const w = plot();
    build(w, "pylon", 1, 1, 0);
    repower(w);
    expect(w.power[at(w, 1, 2)]).toBe(0);
  });
});

describe("building", () => {
  test("building costs coins, removing gives them back, and the depot stays", () => {
    const w = plot({ "2,2": "ore" });
    const before = w.coins;
    expect(build(w, "miner", 2, 2, 0)).toBe(true);
    expect(w.coins).toBe(before - COST.miner);
    expect(remove(w, 2, 2)).toBe(true);
    expect(w.coins).toBe(before);
    const [cx, cy] = coreAt(w);
    expect(remove(w, cx, cy)).toBe(false);
  });
  test("a miner needs a deposit, nothing is built on something else, and nothing without the coins", () => {
    const w = plot({ "2,2": "ore" });
    expect(build(w, "miner", 3, 3, 0)).toBe(false);
    build(w, "pylon", 4, 4, 0);
    expect(build(w, "refinery", 4, 4, 0)).toBe(false);
    w.coins = 0;
    expect(build(w, "miner", 2, 2, 0)).toBe(false);
  });
  test("a belt laid over a belt turns it and costs nothing", () => {
    const w = plot();
    build(w, "belt", 2, 2, 0);
    const coins = w.coins;
    expect(build(w, "belt", 2, 2, 1)).toBe(true);
    expect(w.cells[at(w, 2, 2)]!.dir).toBe(1);
    expect(w.coins).toBe(coins);
  });
});

describe("orders", () => {
  test("filling an order pays, unlocks what it promised and brings the next", () => {
    const w = create();
    const [cx, cy] = coreAt(w);
    const feed = at(w, cx - 2, cy);
    w.cells[feed] = { kind: "belt", dir: 0, item: null, prog: 0, buf: {}, out: null, work: 0, turn: 0 };
    const coins = w.coins;
    for (let k = 0; k < 12; k++) {
      Object.assign(w.cells[feed]!, { item: "plank", prog: 1 });
      step(w);
    }
    expect(w.order).toBe(1);
    expect(w.coins).toBe(coins + 12 * 3 + ORDERS[0]!.pay);
    for (const item of ["ingot", "brick"] as const)
      for (let k = 0; k < 12; k++) {
        Object.assign(w.cells[feed]!, { item, prog: 1 });
        step(w);
      }
    expect(w.order).toBe(2);
    expect(w.unlocked).toContain("assembler");
  });
  test("a new plot can afford its first line, and wood is within the depot's power", () => {
    const w = create();
    const wood = w.deposit.findIndex((d, i) => d === "wood" && w.power[i]);
    expect(wood).toBeGreaterThanOrEqual(0);
    expect(w.coins).toBeGreaterThanOrEqual(COST.miner * 2 + COST.refinery + COST.belt * 12);
  });
});

test("a factory comes back from its save as it was", () => {
  const w = plot({ "2,2": "ore" });
  build(w, "miner", 2, 2, 0);
  build(w, "pylon", 6, 6, 0);
  run(w, 37);
  const back = load(save(w))!;
  expect(back.cells).toEqual(w.cells);
  expect([...back.power]).toEqual([...w.power]);
  expect(load("{nonsense")).toBeNull();
});

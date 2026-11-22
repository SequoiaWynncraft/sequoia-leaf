import { describe, expect, test } from "bun:test";

import { buyPlan, setOpen, setRecipe } from "./build.ts";
import { boost } from "./clock.ts";
import { create } from "./create.ts";
import { belts, on, put, steps, workingYard } from "./fixtures.ts";
import { deliver } from "./orders.ts";
import { load, oldCoins, save, VERSION } from "./save.ts";
import { power } from "./step.ts";
import { at, type World } from "./world.ts";

/** A save with some of its parts changed, as text. */
const tampered = (w: World, change: (raw: Record<string, unknown>) => void): string => {
  const raw: unknown = JSON.parse(save(w));
  if (typeof raw !== "object" || raw === null) throw new Error("not a record");
  const rec: Record<string, unknown> = { ...raw };
  change(rec);
  return JSON.stringify(rec);
};
/** The kept buildings of a save, to add to or change. */
const cellsOf = (raw: Record<string, unknown>): unknown[] => {
  if (!Array.isArray(raw.cells)) throw new Error("no cells");
  return raw.cells;
};

describe("saving", () => {
  test("a yard comes back from its save as it was, and goes on exactly as it would have", () => {
    const w = workingYard();
    put(w, "splitter", 17, 13);
    put(w, "joiner", 18, 13);
    put(w, "crate", 19, 13);
    setOpen(w, 19, 13, false);
    setRecipe(w, 28, 17, "tool");
    boost(w, 1_800_000_000_000, 60_000);
    w.seen = 1_800_000_000_000;
    steps(w, 777);
    deliver(w, "pot", 40);
    const text = save(w);
    const back = load(text);
    if (!back) throw new Error("the yard did not come back");
    expect(save(back)).toBe(text);
    expect(back.cells).toEqual(w.cells.map((b) => (b ? { ...b, idle: false } : null)));
    expect([...back.power]).toEqual([...w.power]);
    expect(power(back)).toEqual(power(w));
    expect(back.rates).toEqual(w.rates);
    expect([...back.open.kinds].toSorted()).toEqual([...w.open.kinds].toSorted());
    for (const k of [
      "seed",
      "tick",
      "seen",
      "boostUntil",
      "till",
      "plots",
      "plans",
      "story",
      "filled",
      "board",
    ] as const)
      expect([k, back[k]]).toEqual([k, w[k]]);
    for (const k of ["serial", "done", "swapAt", "depot", "given", "sold", "paid", "pace"] as const)
      expect([k, back[k]]).toEqual([k, w[k]]);
    steps(w, 1234);
    steps(back, 1234);
    expect(save(back)).toBe(save(w));
  });
  test("a save carries its version, and a small yard is a small save", () => {
    const w = create();
    put(w, "belt", 20, 20);
    const raw: unknown = JSON.parse(save(w));
    expect(raw).toMatchObject({
      v: VERSION,
      story: 0,
      plots: ["yard"],
      cells: [{ i: at(w, 20, 20), k: "belt", d: 0 }],
    });
    expect(save(w).length).toBeLessThan(500);
    expect(save(workingYard()).length).toBeLessThan(6000);
  });
  test("what is not a yard is refused whole", () => {
    const w = workingYard();
    expect(load(null)).toBeNull();
    expect(load("")).toBeNull();
    expect(load("{nonsense")).toBeNull();
    expect(load("[]")).toBeNull();
    expect(load('"a yard"')).toBeNull();
    expect(load(tampered(w, (r) => (r.v = VERSION + 1)))).toBeNull();
    expect(load(tampered(w, (r) => delete r.v))).toBeNull();
    expect(load(tampered(w, (r) => (r.till = -5)))).toBeNull();
    expect(load(tampered(w, (r) => (r.till = "lots")))).toBeNull();
    expect(load(tampered(w, (r) => (r.tick = 1.5)))).toBeNull();
    expect(load(tampered(w, (r) => (r.story = 99)))).toBeNull();
    expect(load(tampered(w, (r) => (r.seen = null)))).toBeNull();
    expect(load(tampered(w, (r) => (r.cells = "all of them")))).toBeNull();
    expect(load(tampered(w, (r) => (r.cells = Array.from({ length: 5000 }, () => ({})))))).toBeNull();
    expect(load(tampered(w, (r) => delete r.plots))).toBeNull();
    expect(load(tampered(w, () => undefined))).not.toBeNull();
  });
  test("a plot, plan or machine the story has not reached is left out, and the rest is kept", () => {
    const w = create({ story: 2 });
    put(w, "gatherer", 20, 15);
    const back = load(
      tampered(w, (r) => {
        r.plots = ["yard", "pond", "meadow", "nowhere", 7];
        r.plans = ["jigs", "rakes", "wings"];
        cellsOf(r).push({ i: at(w, 21, 15), k: "workshop", d: 0 }, { i: at(w, 22, 15), k: "bench", d: 0 });
      }),
    );
    expect(back?.plots).toEqual(["yard"]);
    expect(back?.plans).toEqual([]);
    expect(back?.cells[at(w, 20, 15)]?.kind).toBe("gatherer");
    expect(back?.cells[at(w, 21, 15)]).toBeNull();
    expect(back?.cells[at(w, 22, 15)]?.kind).toBe("bench");
    // A plan whose earlier plan was never bought is left out too.
    const late = create({ story: 20 });
    expect(load(tampered(late, (r) => (r.plans = ["barrows", "waxed", "rollers"])))?.plans).toEqual([
      "waxed",
      "rollers",
    ]);
  });
  test("buildings that could not stand where they are said to are left out", () => {
    const w = create({ story: 20 });
    buyPlan(w, "tunnel", Infinity);
    put(w, "belt", 20, 20);
    const back = load(
      tampered(w, (r) => {
        cellsOf(r).push(
          { i: at(w, 21, 20), k: "gatherer", d: 0 },
          { i: at(w, 5, 5), k: "belt", d: 0 },
          { i: at(w, 24, 18), k: "belt", d: 0 },
          { i: at(w, 20, 20), k: "mill", d: 0 },
          { i: at(w, 22, 20), k: "wheel", d: 0 },
          { i: at(w, 23, 21), k: "depot", d: 0 },
          { i: at(w, 24, 21), k: "belt", d: 7 },
          { i: at(w, 25, 21), k: "kiln", d: 0 },
          { i: -3, k: "belt", d: 0 },
          { i: at(w, 20, 22), k: "tunnel", d: 0, s: -2 },
          { i: at(w, 26, 22), k: "tunnel", d: 0, s: 9 },
          "a belt",
          null,
        );
      }),
    );
    expect(back?.cells.filter((b) => b && b.kind !== "depot").length).toBe(1);
    expect(back?.cells[at(w, 20, 20)]?.kind).toBe("belt");
    expect(back?.cells[at(w, 24, 18)]?.kind).toBe("depot");
  });
  test("what a building holds is read back only as far as it could hold it", () => {
    const w = create({ story: 20 });
    buyPlan(w, "boiler", Infinity);
    put(w, "gatherer", 20, 15);
    put(w, "mill", 21, 15);
    put(w, "boiler", 21, 16);
    put(w, "crate", 21, 17);
    belts(w, 21, 18, 22, 18);
    const back = load(
      tampered(w, (r) => {
        for (const o of cellsOf(r)) {
          if (typeof o !== "object" || o === null) continue;
          Object.assign(o, {
            b: { ore: 99, plank: 2, crab: 1, deadfall: 40, moth: 3 },
            o: "crab",
            w: 1e9,
            m: "crab",
            t: 5,
          });
          Object.assign(o, { it: "glorp", p: -4, f: 1e6, r: "crab", u: ["ore"], up: [1] });
        }
      }),
    );
    if (!back) throw new Error("the yard did not come back");
    const mill = on(back, 21, 15);
    expect(mill.buf).toEqual({ ore: 4, deadfall: 4 });
    expect([mill.out, mill.work, mill.making, mill.recipe]).toEqual([null, 0, null, null]);
    expect(on(back, 20, 15)).toMatchObject({ out: null, work: 0, count: 0 });
    expect(on(back, 21, 16)).toMatchObject({ buf: { deadfall: 8 }, fuel: 0, count: 8 });
    expect(on(back, 21, 17).count).toBe(back.rates.crate);
    expect(on(back, 21, 17).out).toBe("crab");
    expect(on(back, 21, 18)).toMatchObject({ item: null, prog: 0, count: 0, turn: 0, under: [] });
    steps(back, 500);
  });
  test("a board that makes no sense is hung afresh, and one that does is kept as it was", () => {
    const w = create({ seed: 4, story: 8 });
    const first = w.board[0];
    if (!first) throw new Error("no board");
    deliver(w, "plank", 0);
    const good = load(save(w));
    expect(good?.board).toEqual(w.board);
    const bad = load(tampered(w, (r) => (r.board = [{ id: "one" }, 7, { ...first, want: {} }, first, first])));
    expect(bad?.board.length).toBe(3);
    expect(bad?.board[0]).toEqual(first);
    expect(bad?.board[1]).toEqual(first);
    expect(bad?.board[2]?.id).toBe(w.serial);
    // Before the story has put the board up, a saved board is not believed.
    const early = create({ story: 1 });
    expect(load(tampered(early, (r) => (r.board = [first])))?.board).toEqual([]);
  });
  test("a save from the yard before this one is not a yard, but its Coins can be carried over", () => {
    const old = JSON.stringify({
      w: 34,
      h: 22,
      deposit: [],
      cells: [null, { kind: "miner", dir: 0, item: null, prog: 0, buf: {}, out: null, work: 0, turn: 0 }],
      coins: 412.5,
      tick: 900,
      depot: { plank: 30 },
      order: 2,
      filled: {},
      unlocked: ["belt", "miner", "refinery", "pylon", "assembler"],
    });
    expect(load(old)).toBeNull();
    expect(oldCoins(old)).toBe(412);
    expect(oldCoins(save(create()))).toBeNull();
    expect(oldCoins("{nonsense")).toBeNull();
    expect(oldCoins(null)).toBeNull();
    expect(oldCoins(JSON.stringify({ cells: [], order: 1, coins: -9 }))).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";

import { buyPlan, paint, setOpen, setRecipe, setWay } from "./build.ts";
import { here } from "./clock.ts";
import { create } from "./create.ts";
import { belts, on, put, steps, workingYard } from "./fixtures.ts";
import { deliver } from "./orders.ts";
import { load, save, VERSION } from "./save.ts";
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
    // Colours: a splitter's own, a line's, and a line's through a tunnel.
    paint(w, 17, 13, 2);
    paint(w, 22, 15, 5);
    const mouth = w.cells.findIndex((b) => b?.kind === "tunnel");
    paint(w, mouth % w.land.w, Math.floor(mouth / w.land.w), 6);
    expect(w.cells.filter((b) => b && b.tint > 0).length).toBeGreaterThan(8);
    w.at = 1_800_000_000_000;
    Object.assign(w, { bank: 12, told: 3, away: { seconds: 900, coins: 41, made: { plank: 30 } } });
    steps(w, 777);
    w.seen = here(w);
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
      "at",
      "till",
      "bank",
      "told",
      "away",
      "seen",
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
  test("a save from before yards knew their owner's last command reads as last seen at its last tick", () => {
    const w = workingYard();
    steps(w, 500);
    const text = save(w);
    const without = text.replace(`,"seen":${JSON.stringify(w.seen)}`, "");
    expect(without).not.toContain("seen");
    expect(load(without)?.seen).toEqual(here(w));
  });
  test("a save from before belts had colours reads with none, and a colour that makes no sense is none", () => {
    const w = create();
    belts(w, 20, 20, 23, 20);
    put(w, "mill", 20, 22);
    paint(w, 20, 20, 4);
    /** The save with every kept building's colour made what `h` says for it. */
    const withColour = (h: (n: number) => unknown): string =>
      tampered(w, (r) => {
        cellsOf(r).forEach((c, n) => typeof c === "object" && Object.assign(c ?? {}, { h: h(n) }));
      });
    const old = load(withColour(() => undefined));
    expect(old?.cells.filter((b) => b && b.tint !== 0)).toEqual([]);
    const odd = load(withColour((n) => [7, "red", 1.5, -1, 3][n]));
    // The fifth is the mill, which has no colour to keep.
    expect(odd?.cells.filter((b) => b && b.tint !== 0)).toEqual([]);
    expect(load(save(w))?.cells.filter((b) => b?.tint === 4)).toHaveLength(4);
  });
  test("a save from before a splitter's ways could be shut reads with all open, at the same version", () => {
    const w = create({ story: 12 });
    put(w, "splitter", 20, 20);
    put(w, "joiner", 21, 22);
    const old = save(w);
    expect(old).not.toContain('"x"');
    expect(load(old)?.cells[at(w, 20, 20)]?.shut).toBe(0);
    setWay(w, 20, 20, 0, false);
    setWay(w, 20, 20, 2, false);
    expect(load(save(w))?.cells[at(w, 20, 20)]?.shut).toBe(5);
    expect(save(load(save(w)) ?? w)).toBe(save(w));
    // Shut ways that make no sense are none, and only a splitter has any.
    const odd = (x: unknown): (number | undefined)[] => {
      const back = load(tampered(w, (r) => cellsOf(r).forEach((c) => Object.assign(c ?? {}, { x }))));
      return [back?.cells[at(w, 20, 20)]?.shut, back?.cells[at(w, 21, 22)]?.shut];
    };
    expect([odd(8), odd("all"), odd(1.5), odd(3)]).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [3, 0],
    ]);
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
    expect(load(tampered(w, (r) => (r.at = null)))).toBeNull();
    expect(load(tampered(w, (r) => (r.seed = -1)))).toBeNull();
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
  test("a yard without its seed is kept without one, and hangs no order when read back", () => {
    const w = create({ seed: 4, story: 6 });
    w.board.splice(1, 1);
    const text = save({ ...w, seed: null });
    expect(JSON.parse(text)).not.toHaveProperty("seed");
    const back = load(text);
    expect(back?.seed).toBeNull();
    expect(back?.board.map((o) => o.id)).toEqual(w.board.map((o) => o.id));
    expect(load(save(w))?.board).toHaveLength(3);
  });
});

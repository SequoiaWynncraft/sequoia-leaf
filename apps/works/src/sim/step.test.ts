import { describe, expect, test } from "bun:test";

import { build, remove, setOpen, setRecipe } from "./build.ts";
import { ITEM, type Item, ITEMS } from "./content/items.ts";
import { BUFFER, CRATE, FUEL, KIND, TICKS } from "./content/machines.ts";
import { RECIPES } from "./content/recipes.ts";
import { bare, belts, lit, on, put, steps } from "./fixtures.ts";
import { DEPOT_SHARE } from "./orders.ts";
import { power } from "./step.ts";
import { at, put as hold, type World } from "./world.ts";

/** Sets a thing on a belt, already across its tile and ready to be handed on. */
const load = (w: World, x: number, y: number, item: Item): void => {
  Object.assign(on(w, x, y), { item, prog: 1 });
};
const taken = (w: World): number => ITEMS.reduce((sum, k) => sum + (w.depot[k] ?? 0), 0);

/**
 * Two belts kept full, ore from the west and stone from the north, meeting at (6, 3) and running
 * on to the depot. Four gatherers feed each, which is more than a belt can carry.
 */
function meeting(kind: "joiner" | "belt"): World {
  const ore = ["2,3", "4,2", "5,4", "3,4"];
  const stone = ["6,0", "7,1", "7,2", "5,2"];
  const w = bare(
    Object.fromEntries([...ore.map((k) => [k, "ore"] as const), ...stone.map((k) => [k, "stone"] as const)]),
    { h: 8 },
  );
  lit(w);
  belts(w, 3, 3, 5, 3);
  put(w, "gatherer", 2, 3, 0);
  put(w, "gatherer", 4, 2, 1);
  put(w, "gatherer", 5, 4, 3);
  put(w, "gatherer", 3, 4, 3);
  belts(w, 6, 1, 6, 2);
  put(w, "gatherer", 6, 0, 1);
  put(w, "gatherer", 7, 1, 2);
  put(w, "gatherer", 7, 2, 2);
  put(w, "gatherer", 5, 2, 0);
  put(w, kind, 6, 3, 0);
  belts(w, 7, 3, 10, 3);
  return w;
}
/** Twelve gatherers round the depot, feeding it straight, and as many idle mills as asked for. */
function ring(mills: number): World {
  const spots: [number, number, 0 | 1 | 2 | 3][] = [];
  for (const k of [-1, 0, 1]) spots.push([10, 6 + k, 0], [14, 6 + k, 2], [12 + k, 4, 1], [12 + k, 8, 3]);
  const w = bare(Object.fromEntries(spots.map(([x, y]) => [`${x},${y}`, "ore" as const])));
  for (const [x, y, dir] of spots) put(w, "gatherer", x, y, dir);
  for (let k = 0; k < mills; k++) put(w, "mill", 7 + (k % 2), 3 + Math.floor(k / 2));
  return w;
}

describe("carrying", () => {
  test("a gatherer's deadfall rides a belt into the depot, and the depot pays a little for it", () => {
    const w = bare({ "7,6": "deadfall" });
    put(w, "gatherer", 7, 6);
    belts(w, 8, 6, 10, 6);
    steps(w, 200);
    expect(w.depot.deadfall ?? 0).toBeGreaterThan(10);
    expect(w.till).toBeCloseTo((w.depot.deadfall ?? 0) * ITEM.deadfall.worth * DEPOT_SHARE, 6);
  });
  test("a thing on a belt takes its time: one tile every few ticks, never further", () => {
    const w = bare();
    belts(w, 2, 2, 7, 2);
    on(w, 2, 2).item = "ore";
    steps(w, TICKS.belt * 3);
    expect([2, 3, 4, 5, 6, 7].find((x) => on(w, x, 2).item)).toBe(5);
  });
  test("a full belt moves as one and loses nothing", () => {
    const w = bare();
    belts(w, 2, 2, 8, 2);
    for (let x = 2; x < 8; x++) load(w, x, 2, "ore");
    steps(w, 1);
    expect([2, 3, 4, 5, 6, 7, 8].map((x) => (on(w, x, 2).item ? 1 : 0)).join("")).toBe("0111111");
  });
  test("two belts facing each other pass nothing", () => {
    const w = bare();
    put(w, "belt", 2, 2, 0);
    put(w, "belt", 3, 2, 2);
    load(w, 2, 2, "ore");
    steps(w, 20);
    expect(on(w, 2, 2).item).toBe("ore");
  });
  test("a belt takes things from behind and from either side", () => {
    const w = bare({ "5,1": "ore", "5,3": "stone" });
    lit(w);
    put(w, "gatherer", 5, 1, 1);
    put(w, "gatherer", 5, 3, 3);
    belts(w, 5, 2, 9, 2);
    belts(w, 10, 2, 10, 5);
    put(w, "belt", 10, 6, 0);
    steps(w, 300);
    expect(w.depot.ore ?? 0).toBeGreaterThan(5);
    expect(w.depot.stone ?? 0).toBeGreaterThan(5);
  });
  test("a splitter takes in at the back and shares between its three ways out", () => {
    const w = bare({ "2,5": "ore" });
    lit(w);
    put(w, "gatherer", 2, 5);
    put(w, "belt", 3, 5);
    put(w, "splitter", 4, 5);
    belts(w, 5, 5, 8, 5);
    belts(w, 4, 4, 4, 1);
    belts(w, 4, 6, 4, 9);
    steps(w, 400);
    const count = (cells: [number, number][]): number => cells.filter(([x, y]) => on(w, x, y).item).length;
    expect(count([5, 6, 7, 8].map((x) => [x, 5]))).toBeGreaterThan(0);
    expect(count([4, 3, 2, 1].map((y) => [4, y]))).toBeGreaterThan(0);
    expect(count([6, 7, 8, 9].map((y) => [4, y]))).toBeGreaterThan(0);
  });
  test("a splitter takes nothing in at its sides", () => {
    const w = bare();
    put(w, "splitter", 4, 5, 0);
    put(w, "belt", 3, 5, 0);
    put(w, "belt", 4, 4, 1);
    load(w, 3, 5, "ore");
    load(w, 4, 4, "stone");
    steps(w, 1);
    expect(on(w, 4, 5).item).toBe("ore");
    steps(w, 40);
    expect(on(w, 4, 4).item).toBe("stone");
  });
});

describe("joiners", () => {
  test("a joiner takes from each line turn about, so two full lines each get half of the way out", () => {
    const w = meeting("joiner");
    steps(w, 3000);
    const ore = w.depot.ore ?? 0;
    const stone = w.depot.stone ?? 0;
    expect(ore + stone).toBeGreaterThan(700);
    expect(Math.abs(ore - stone)).toBeLessThanOrEqual(2);
  });
  test("a plain belt takes whichever comes first, and one full line can keep the other waiting", () => {
    const w = meeting("belt");
    steps(w, 3000);
    const ore = w.depot.ore ?? 0;
    const stone = w.depot.stone ?? 0;
    expect(Math.min(ore, stone)).toBeLessThan(Math.max(ore, stone) / 4);
  });
  test("a joiner with only one line coming does not wait for the others", () => {
    const w = bare({ "2,3": "ore" });
    lit(w);
    put(w, "gatherer", 2, 3);
    belts(w, 3, 3, 5, 3);
    put(w, "joiner", 6, 3);
    belts(w, 7, 3, 10, 3);
    belts(w, 11, 3, 11, 4);
    steps(w, 600);
    expect(w.depot.ore ?? 0).toBeGreaterThan(30);
  });
});

describe("tunnels", () => {
  test("a tunnel carries its line under another line, and both arrive", () => {
    const w = bare({ "2,3": "ore", "5,0": "stone" }, { h: 8 });
    lit(w);
    put(w, "gatherer", 2, 3);
    put(w, "belt", 3, 3);
    put(w, "tunnel", 4, 3, 0);
    belts(w, 7, 3, 10, 3);
    // The other line crosses over the top of it and comes to the depot a little further down.
    put(w, "gatherer", 5, 0, 1);
    belts(w, 5, 1, 5, 4);
    belts(w, 5, 5, 10, 5);
    expect(on(w, 4, 3).span).toBe(1);
    expect(on(w, 6, 3).span).toBe(-1);
    steps(w, 600);
    expect(w.depot.ore ?? 0).toBeGreaterThan(30);
    expect(w.depot.stone ?? 0).toBeGreaterThan(30);
  });
  test("a thing takes as long under the ground as it would on belts over the same tiles", () => {
    const over = bare({}, { h: 8 });
    const under = bare({}, { h: 8 });
    belts(over, 2, 2, 8, 2);
    put(under, "belt", 2, 2);
    put(under, "tunnel", 3, 2, 0, 3);
    put(under, "belt", 8, 2);
    over.cells[at(over, 2, 2)] = { ...on(over, 2, 2), item: "ore" };
    under.cells[at(under, 2, 2)] = { ...on(under, 2, 2), item: "ore" };
    for (let t = 0; t < 40; t++) {
      steps(over, 1);
      steps(under, 1);
      expect([t, on(under, 8, 2).item]).toEqual([t, on(over, 8, 2).item]);
    }
    expect(on(over, 8, 2).item).toBe("ore");
  });
  test("a full tunnel moves as one, a tile apart, and holds one thing for each tile it passes under", () => {
    const w = bare({ "1,2": "ore" }, { h: 8 });
    lit(w);
    put(w, "gatherer", 1, 2);
    put(w, "belt", 2, 2);
    put(w, "tunnel", 3, 2, 0, 3);
    put(w, "belt", 8, 2);
    steps(w, 400);
    // Nothing takes the last belt's ore, so the line has backed up through the tunnel.
    const mouth = on(w, 3, 2);
    expect(on(w, 8, 2).item).toBe("ore");
    expect(on(w, 7, 2).item).toBe("ore");
    expect(mouth.under).toEqual(["ore", "ore", "ore"]);
    expect(mouth.item).toBe("ore");
  });
  test("a tunnel goes under the stream and under a redwood, where nothing else can be built", () => {
    const w = bare({ "1,2": "ore" }, { h: 8, water: ["5,2", "6,2"], trunks: ["5,4"] });
    lit(w);
    expect(build(w, "belt", 5, 2, 0, 99)).toEqual({ ok: false, why: "The stream runs here" });
    expect(build(w, "belt", 5, 4, 0, 99)).toEqual({ ok: false, why: "A redwood stands here" });
    put(w, "gatherer", 1, 2);
    belts(w, 2, 2, 3, 2);
    // It comes up at the first clear tile past the water.
    expect(put(w, "tunnel", 4, 2, 0).span).toBe(2);
    belts(w, 8, 2, 10, 2);
    put(w, "belt", 11, 2, 1);
    steps(w, 400);
    expect(w.depot.ore ?? 0).toBeGreaterThan(20);
    expect(put(w, "tunnel", 4, 4, 0).span).toBe(1);
  });
  test("a tunnel is refused where it has nowhere to come up, both mouths go together, and both cost once", () => {
    const w = bare({}, { h: 8, water: ["4,2", "5,2", "6,2", "7,2"] });
    expect(build(w, "tunnel", 3, 2, 0, 99)).toEqual({
      ok: false,
      why: "A tunnel needs a clear tile to come up at, one to three tiles on",
    });
    expect(build(w, "tunnel", 3, 4, 0, 99, 3)).toEqual({ ok: true, cost: KIND.tunnel.cost });
    expect(on(w, 7, 4).span).toBe(-3);
    // From the far mouth too.
    expect(remove(w, 7, 4)).toEqual({ ok: true, refund: KIND.tunnel.cost });
    expect(w.cells[at(w, 3, 4)]).toBeNull();
    expect(w.cells[at(w, 7, 4)]).toBeNull();
  });
});

describe("crates", () => {
  test("a shut crate fills to the brim and stops the line; opened, it lets everything out again", () => {
    const w = bare({ "2,6": "deadfall" });
    lit(w);
    put(w, "gatherer", 2, 6);
    put(w, "belt", 3, 6);
    put(w, "crate", 4, 6);
    belts(w, 5, 6, 10, 6);
    expect(setOpen(w, 4, 6, false)).toBe(true);
    steps(w, 1000);
    expect(on(w, 4, 6).count).toBe(CRATE);
    expect(taken(w)).toBe(0);
    expect(on(w, 3, 6).item).toBe("deadfall");
    setOpen(w, 4, 6, true);
    remove(w, 2, 6);
    steps(w, 1000);
    expect(on(w, 4, 6).count).toBe(0);
    expect(taken(w)).toBe(CRATE + 1);
    expect(setOpen(w, 3, 6, false)).toBe(false);
  });
  test("a crate holds different things at once and lets out whatever it has most of", () => {
    const w = bare({});
    put(w, "belt", 3, 6);
    put(w, "crate", 4, 6);
    put(w, "belt", 5, 6);
    setOpen(w, 4, 6, false);
    for (const item of ["ore", "stone", "stone"] as const) {
      load(w, 3, 6, item);
      steps(w, 1);
    }
    expect(on(w, 4, 6).buf).toEqual({ ore: 1, stone: 2 });
    setOpen(w, 4, 6, true);
    steps(w, 1);
    expect(on(w, 5, 6).item).toBe("stone");
  });
});

describe("making", () => {
  for (const r of RECIPES)
    test(`${r.from.join(" and ")} make ${r.out === "oil" ? "lamp oil" : r.out} at a ${r.by}`, () => {
      const w = bare();
      // The machine stands by the depot and sends its work on to the east; things arrive from the other three sides.
      const b = put(w, r.by, 8, 5, 0);
      put(w, "belt", 9, 5, 1);
      const feeds = [
        [7, 5, 0],
        [8, 4, 1],
        [8, 6, 3],
      ] as const;
      r.from.forEach((item, k) => {
        const [x, y, dir] = feeds[k] ?? feeds[0];
        put(w, "belt", x, y, dir);
        load(w, x, y, item);
      });
      steps(w, r.ticks);
      expect(on(w, 9, 5).item).toBeNull();
      steps(w, 1);
      expect(on(w, 9, 5).item).toBe(r.out);
      expect(b.count).toBe(0);
    });
  test("a mill works on one thing at a time, by what arrives, and takes the next kind when it is done", () => {
    const w = bare();
    const mill = put(w, "mill", 8, 5, 0);
    put(w, "belt", 7, 5, 0);
    put(w, "belt", 9, 5, 0);
    load(w, 7, 5, "deadfall");
    steps(w, 1);
    load(w, 7, 5, "ore");
    steps(w, 5);
    expect(on(w, 7, 5).item).toBe("ore");
    expect(mill.buf.deadfall).toBe(1);
    steps(w, 10);
    expect(on(w, 7, 5).item).toBeNull();
    expect(mill.buf.ore).toBe(1);
    // It has no use for something already worked.
    load(w, 7, 5, "plank");
    steps(w, 60);
    expect(on(w, 7, 5).item).toBe("plank");
  });
  test("a machine keeps a few of each thing by it and no more", () => {
    const w = bare();
    const bench = put(w, "bench", 8, 5, 0);
    put(w, "belt", 7, 5, 0);
    for (let k = 0; k < BUFFER + 2; k++) {
      load(w, 7, 5, "plank");
      steps(w, 1);
    }
    expect(bench.buf.plank).toBe(BUFFER);
    expect(on(w, 7, 5).item).toBe("plank");
  });
  test("a bench takes whatever goes with what it holds, and can be told to make one thing only", () => {
    const w = bare();
    const bench = put(w, "bench", 8, 5, 0);
    put(w, "belt", 7, 5, 0);
    const offer = (item: Item): boolean => {
      load(w, 7, 5, item);
      steps(w, 1);
      const went = on(w, 7, 5).item === null;
      on(w, 7, 5).item = null;
      return went;
    };
    expect(offer("plank")).toBe(true);
    // Glass goes with nothing a plank does, and a lantern is not bench work at all.
    expect(offer("glass")).toBe(false);
    expect(offer("lantern")).toBe(false);
    expect(offer("pot")).toBe(true);
    // Now it holds a hamper's worth, and an ingot would make a third thing.
    expect(offer("ingot")).toBe(false);
    expect(setRecipe(w, 8, 5, "tool")).toBe(true);
    // The pot was no use for a tool and is gone.
    expect(bench.buf.pot ?? 0).toBe(0);
    expect(offer("brick")).toBe(false);
    expect(offer("ingot")).toBe(true);
    expect(setRecipe(w, 8, 5, "lantern")).toBe(false);
    expect(setRecipe(w, 8, 5, null)).toBe(true);
    expect(setRecipe(w, 7, 5, "tool")).toBe(false);
  });
  test("a machine with its way out blocked waits, and loses nothing", () => {
    const w = bare({ "8,5": "ore" });
    put(w, "gatherer", 8, 5, 0);
    put(w, "belt", 9, 5, 2);
    steps(w, 200);
    expect(on(w, 8, 5).out).toBe("ore");
    on(w, 9, 5).dir = 0;
    w.wire = null;
    steps(w, 1);
    expect(on(w, 9, 5).item).toBe("ore");
  });
});

describe("power", () => {
  test("a machine out of reach does nothing; a pylon joined to the depot brings it power", () => {
    const w = bare({ "1,1": "deadfall" });
    put(w, "gatherer", 1, 1);
    put(w, "belt", 2, 1);
    steps(w, 100);
    expect(on(w, 2, 1).item).toBeNull();
    expect(power(w).demand).toBe(0);
    put(w, "pylon", 5, 3);
    put(w, "pylon", 3, 2);
    expect(w.power[at(w, 1, 1)]).toBe(1);
    expect(power(w).demand).toBe(KIND.gatherer.draw);
    steps(w, 100);
    expect(on(w, 2, 1).item).toBe("deadfall");
  });
  test("a pylon on its own, out of reach of the depot and of every joined pylon, carries nothing", () => {
    const w = bare({}, { w: 40 });
    put(w, "pylon", 1, 1);
    expect(w.power[at(w, 1, 2)]).toBe(0);
    // Taking away the pylon between cuts off the one beyond.
    put(w, "pylon", 8, 3);
    expect(w.power[at(w, 1, 2)]).toBe(0);
    put(w, "pylon", 14, 5);
    expect(w.power[at(w, 1, 2)]).toBe(1);
    remove(w, 8, 3);
    expect(w.power[at(w, 1, 2)]).toBe(0);
  });
  test("supply and demand are two numbers: what the depot gives, and what every machine in reach draws", () => {
    const w = bare({ "9,5": "ore" });
    expect(power(w)).toEqual({ supply: KIND.depot.gives, demand: 0, pace: 1 });
    put(w, "gatherer", 9, 5);
    put(w, "mill", 9, 6);
    put(w, "bench", 9, 7);
    put(w, "workshop", 8, 7);
    put(w, "belt", 8, 6);
    put(w, "crate", 8, 5);
    const draw = KIND.gatherer.draw + KIND.mill.draw + KIND.bench.draw + KIND.workshop.draw;
    expect(power(w)).toEqual({ supply: KIND.depot.gives, demand: draw, pace: 1 });
  });
  test("when demand passes supply everything slows by the same share, and nothing stops", () => {
    const enough = ring(0);
    const short = ring(14);
    expect(power(enough)).toEqual({ supply: 20, demand: 12, pace: 1 });
    expect(power(short)).toEqual({ supply: 20, demand: 40, pace: 0.5 });
    steps(enough, 200 * TICKS.gather);
    steps(short, 200 * TICKS.gather);
    expect(enough.depot.ore).toBe(2400);
    expect(short.depot.ore).toBe(1200);
    // A third over, a quarter slower: the same two hundred each take that much longer.
    const tight = ring(7);
    expect(power(tight).pace).toBeCloseTo(20 / 26, 9);
    steps(tight, 200 * TICKS.gather * 1.3 + 2);
    expect(tight.depot.ore).toBe(2400);
  });
  test("a waterwheel stands only beside the stream, and gives steady power once power reaches it", () => {
    const w = bare({}, { w: 40, water: ["30,5", "30,6", "30,7"] });
    expect(build(w, "wheel", 10, 6, 0, 999)).toEqual({ ok: false, why: "A waterwheel needs the stream beside it" });
    put(w, "wheel", 29, 6);
    expect(power(w).supply).toBe(KIND.depot.gives);
    put(w, "pylon", 26, 6);
    expect(power(w).supply).toBe(KIND.depot.gives + KIND.wheel.gives);
    put(w, "wheel", 31, 5);
    expect(power(w).supply).toBe(KIND.depot.gives + KIND.wheel.gives);
    put(w, "pylon", 30, 4);
    expect(power(w).supply).toBe(KIND.depot.gives + 2 * KIND.wheel.gives);
  });
  test("a boiler gives power while it is fed deadfall, burns a piece every two seconds, and takes nothing else", () => {
    const w = bare({ "8,6": "deadfall" });
    put(w, "gatherer", 8, 6, 0);
    const boiler = put(w, "boiler", 9, 6);
    expect(power(w).supply).toBe(KIND.depot.gives);
    // A gatherer brings it a little faster than it burns, so in time it is full.
    steps(w, 1200);
    expect(power(w).supply).toBe(KIND.depot.gives + KIND.boiler.gives);
    expect(boiler.buf.deadfall).toBe(FUEL);
    // Cut off, it burns what it holds and goes cold.
    remove(w, 8, 6);
    steps(w, FUEL * TICKS.burn);
    expect(power(w).supply).toBe(KIND.depot.gives + KIND.boiler.gives);
    steps(w, TICKS.burn);
    expect(power(w).supply).toBe(KIND.depot.gives);
    put(w, "belt", 8, 6, 0);
    load(w, 8, 6, "plank");
    steps(w, 20);
    expect(on(w, 8, 6).item).toBe("plank");
  });
  test("a boiler lifts a yard that was short of power back to its plain pace", () => {
    const w = ring(14);
    steps(w, 80 * TICKS.gather);
    expect(w.depot.ore).toBe(12 * 40);
    const boiler = put(w, "boiler", 16, 2);
    for (let k = 0; k < FUEL; k++) hold(boiler, "deadfall");
    steps(w, 10 * TICKS.gather);
    expect(power(w)).toEqual({ supply: 50, demand: 40, pace: 1 });
    expect(w.depot.ore).toBe(12 * 40 + 12 * 10);
  });
});

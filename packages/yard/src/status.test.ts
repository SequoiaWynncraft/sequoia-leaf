import { describe, expect, test } from "bun:test";

import { setOpen, setRecipe, tipOut } from "./build.ts";
import { bare, lit, on, put, steps } from "./fixtures.ts";
import { aim, holding, rate, status } from "./status.ts";
import { at, put as hold, type World } from "./world.ts";

const of = (w: World, x: number, y: number): ReturnType<typeof status> => status(w, at(w, x, y));

describe("what a thing is doing", () => {
  test("a gatherer says what it gathers, and that it is short of power when the yard is", () => {
    const w = lit(bare({ "9,6": "ore" }));
    put(w, "gatherer", 9, 6);
    put(w, "belt", 10, 6);
    expect(of(w, 9, 6)).toEqual({ state: "working", line: "Gathering ore.", trouble: false });
    expect(rate(w, at(w, 9, 6))).toBe(40);
    for (let k = 0; k < 10; k++) put(w, "bench", 2 + k, 9);
    expect(of(w, 9, 6)?.line).toBe("Gathering ore, at 49% of its pace: the yard is short of power.");
    expect(rate(w, at(w, 9, 6))).toBeCloseTo(40 * (20 / 41), 6);
  });
  test("a machine out of reach of power says so", () => {
    const w = bare({ "1,1": "ore" });
    put(w, "gatherer", 1, 1);
    put(w, "mill", 2, 1);
    expect(of(w, 1, 1)).toEqual({
      state: "unpowered",
      line: "No power here. Place a pylon near it.",
      trouble: true,
    });
    expect(of(w, 2, 1)?.state).toBe("unpowered");
    expect(rate(w, at(w, 1, 1))).toBe(0);
    const pylon = put(w, "pylon", 0, 3);
    expect(pylon.kind).toBe("pylon");
    expect(of(w, 0, 3)?.trouble).toBe(true);
    put(w, "pylon", 6, 3);
    expect(of(w, 0, 3)).toEqual({ state: "giving", line: "Powers the tiles up to 4 tiles from it.", trouble: false });
    expect(of(w, 1, 1)?.state).toBe("working");
  });
  test("a machine with nowhere to send what it makes says which kind of nowhere", () => {
    const w = bare({ "8,5": "ore" });
    put(w, "gatherer", 8, 5, 0);
    steps(w, 30);
    expect(of(w, 8, 5)).toEqual({
      state: "blocked",
      line: "Nowhere to send its ore: nothing is on the tile it points at.",
      trouble: true,
    });
    put(w, "pylon", 9, 5);
    expect(of(w, 8, 5)?.line).toBe("The piece it points at does not take ore.");
    w.cells[at(w, 9, 5)] = null;
    w.wire = null;
    // A belt facing back at it will not take from it either; a belt that is only full is just a wait.
    put(w, "belt", 9, 5, 2);
    expect(of(w, 8, 5)?.state).toBe("blocked");
    on(w, 9, 5).dir = 1;
    w.wire = null;
    steps(w, 60);
    expect(on(w, 9, 5).item).toBe("ore");
    expect(of(w, 8, 5)).toEqual({
      state: "waiting",
      line: "Waiting: no room ahead for its ore.",
      trouble: false,
    });
    // And the belt that ends on bare ground is the one in trouble.
    expect(of(w, 9, 5)?.state).toBe("blocked");
  });
  test("a bench says what it is waiting for, and when it has filled up with the wrong part", () => {
    const w = lit(bare());
    const bench = put(w, "bench", 8, 5, 0);
    put(w, "belt", 9, 5, 0);
    expect(of(w, 8, 5)).toEqual({ state: "idle", line: "Waiting for items.", trouble: false });
    expect(aim(bench)).toBeNull();
    hold(bench, "plank");
    expect(aim(bench)?.out).toBe("tool");
    expect(of(w, 8, 5)).toEqual({
      state: "waiting",
      line: "Waiting for ingots to make tools.",
      trouble: false,
      missing: ["ingot"],
    });
    setRecipe(w, 8, 5, "hamper");
    expect(of(w, 8, 5)?.line).toBe("Waiting for pots to make hampers.");
    for (let k = 0; k < 3; k++) hold(bench, "plank");
    const jammed = of(w, 8, 5);
    expect(jammed?.state).toBe("starved");
    expect(jammed?.trouble).toBe(true);
    expect(jammed?.spare).toBe("plank");
    expect(jammed?.line).toBe(
      "Full of planks and waiting for pots. If both come in on one belt, the planks will be blocking it.",
    );
    // Tipping the spare out is the way to free it.
    expect(tipOut(w, 8, 5, jammed?.spare ?? null)).toBe(4);
    expect(of(w, 8, 5)?.line).toBe("Waiting for planks and pots to make hampers.");
    hold(bench, "plank");
    hold(bench, "pot");
    steps(w, 1);
    expect(of(w, 8, 5)).toEqual({ state: "working", line: "Making hampers.", trouble: false });
    expect(rate(w, at(w, 8, 5))).toBe(30);
    expect(holding(bench)).toBe("1 plank and 1 pot");
  });
  test("belts, crates, boilers, wheels and the depot each say their piece", () => {
    const w = lit(bare({ "3,3": "deadfall" }, { w: 40, water: ["30,5"] }));
    put(w, "belt", 5, 5, 0);
    expect(of(w, 5, 5)?.line).toBe("Empty.");
    Object.assign(on(w, 5, 5), { item: "plank", prog: 0.5 });
    expect(of(w, 5, 5)).toEqual({ state: "carrying", line: "Carrying planks.", trouble: false });
    on(w, 5, 5).prog = 1;
    expect(of(w, 5, 5)?.state).toBe("blocked");
    const crate = put(w, "crate", 6, 5, 0);
    expect(of(w, 5, 5)).toEqual({ state: "waiting", line: "Planks waiting to move on.", trouble: false });
    hold(crate, "pot");
    hold(crate, "pot");
    expect(of(w, 6, 5)?.line).toBe("Holds 2 of 32: 2 pots.");
    setOpen(w, 6, 5, false);
    expect(of(w, 6, 5)).toEqual({
      state: "shut",
      line: "Shut: it lets no items out. Holds 2 of 32: 2 pots.",
      trouble: false,
    });
    const boiler = put(w, "boiler", 4, 3);
    expect(of(w, 4, 3)?.state).toBe("cold");
    hold(boiler, "deadfall");
    hold(boiler, "deadfall");
    steps(w, 1);
    expect(of(w, 4, 3)?.line).toBe("Running. Makes 30 power. Holds 1 of 8 deadfall.");
    put(w, "wheel", 29, 5);
    expect(of(w, 29, 5)?.line).toBe("Running. Makes 10 power.");
    expect(of(w, 20, 6)?.line).toBe("Sells every item that reaches it. Makes 20 power.");
    expect(status(w, at(w, 1, 1))).toBeNull();
    expect(status(w, -1)).toBeNull();
  });
});

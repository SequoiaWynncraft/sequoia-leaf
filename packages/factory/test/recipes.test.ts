/**
 * Recipes that count: where every count is 1, as in every recipe a yard of tier 0 or 1 may make, a
 * machine works out what to make from what it holds as today's does; where a recipe takes 2 of a
 * part, a machine keeps 4 recipes' worth of each part by it, takes no more of one it has enough of,
 * and waits for the one it is short of. A recipe not unlocked is never set, never made, and its parts
 * are not taken in for it. How many of a part a recipe takes is read from the recipe.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { fill, idOf, learn } from "./goals.ts";
import { bareLand } from "./land.ts";
import { give, must } from "./yards.ts";

/**
 * A small yard, every goal of the tiers below `tier` done, with a machine of `kind` on (2, 4) facing
 * east, out of the depot's reach: it takes things in, and works only once it is given power (`power`).
 * A yard of tier 1 has done the node that unlocks the crate first, so that crates can offer the machine things.
 */
function machine(kind: F.Kind, tier = 4): { y: F.Yard; i: number; r: number } {
  const y = F.create({ land: bareLand(13, 9, [], [9, 4]), tier, seed: 1 });
  if (y.open.kinds[F.CRATE] === 0) {
    const crates = F.ALL_GOALS.find((g) => F.GOALS[g]?.unlocks.kinds?.includes("crate"));
    if (crates === undefined) throw new Error("nothing unlocks the crate");
    if (y.hand !== crates) must(y, { do: "take", node: idOf(crates) });
    fill(y);
  }
  expect(F.build(y, kind, 2, 4, 0, Infinity).ok).toBe(true);
  const i = F.at(y, 2, 4);
  return { y, i, r: y.row[i] ?? -1 };
}
/** A pylon that brings the machine into power's reach. */
const power = (y: F.Yard): void => expect(F.build(y, F.PYLON, 5, 4, 0, Infinity).ok).toBe(true);

/** Offers the machine `n` of a thing from a crate behind it, and says how many it took. */
function offer(y: F.Yard, thing: F.Item, n: number): number {
  expect(F.build(y, F.CRATE, 1, 4, 0, Infinity).ok).toBe(true);
  const c = y.row[F.at(y, 1, 4)] ?? -1;
  for (let k = 0; k < n; k++) F.put(y.holders, c, thing);
  for (let k = 0; k < 60; k++) F.step(y);
  const left = F.held(y.holders, c, thing) + (y.holders.out[c] === thing ? 1 : 0);
  expect(F.remove(y, 1, 4).ok).toBe(true);
  return n - left;
}

/** Runs the yard until the machine on row `r` has something made, and says what. */
function made(y: F.Yard, r: number): F.Item | null {
  for (let k = 0; k < 200 && y.holders.out[r] === F.NONE; k++) F.step(y);
  const out = y.holders.out[r] ?? F.NONE;
  return F.isItem(out) ? out : null;
}

const deadfall = F.item("deadfall");
const plank = F.item("plank");
const pot = F.item("pot");
const ingot = F.item("ingot");
const hamper = F.RECIPE[F.item("hamper")];
/** How many of a part a hamper takes, from its recipe. */
const need = (n: F.Item): number => (hamper ? F.needOf(hamper, n) : 0);

describe("in tiers 0 and 1, where every count is 1", () => {
  test("every recipe a yard of tier 0 or 1 may make takes one of each part", () => {
    for (const tier of [0, 1]) {
      const { open } = F.create({ tier });
      const counted = F.ALL_KINDS.flatMap((k) => F.recipesFor(open, k)).filter((r) => r.need.some((c) => c > 1));
      expect([open.tier, counted.map((r) => F.itemName(r.out))]).toEqual([tier, []]);
    }
  });

  test("in a new yard, a mill fed by a gatherer saws planks with nothing set, and keeps 4 deadfall by it while its way out is blocked", () => {
    const y = F.create({ land: bareLand(13, 9, [[1, 4, "deadfall"]], [9, 4]), seed: 1 });
    must(y, { do: "build", kind: "gatherer", x: 1, y: 4, dir: 0 });
    must(y, { do: "build", kind: "mill", x: 2, y: 4, dir: 0 });
    must(y, { do: "build", kind: "pylon", x: 4, y: 5, dir: 0 });
    const r = y.row[F.at(y, 2, 4)] ?? -1;
    for (let k = 0; k < 300; k++) F.step(y);
    expect([y.open.tier, y.holders.out[r], F.held(y.holders, r, deadfall)]).toEqual([0, plank, F.BUFFER]);
    must(y, { do: "lay", legs: [3, 4, 5, 6, 7].map((x) => ({ kind: "belt", x, y: 4, dir: 0, span: 0 })) });
    for (let k = 0; k < 600; k++) F.step(y);
    expect(y.set[F.at(y, 2, 4)]).toBe(F.NONE);
    expect(y.depot[plank]).toBeGreaterThan(30);
  });

  test("in a tier 1 yard, a bench makes whatever one recipe uses everything it holds, takes 4 of a part, and takes one kind of thing at a time", () => {
    const { y, r } = machine(F.BENCH, 1);
    expect(y.open.tier).toBe(1);
    expect(offer(y, plank, 9)).toBe(F.BUFFER);
    // No recipe takes a gear or a pot with a plank; then none takes a brick with a plank and an ingot.
    expect(offer(y, F.item("gear"), 1)).toBe(0);
    expect(offer(y, pot, 1)).toBe(0);
    expect(offer(y, ingot, 1)).toBe(1);
    expect(offer(y, F.item("brick"), 1)).toBe(0);
    power(y);
    expect(made(y, r)).toBe(F.item("tool"));
  });
});

describe("a recipe not unlocked", () => {
  test("is never set, never made, and its parts are not taken in: no lamp oil from resin before the oil press is known", () => {
    const { y, r } = machine(F.MILL, 3);
    const oil = F.item("oil");
    const resin = F.item("resin");
    expect(F.setRecipe(y, 2, 4, oil)).toBe("The recipe for lamp oil is not unlocked yet");
    expect(give(y, { do: "recipe", x: 2, y: 4, item: "oil" })).toMatchObject({ refused: "cannot_set_recipe" });
    expect(offer(y, resin, 4)).toBe(0);
    // A mill made to hold resin works nothing out of it.
    F.put(y.holders, r, resin);
    power(y);
    expect(made(y, r)).toBeNull();
    const press = F.ALL_GOALS.find((g) => F.GOALS[g]?.unlocks.recipes?.includes("oil"));
    if (press === undefined) throw new Error("nothing unlocks lamp oil");
    learn(y, press);
    expect(made(y, r)).toBe(oil);
    expect(offer(y, resin, 9)).toBe(F.BUFFER);
    expect(F.setRecipe(y, 2, 4, oil)).toBeNull();
  });
});

describe("where a recipe takes more than 1 of a part", () => {
  test("a bench told to make hampers keeps 4 hampers' worth of each part, and takes for each what the recipe counts", () => {
    expect(need(plank)).toBeGreaterThan(1);
    const { y, r } = machine(F.BENCH);
    expect(F.setRecipe(y, 2, 4, F.item("hamper"))).toBeNull();
    expect(offer(y, plank, 20)).toBe(F.BUFFER * need(plank));
    expect(offer(y, pot, 20)).toBe(F.BUFFER * need(pot));
    power(y);
    expect(made(y, r)).toBe(F.item("hamper"));
    expect([F.held(y.holders, r, plank), F.held(y.holders, r, pot)]).toEqual([
      (F.BUFFER - 1) * need(plank),
      (F.BUFFER - 1) * need(pot),
    ]);
  });

  test("full of the part it has enough of, it says which to tip out and which it waits for", () => {
    const { y, i } = machine(F.BENCH);
    expect(F.setRecipe(y, 2, 4, F.item("hamper"))).toBeNull();
    expect(offer(y, plank, F.BUFFER * need(plank))).toBe(F.BUFFER * need(plank));
    power(y);
    expect(F.status(y, i)).toMatchObject({ state: "starved", spare: plank, missing: [pot] });
  });

  test("with nothing set, a bench holding fewer planks than a hamper takes waits for the rest before it makes one", () => {
    const { y, i, r } = machine(F.BENCH);
    expect(offer(y, pot, need(pot))).toBe(need(pot));
    expect(offer(y, plank, need(plank) - 1)).toBe(need(plank) - 1);
    power(y);
    for (let k = 0; k < 100; k++) F.step(y);
    expect(y.holders.out[r]).toBe(F.NONE);
    expect(F.status(y, i)).toMatchObject({ state: "waiting", missing: [plank] });
    expect(offer(y, plank, 1)).toBe(1);
    expect(made(y, r)).toBe(F.item("hamper"));
  });

  test("tipping out the part it has enough of, or setting a recipe, is the way out of a jam", () => {
    const { y } = machine(F.BENCH);
    const full = F.BUFFER * need(plank);
    expect(F.setRecipe(y, 2, 4, F.item("hamper"))).toBeNull();
    expect(offer(y, plank, full)).toBe(full);
    expect(offer(y, plank, 1)).toBe(0);
    expect(F.tipOut(y, 2, 4, plank)).toBe(full);
    expect(offer(y, plank, full)).toBe(full);
    // Told to make tools instead, an ingot is taken and a pot is not.
    expect(F.setRecipe(y, 2, 4, F.item("tool"))).toBeNull();
    expect(offer(y, pot, 1)).toBe(0);
    expect(offer(y, ingot, 1)).toBe(1);
  });

  test("told to make something else, a full machine tips out what it holds beyond 4 of the new recipe's batches", () => {
    const tool = F.RECIPE[F.item("tool")];
    const forTools = F.BUFFER * (tool ? F.needOf(tool, plank) : 0);
    const full = F.BUFFER * need(plank);
    const { y, r } = machine(F.BENCH);
    expect(F.setRecipe(y, 2, 4, F.item("hamper"))).toBeNull();
    expect([offer(y, plank, full), offer(y, pot, F.BUFFER * need(pot))]).toEqual([full, F.BUFFER * need(pot)]);
    expect(F.setRecipe(y, 2, 4, F.item("tool"))).toBeNull();
    expect([F.held(y.holders, r, plank), F.held(y.holders, r, pot)]).toEqual([Math.min(full, forTools), 0]);
    // Told nothing, it keeps what any recipe it may make keeps: planks for a hamper.
    expect(F.setRecipe(y, 2, 4, F.item("hamper"))).toBeNull();
    expect(offer(y, plank, full)).toBe(full - Math.min(full, forTools));
    expect(F.setRecipe(y, 2, 4, null)).toBeNull();
    expect(F.held(y.holders, r, plank)).toBe(full);
  });
});

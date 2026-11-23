/**
 * Recipes that count: where every count is 1 a machine works out what to make from what it holds as
 * today's does; where a recipe takes 2 of a part, a machine keeps 4 recipes' worth of each part by
 * it, takes no more of one it has enough of, and waits for the one it is short of.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";

/**
 * A small yard, every goal of the tiers below 4 done, with a machine of `kind` on (2, 4) facing east,
 * out of the depot's reach: it takes things in, and works only once it is given power (`power`).
 */
function machine(kind: F.Kind): { y: F.Yard; i: number; r: number } {
  const y = F.create({ land: bareLand(13, 9, [], [9, 4]), tier: 4 });
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

const plank = F.item("plank");
const pot = F.item("pot");
const ingot = F.item("ingot");

describe("where every count is 1", () => {
  test("a mill fed deadfall saws planks with nothing set, and takes one kind of thing at a time", () => {
    const { y, r } = machine(F.MILL);
    expect(offer(y, F.item("deadfall"), 9)).toBe(F.BUFFER);
    expect(offer(y, F.item("stone"), 1)).toBe(0);
    power(y);
    expect(made(y, r)).toBe(plank);
    expect(F.held(y.holders, r, F.item("deadfall"))).toBe(F.BUFFER - 1);
  });

  test("a bench makes whatever one recipe uses everything it holds: a plank and an ingot make a tool", () => {
    const { y, r } = machine(F.BENCH);
    expect(offer(y, plank, 9)).toBe(F.BUFFER);
    // No recipe takes a gear with a plank; then none takes a brick with a plank and an ingot.
    expect(offer(y, F.item("gear"), 1)).toBe(0);
    expect(offer(y, ingot, 1)).toBe(1);
    expect(offer(y, F.item("brick"), 1)).toBe(0);
    power(y);
    expect(made(y, r)).toBe(F.item("tool"));
  });
});

describe("where a recipe takes 2 of a part", () => {
  test("a bench told to make hampers keeps 8 planks and 4 pots, and takes 2 planks and 1 pot for each", () => {
    const { y, r } = machine(F.BENCH);
    expect(F.setRecipe(y, 2, 4, F.item("hamper"))).toBe(true);
    expect(offer(y, plank, 20)).toBe(8);
    expect(offer(y, pot, 20)).toBe(4);
    power(y);
    expect(made(y, r)).toBe(F.item("hamper"));
    expect([F.held(y.holders, r, plank), F.held(y.holders, r, pot)]).toEqual([6, 3]);
  });

  test("full of the part it has enough of, it says which to tip out and which it waits for", () => {
    const { y, i } = machine(F.BENCH);
    expect(F.setRecipe(y, 2, 4, F.item("hamper"))).toBe(true);
    expect(offer(y, plank, 8)).toBe(8);
    power(y);
    expect(F.status(y, i)).toMatchObject({ state: "starved", spare: plank, missing: [pot] });
  });

  test("with nothing set, a bench holding one plank waits for a second before it makes a hamper", () => {
    const { y, i, r } = machine(F.BENCH);
    expect(offer(y, pot, 1)).toBe(1);
    expect(offer(y, plank, 1)).toBe(1);
    power(y);
    for (let k = 0; k < 100; k++) F.step(y);
    expect(y.holders.out[r]).toBe(F.NONE);
    expect(F.status(y, i)).toMatchObject({ state: "waiting", missing: [plank] });
    expect(offer(y, plank, 1)).toBe(1);
    expect(made(y, r)).toBe(F.item("hamper"));
  });

  test("tipping out the part it has enough of, or setting a recipe, is the way out of a jam", () => {
    const { y } = machine(F.BENCH);
    expect(F.setRecipe(y, 2, 4, F.item("hamper"))).toBe(true);
    expect(offer(y, plank, 8)).toBe(8);
    expect(offer(y, plank, 1)).toBe(0);
    expect(F.tipOut(y, 2, 4, plank)).toBe(8);
    expect(offer(y, plank, 8)).toBe(8);
    // Told to make tools instead, the planks stay, an ingot is taken and a pot is not.
    expect(F.setRecipe(y, 2, 4, F.item("tool"))).toBe(true);
    expect(offer(y, pot, 1)).toBe(0);
    expect(offer(y, ingot, 1)).toBe(1);
  });
});

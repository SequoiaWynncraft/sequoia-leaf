/**
 * How each thing is made. Every item that does not come from the ground has exactly one recipe:
 * what goes in (one of each), which machine does it, and how long that machine takes.
 */
import type { Item } from "./items.ts";
import { TICKS } from "./machines.ts";

/** The machines that make things: one thing in, two in, three in. */
export type Maker = "mill" | "bench" | "workshop";

export interface Recipe {
  readonly out: Item;
  readonly from: readonly Item[];
  readonly by: Maker;
  /** Ticks of work at the plain pace. Ten ticks are a second. */
  readonly ticks: number;
  /** For a mill, which of its faces the work shows: it saws, fires or presses by what arrives. */
  readonly face?: "saw" | "kiln" | "press";
}

export const RECIPES: readonly Recipe[] = [
  { out: "plank", from: ["deadfall"], by: "mill", ticks: 12, face: "saw" },
  { out: "brick", from: ["stone"], by: "mill", ticks: 12, face: "kiln" },
  { out: "ingot", from: ["ore"], by: "mill", ticks: 12, face: "kiln" },
  { out: "pot", from: ["clay"], by: "mill", ticks: 12, face: "kiln" },
  { out: "glass", from: ["sand"], by: "mill", ticks: 12, face: "kiln" },
  { out: "oil", from: ["resin"], by: "mill", ticks: 12, face: "press" },
  { out: "tool", from: ["plank", "ingot"], by: "bench", ticks: 20 },
  { out: "gear", from: ["ingot", "brick"], by: "bench", ticks: 20 },
  { out: "frame", from: ["plank", "brick"], by: "bench", ticks: 20 },
  { out: "hamper", from: ["plank", "pot"], by: "bench", ticks: 20 },
  { out: "shell", from: ["pot", "glass"], by: "bench", ticks: 20 },
  { out: "lantern", from: ["glass", "ingot", "oil"], by: "workshop", ticks: 30 },
  { out: "engine", from: ["tool", "gear"], by: "bench", ticks: 30 },
  { out: "pole", from: ["frame", "gear"], by: "bench", ticks: 30 },
  { out: "kit", from: ["tool", "lantern", "hamper"], by: "workshop", ticks: 40 },
  { out: "beacon", from: ["pole", "lantern", "engine"], by: "workshop", ticks: 80 },
  { out: "crab", from: ["engine", "shell", "lantern"], by: "workshop", ticks: 80 },
];

/** The recipe that makes each thing, the recipes each machine knows, and what a mill makes of each thing it is fed. */
export const RECIPE: Partial<Record<Item, Recipe>> = {};
export const MADE_BY: Record<Maker, Recipe[]> = { mill: [], bench: [], workshop: [] };
export const MILLED: Partial<Record<Item, Recipe>> = {};
for (const r of RECIPES) {
  RECIPE[r.out] = r;
  MADE_BY[r.by].push(r);
  const only = r.from[0];
  if (r.by === "mill" && only !== undefined) MILLED[only] = r;
}

/** Everything that goes into a thing, all the way down to the ground, the thing itself included. */
export function partsOf(item: Item): Item[] {
  return [item, ...(RECIPE[item]?.from ?? []).flatMap(partsOf)];
}

/**
 * The work in a thing: every tick a gatherer and every machine spends on one of it, all the way
 * down. Orders are sized and paid by it.
 */
export function workOf(item: Item): number {
  const r = RECIPE[item];
  return r ? r.ticks + r.from.reduce((sum, k) => sum + workOf(k), 0) : TICKS.gather;
}

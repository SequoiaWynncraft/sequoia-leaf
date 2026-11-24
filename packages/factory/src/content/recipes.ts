/**
 * How each thing is made. Every item that does not come from the ground has exactly one recipe:
 * what goes in and how many of each, which machine does it, and how long that machine takes to make
 * one.
 */
import type { ItemName, Wants } from "./items.ts";

/** The machines that make things: one thing in, two in, three in. */
export type Maker = "mill" | "bench" | "workshop";

export interface RecipeInfo {
  readonly out: ItemName;
  readonly from: Wants;
  readonly by: Maker;
  /** Ticks of work at grade 1. Ten ticks are a second. */
  readonly ticks: number;
  /** For a mill, which of its faces the work shows: it saws, fires or presses by what arrives. */
  readonly face?: "saw" | "kiln" | "press";
}

export const RECIPES: readonly RecipeInfo[] = [
  { out: "plank", from: { deadfall: 1 }, by: "mill", ticks: 12, face: "saw" },
  { out: "brick", from: { stone: 1 }, by: "mill", ticks: 12, face: "kiln" },
  { out: "ingot", from: { ore: 1 }, by: "mill", ticks: 12, face: "kiln" },
  { out: "pot", from: { clay: 1 }, by: "mill", ticks: 12, face: "kiln" },
  { out: "glass", from: { sand: 1 }, by: "mill", ticks: 12, face: "kiln" },
  { out: "oil", from: { resin: 1 }, by: "mill", ticks: 12, face: "press" },
  { out: "tool", from: { plank: 1, ingot: 1 }, by: "bench", ticks: 20 },
  { out: "gear", from: { ingot: 1, brick: 1 }, by: "bench", ticks: 20 },
  { out: "frame", from: { plank: 1, brick: 1 }, by: "bench", ticks: 20 },
  { out: "hamper", from: { plank: 2, pot: 1 }, by: "bench", ticks: 20 },
  { out: "shell", from: { pot: 1, glass: 2 }, by: "bench", ticks: 20 },
  { out: "lantern", from: { glass: 2, ingot: 1, oil: 1 }, by: "workshop", ticks: 30 },
  { out: "engine", from: { tool: 1, gear: 1 }, by: "bench", ticks: 30 },
  { out: "pole", from: { frame: 1, gear: 1 }, by: "bench", ticks: 30 },
  { out: "kit", from: { tool: 1, lantern: 1, hamper: 2 }, by: "workshop", ticks: 40 },
  { out: "beacon", from: { pole: 1, lantern: 1, engine: 1 }, by: "workshop", ticks: 80 },
  { out: "crab", from: { engine: 1, shell: 1, lantern: 1 }, by: "workshop", ticks: 80 },
  { out: "timber", from: { frame: 1, pot: 1 }, by: "bench", ticks: 30 },
  { out: "brass", from: { gear: 1, lantern: 1, ingot: 1 }, by: "workshop", ticks: 40 },
  // Tier 4's long works. Each is after every older recipe of its machine, so that a machine fed for
  // an older one goes on making it.
  { out: "pipe", from: { ingot: 2, oil: 1 }, by: "bench", ticks: 20 },
  { out: "firework", from: { pot: 1, oil: 1 }, by: "bench", ticks: 20 },
  { out: "spyglass", from: { pipe: 1, glass: 2 }, by: "bench", ticks: 30 },
  { out: "clock", from: { gear: 2, frame: 1, glass: 1 }, by: "workshop", ticks: 40 },
  { out: "orrery", from: { clock: 2, spyglass: 1, brass: 1 }, by: "workshop", ticks: 80 },
];

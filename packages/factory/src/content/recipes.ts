/**
 * How each thing is made. Every item that does not come from the ground has exactly one recipe:
 * what goes in and how many of each, which machine does it, and how long that machine takes to make
 * one.
 */
import type { ItemName, Wants } from "./items.ts";

/** The machines that make things: one thing in, two in, three in; and the cracker, which turns one of a still's things into the next lighter. */
export type Maker = "mill" | "bench" | "workshop" | "cracker";

export interface RecipeInfo {
  readonly out: ItemName;
  readonly from: Wants;
  readonly by: Maker;
  /** A by-product: one of it is made with every one of `out`, and leaves by its maker's own way out for it (`KindDef.ports`). */
  readonly also?: ItemName;
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
  // Tier 5, the wire: what is made of a breaker's copper and slag. Each is after every older recipe
  // of its machine, and no new one's parts are all found in another's of its machine.
  { out: "gravel", from: { slag: 1 }, by: "mill", ticks: 12, face: "press" },
  { out: "wire", from: { copper: 1 }, by: "mill", ticks: 12, face: "press" },
  { out: "coil", from: { wire: 2, ingot: 1 }, by: "bench", ticks: 20 },
  { out: "bulb", from: { wire: 1, glass: 1 }, by: "bench", ticks: 20 },
  { out: "spark", from: { coil: 1, bulb: 1, gear: 1 }, by: "workshop", ticks: 40 },
  { out: "telegraph", from: { coil: 2, bulb: 1, frame: 1 }, by: "workshop", ticks: 80 },
  { out: "lights", from: { bulb: 3, wire: 2, pole: 1 }, by: "workshop", ticks: 40 },
  // Tier 6, the still: a cracker turns pitch into creosote and creosote into spirit (a still makes all
  // three, and the planner plans creosote and spirit from it); a bench makes one good of each.
  { out: "creosote", from: { pitch: 2 }, by: "cracker", ticks: 10 },
  { out: "spirit", from: { creosote: 2 }, by: "cracker", ticks: 10 },
  { out: "tarmac", from: { gravel: 1, pitch: 1 }, by: "bench", ticks: 20 },
  { out: "sleeper", from: { plank: 2, creosote: 1 }, by: "bench", ticks: 20 },
  { out: "varnish", from: { spirit: 1, oil: 1 }, by: "bench", ticks: 20 },
  // Tier 7, the signal: what a grower is fed, and what star crystal is for. Star crystal itself has no
  // recipe: it lies in the ground, and a grower grows it (`grow.ts`).
  { out: "feed", from: { spirit: 1, glass: 1 }, by: "bench", ticks: 20 },
  { out: "lattice", from: { crystal: 2, wire: 1 }, by: "bench", ticks: 20 },
  { out: "star", from: { lattice: 1, coil: 1, varnish: 1 }, by: "workshop", ticks: 40 },
  { out: "dish", from: { lattice: 2, telegraph: 1, sleeper: 1 }, by: "workshop", ticks: 80 },
];

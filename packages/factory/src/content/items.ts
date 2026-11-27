/**
 * Everything the yard gathers and makes. Six things come from the ground, six are worked once,
 * six are put together, and five are goods the guild asks for by name; two are folios, which the
 * Study turns into research. Tier 4's long works add five more, none of them made with a lantern:
 * pipes and fireworks, spyglasses and clocks, and the orrery made of them. Tier 5 adds salvage from
 * the old workings and what a breaker breaks it into: copper and slag among things the yard already
 * makes; wire and gravel from those, coils and bulbs, the Spark folio, telegraphs and strings of
 * lights. Slag is the first thing the town does not buy (`unsold`). Nothing here fells a living
 * tree: wood is deadfall, picked up off the forest floor.
 *
 * A new thing goes at the end of the list: a thing riding a belt is kept by its place in it.
 */

export const RAW = ["deadfall", "stone", "ore", "clay", "sand", "resin"] as const;
export type RawName = (typeof RAW)[number];

export const ITEMS = [
  ...RAW,
  "plank",
  "brick",
  "ingot",
  "pot",
  "glass",
  "oil",
  "tool",
  "gear",
  "frame",
  "hamper",
  "shell",
  "lantern",
  "engine",
  "pole",
  "kit",
  "beacon",
  "crab",
  "timber",
  "brass",
  "pipe",
  "firework",
  "spyglass",
  "clock",
  "orrery",
  "salvage",
  "copper",
  "slag",
  "gravel",
  "wire",
  "coil",
  "bulb",
  "spark",
  "telegraph",
  "lights",
] as const;
export type ItemName = (typeof ITEMS)[number];

/** A count of things, by what they are. */
export type Wants = Partial<Record<ItemName, number>>;

export interface ItemInfo {
  readonly name: string;
  /** How a pile of them is spoken of: "12 planks", "40 lamp oil". */
  readonly many: string;
  /** How many machines deep it is: 0 from the ground, 4 for the two that take the whole yard. */
  readonly step: 0 | 1 | 2 | 3 | 4 | 5;
  /** What an order pays for one, in Coins. The depot pays a hundredth of it for anything that arrives. */
  readonly worth: number;
  /** A folio, which the Study takes in. */
  readonly folio?: true;
  /** The town does not buy it: the depot and cart stops do not take it, the board never asks for it, and it is worth nothing. */
  readonly unsold?: true;
  /** The work in one, in ticks, where the tables cannot work it out: a thing a mix gives (`mixes.ts`). */
  readonly work?: number;
}

export const ITEM: Record<ItemName, ItemInfo> = {
  deadfall: { name: "Deadfall", many: "deadfall", step: 0, worth: 0.1 },
  stone: { name: "Stone", many: "stone", step: 0, worth: 0.1 },
  ore: { name: "Ore", many: "ore", step: 0, worth: 0.1 },
  clay: { name: "Clay", many: "clay", step: 0, worth: 0.1 },
  sand: { name: "Sand", many: "sand", step: 0, worth: 0.1 },
  resin: { name: "Resin", many: "resin", step: 0, worth: 0.1 },
  plank: { name: "Plank", many: "planks", step: 1, worth: 0.3 },
  brick: { name: "Brick", many: "bricks", step: 1, worth: 0.3 },
  ingot: { name: "Ingot", many: "ingots", step: 1, worth: 0.3 },
  pot: { name: "Pot", many: "pots", step: 1, worth: 0.3 },
  glass: { name: "Glass", many: "glass", step: 1, worth: 0.3 },
  oil: { name: "Lamp oil", many: "lamp oil", step: 1, worth: 0.3 },
  tool: { name: "Tool", many: "tools", step: 2, worth: 1 },
  gear: { name: "Gear", many: "gears", step: 2, worth: 1 },
  frame: { name: "Frame", many: "frames", step: 2, worth: 1 },
  hamper: { name: "Hamper", many: "hampers", step: 2, worth: 1 },
  shell: { name: "Glazed shell", many: "glazed shells", step: 2, worth: 1 },
  lantern: { name: "Lantern", many: "lanterns", step: 2, worth: 1.6 },
  engine: { name: "Engine", many: "engines", step: 3, worth: 3 },
  pole: { name: "Banner pole", many: "banner poles", step: 3, worth: 3 },
  kit: { name: "Raid kit", many: "raid kits", step: 3, worth: 5 },
  beacon: { name: "Beacon", many: "beacons", step: 4, worth: 24 },
  crab: { name: "Clockwork crab", many: "clockwork crabs", step: 4, worth: 20 },
  timber: { name: "Timber folio", many: "Timber folios", step: 3, worth: 3, folio: true },
  brass: { name: "Brass folio", many: "Brass folios", step: 3, worth: 6, folio: true },
  pipe: { name: "Pipe", many: "pipes", step: 2, worth: 1 },
  firework: { name: "Firework", many: "fireworks", step: 2, worth: 1 },
  spyglass: { name: "Spyglass", many: "spyglasses", step: 3, worth: 3 },
  clock: { name: "Clock", many: "clocks", step: 3, worth: 4 },
  orrery: { name: "Orrery", many: "orreries", step: 4, worth: 30 },
  salvage: { name: "Salvage", many: "salvage", step: 0, worth: 0.1 },
  copper: { name: "Copper", many: "copper", step: 1, worth: 0.3, work: 21 },
  slag: { name: "Slag", many: "slag", step: 1, worth: 0, unsold: true, work: 21 },
  gravel: { name: "Gravel", many: "gravel", step: 2, worth: 0.3 },
  wire: { name: "Wire", many: "wire", step: 2, worth: 0.5 },
  coil: { name: "Coil", many: "coils", step: 3, worth: 1.7 },
  bulb: { name: "Bulb", many: "bulbs", step: 3, worth: 1.2 },
  spark: { name: "Spark folio", many: "Spark folios", step: 4, worth: 7, folio: true },
  telegraph: { name: "Telegraph", many: "telegraphs", step: 4, worth: 18 },
  lights: { name: "String of lights", many: "strings of lights", step: 4, worth: 21 },
};

/**
 * Everything the yard gathers and makes. Six things come from the ground, six are worked once,
 * six are put together, and five are goods the guild asks for by name. Nothing here fells a living
 * tree: wood is deadfall, picked up off the forest floor.
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
] as const;
export type ItemName = (typeof ITEMS)[number];

/** A count of things, by what they are. */
export type Wants = Partial<Record<ItemName, number>>;

export interface ItemInfo {
  readonly name: string;
  /** How a pile of them is spoken of: "12 planks", "40 lamp oil". */
  readonly many: string;
  /** How many machines deep it is: 0 from the ground, 4 for the two that take the whole yard. */
  readonly step: 0 | 1 | 2 | 3 | 4;
  /** What an order pays for one, in Coins. The depot pays a hundredth of it for anything that arrives. */
  readonly worth: number;
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
};

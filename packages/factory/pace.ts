/**
 * How long the slice takes: `bun pace.ts` (`--json` for the same as data, `--seed N` for another
 * land's orders). It plays tiers 0 to 3 of the second design from a new yard to the last goal of
 * tier 3, by the real rules, as one careful, ordinary player would (`pace/player.ts`), and prints
 * how long each goal and each tier took: building, waiting for Coins, waiting for deliveries.
 *
 * Everything the player decides by is below, as data: the order of goals, what it builds with what
 * it unlocks, and the seconds a person takes over each thing. Change them and run it again; the same
 * seed and the same numbers give the same table, to the tick.
 */
import { type Hands, Player, type Settings } from "./pace/player.ts";
import { report, text } from "./pace/table.ts";

/** The nodes in the order the player turns to them: lessons in theirs; in each tier the projects in the table's order, then the commission. */
export const NODES = [
  // Tier 0.
  "planks",
  "ingots",
  "tools",
  "gears",
  // Tier 1.
  "boiler",
  "crates",
  "culvert",
  "signs",
  "banners",
  // Tier 2.
  "stew",
  "chain",
  "drawing",
  "wax",
  "rakes",
  "hall",
  // Tier 3.
  "lanterns",
];

/** Research in the order of its table; each goes in the line as soon as what it needs is known, the line kept full. */
export const RESEARCH = [
  "oilpress",
  "workshop",
  "bigcrates",
  "tallpylons",
  "flywheel",
  "tooling",
  "sorter",
  "planchest",
  "carttrack",
  "nightshift",
  "upgrading",
  "brassfolio",
];

/**
 * The minutes of waiting a goal's lines are built for, by tier: a careful player builds enough to
 * see a goal done in a few minutes once its lines stand, and accepts longer as goals grow.
 */
export const MINUTES = [3, 8, 12, 15];

/** Folios a minute the Studies are built for: one Study at grade 1, fed flat out, as its card says (one every 5 seconds). */
export const FOLIOS = 12;

/**
 * What the player builds with what it unlocks: new pieces at the highest grade unlocked, up to
 * these (grade 2 belts and gatherers once the wax and the rakes are done, grade 2 machines once they
 * are researched). Power: before a goal's lines, boilers (a waterwheel when short by no more than
 * one gives) for whatever the yard would then draw beyond what it gives. It never tears anything
 * down, never builds for an order, and buys a plot only when the land has too little of what a line
 * gathers, or no room for it.
 */
export const GRADES = { belt: 2, tunnel: 2, gatherer: 2, mill: 2, bench: 2, workshop: 2, study: 1 } as const;
/** When a free swap is due, it swaps the order that would take longest to fill at what its lines bring the depot, if that is more than half an hour (an order nothing it has built brings, at once). */
export const SWAP = 30;
/** Coins to start with: a new player's, with nothing from the rest of the town. */
export const PURSE = 0;

/** Seconds of a person's time. */
export const HANDS: Hands = {
  /** A piece set down: pick it from the toolbar, tap the tile, turn it the right way. */
  piece: 4,
  /** Telling a bench what to make: open its card and tap the thing. */
  set: 3,
  /** A run of belt: two taps, a look at where the router took it; and each tile it crosses, dragged or checked. */
  run: 4,
  tile: 0.3,
  /** A plot bought: open the map, read what is in it and what it costs, buy. */
  plot: 15,
  /** Working out a new line: reading the card for how many of what, and choosing where it goes. */
  think: 45,
  /** Reading what a node or a piece of research says, and what it wants. */
  read: 15,
  /** Handing over a filled order, or swapping one: a tap on the board. */
  order: 3,
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--seed");
  const seed = at >= 0 ? Number(args[at + 1]) : 1;
  if (!Number.isInteger(seed) || seed < 0) throw new Error("--seed takes a whole number");
  const settings: Settings = {
    seed,
    nodes: NODES,
    research: RESEARCH,
    minutes: MINUTES,
    folios: FOLIOS,
    hands: HANDS,
    grades: GRADES,
    swap: SWAP,
    purse: PURSE,
  };
  const began = performance.now();
  const r = report(new Player(settings).play(), seed);
  console.log(args.includes("--json") ? JSON.stringify(r, null, 2) : text(r));
  console.error(`(played in ${((performance.now() - began) / 1000).toFixed(1)} s)`);
}

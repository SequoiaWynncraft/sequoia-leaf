/**
 * How long the slice takes: `bun pace.ts` (`--json` for the same as data, `--seed N` for another
 * land's orders, `--seeds 1-12` for the least, the middle and the most of each tier over those
 * seeds, `--folios N` for the folios a minute the Studies are built for). It plays the second design
 * from a new yard through every node below and every piece of research below, by the real rules, as
 * one careful, ordinary player would (`pace/player.ts`), and prints how long each goal and each tier
 * took: building, waiting for Coins, waiting for deliveries.
 *
 * Everything the player decides by is below, as data: the order of goals, what it builds with what
 * it unlocks, and the seconds a person takes over each thing. A new tier needs only its nodes and its
 * research added to the two lists (and, in `pace/table.ts`, the time it is meant to take). Change them
 * and run it again; the same seed and the same numbers give the same table, to the tick.
 */
import { type Hands, Player, type Settings } from "./pace/player.ts";
import { type Report, report, seeds, seedsText, text } from "./pace/table.ts";

/**
 * The nodes in the order the player turns to them: lessons in theirs; in each tier the projects in
 * the table's order, then the commission. It turns to the first not done that may be taken: one that
 * needs research waits for it, and a later one goes first meanwhile.
 */
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
  "windows",
  "shells",
  "hall",
  // Tier 3.
  "lanterns",
];

/**
 * Research in the order the player studies it, after what the nodes of the tiers open need (which
 * goes first, each piece after what it needs: `researchOrder`); each goes in the line as soon as it
 * may be studied, the line kept full, and moved ahead of what it comes before once it may be.
 */
export const RESEARCH = [
  // The machines that make lines quicker, then the rest in the table's order.
  "oilpress",
  "workshop",
  "tooling",
  "brassfolio",
  "flywheel",
  "sorter",
  "planchest",
  "carttrack",
  "upgrading",
  "nightshift",
];

/**
 * The minutes of waiting a goal's lines are built for, by tier: a careful player builds enough to
 * see a goal done in a few minutes once its lines stand, and accepts longer as goals grow. A tier
 * past the last here takes the last.
 */
export const MINUTES = [3, 8, 12, 15];

/**
 * Folios a minute the Studies are built for, of each kind of folio once research of an open tier
 * wants it, unless `--folios` says: two Studies at grade 1, each fed flat out (one every 5 seconds).
 */
export const FOLIOS = 24;

/**
 * What the player builds with what it unlocks: new pieces at the highest grade unlocked, up to
 * these (grade 2 belts and gatherers once the wax and the rakes are done, grade 2 machines once they
 * are researched). Power: after a goal's lines, boilers (a waterwheel when short by no more than
 * one gives, and the other where the one will not fit) for whatever the yard would then draw beyond
 * what it gives. It never builds for an order, and buys a plot only when the land has too little of
 * what a line gathers, or no room for it. Where greedy placing finds no room for a line, it plans
 * the line as a block (`pace/builder.ts`); a line it cannot do without that still fits nowhere is laid
 * where old lines stood, taking up those built for goals now finished, nearest first, as few as one
 * at a time from the nearest will make room for (not the fewest of any choice), or is
 * laid as its parts first, each a line into the depot, and split off them.
 */
export const GRADES = { belt: 2, tunnel: 2, gatherer: 2, mill: 2, bench: 2, workshop: 2, study: 1 } as const;
/** When a free swap is due, it swaps the order that would take longest to fill at what its lines bring the depot, if that is more than half an hour (an order nothing it has built brings, at once). */
export const SWAP = 30;
/** Coins to start with: a new player's, with nothing from the rest of the town. */
export const PURSE = 0;

/**
 * How much longer a person takes than the taps alone: finding the tool, turning a piece twice, a run
 * laid and taken up again, a look round the yard. Play-testers of the first design took 2.5 to 3
 * times what its script said for the same orders; with the taps below at 4 times, this script
 * agrees with them at the 4th, 6th and 11th order (about 40, 90 and 230 minutes).
 */
export const CARE = 4;

/** Seconds of a person's time for the taps alone. */
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

/** The settings above for a seed and a pace of folios, with a person's time at `CARE` times the taps. */
export function settings(seed: number, folios: number): Settings {
  return {
    seed,
    nodes: NODES,
    research: RESEARCH,
    minutes: MINUTES,
    folios,
    hands: {
      piece: HANDS.piece * CARE,
      set: HANDS.set * CARE,
      run: HANDS.run * CARE,
      tile: HANDS.tile * CARE,
      plot: HANDS.plot * CARE,
      think: HANDS.think * CARE,
      read: HANDS.read * CARE,
      order: HANDS.order * CARE,
    },
    grades: GRADES,
    swap: SWAP,
    purse: PURSE,
  };
}

/** The whole number after a flag, or `none` without the flag. */
function flag(args: readonly string[], name: string, none: number): number {
  const at = args.indexOf(name);
  if (at < 0) return none;
  const n = Number(args[at + 1]);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} takes a whole number`);
  return n;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const folios = flag(args, "--folios", FOLIOS);
  const at = args.indexOf("--seeds");
  const range = at >= 0 ? /^(\d+)-(\d+)$/.exec(args[at + 1] ?? "") : null;
  if (at >= 0 && !range) throw new Error("--seeds takes a range of whole numbers, as 1-12");
  const list = range
    ? Array.from({ length: Math.max(0, Number(range[2]) - Number(range[1]) + 1) }, (_, k) => Number(range[1]) + k)
    : [flag(args, "--seed", 1)];
  const began = performance.now();
  const reports: Report[] = list.map((seed) => report(new Player(settings(seed, folios)).play(), seed, folios));
  if (range) {
    const all = seeds(reports);
    console.log(json ? JSON.stringify({ ...all, reports }, null, 2) : seedsText(all));
  } else {
    const [r] = reports;
    if (r) console.log(json ? JSON.stringify(r, null, 2) : text(r));
  }
  console.error(`(played in ${((performance.now() - began) / 1000).toFixed(1)} s)`);
}

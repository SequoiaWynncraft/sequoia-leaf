/** The things that can be built in the yard: what each costs, what power it draws or gives, and what it is for. */

export const KINDS = [
  "belt",
  "gatherer",
  "mill",
  "bench",
  "workshop",
  "splitter",
  "joiner",
  "tunnel",
  "crate",
  "pylon",
  "wheel",
  "boiler",
  "depot",
] as const;
export type Kind = (typeof KINDS)[number];

export interface KindInfo {
  readonly name: string;
  /** Coins to build one; all of it comes back when it is taken away. */
  readonly cost: number;
  /** Power it draws while it stands within reach, and power it gives. */
  readonly draw: number;
  readonly gives: number;
  readonly what: string;
}

export const KIND: Record<Kind, KindInfo> = {
  belt: {
    name: "Belt",
    cost: 1,
    draw: 0,
    gives: 0,
    what: "Moves items one tile at a time, the way it points. Belts can feed each other from the side.",
  },
  gatherer: {
    name: "Gatherer",
    cost: 10,
    draw: 1,
    gives: 0,
    what: "Place it on a deposit. It gathers that deposit's item.",
  },
  mill: {
    name: "Mill",
    cost: 20,
    draw: 3,
    gives: 0,
    what: "Turns one item into another. What it makes depends on what you feed it.",
  },
  bench: { name: "Bench", cost: 40, draw: 4, gives: 0, what: "Combines two different items into one." },
  workshop: { name: "Workshop", cost: 120, draw: 8, gives: 0, what: "Combines three different items into one." },
  splitter: {
    name: "Splitter",
    cost: 8,
    draw: 0,
    gives: 0,
    what: "Splits one line into up to three: ahead, left and right, an item each way in turn.",
  },
  joiner: {
    name: "Joiner",
    cost: 8,
    draw: 0,
    gives: 0,
    what: "Merges up to three lines into one, taking an item from each in turn. Without it, a belt takes whichever arrives first and one line can starve.",
  },
  tunnel: {
    name: "Tunnel",
    cost: 12,
    draw: 0,
    gives: 0,
    what: "A belt that runs under 1 to 3 tiles and comes up on the other side.",
  },
  crate: {
    name: "Crate",
    cost: 20,
    draw: 0,
    gives: 0,
    what: "Stores items and passes them on. Tap it to shut it and keep what comes in.",
  },
  pylon: {
    name: "Pylon",
    cost: 6,
    draw: 0,
    gives: 0,
    what: "Spreads power to the tiles around it. Needs the depot or another pylon within reach.",
  },
  wheel: {
    name: "Waterwheel",
    cost: 60,
    draw: 0,
    gives: 10,
    what: "Makes steady power. It must stand beside the stream.",
  },
  boiler: {
    name: "Boiler",
    cost: 90,
    draw: 0,
    gives: 30,
    what: "Makes a lot of power, but only while it has deadfall to burn.",
  },
  depot: {
    name: "Depot",
    cost: 0,
    draw: 0,
    gives: 20,
    what: "Takes every item that reaches it. Each item counts towards an order that asks for it, and also pays 1% of its worth.",
  },
};

export const isKind = (v: unknown): v is Kind => typeof v === "string" && Object.hasOwn(KIND, v);

/** What a new yard can build before any order is filled. */
export const START_KINDS: readonly Kind[] = ["belt", "gatherer", "mill", "pylon"];

/**
 * What a new yard has to hand: pieces left behind the workshop, enough for a first line. Standing
 * one costs nothing and taking it away gives nothing back, but it can be stood again elsewhere, so
 * a yard can always be started, and started over, from an empty purse.
 */
export const STARTERS: Partial<Record<Kind, number>> = { gatherer: 1, mill: 1, belt: 12 };

/**
 * Ticks for a gatherer to gather one thing, for a belt to carry a thing one tile, and for a boiler
 * to burn one piece. A gatherer is a little slower than the mill it feeds (see the recipes), so at
 * first it is the gatherer that sets a line's pace; quicker gatherers and quicker machines then
 * take turns at being what holds a line back.
 */
export const TICKS = { gather: 15, belt: 4, burn: 20 } as const;
/** How far power reaches from the depot and from a pylon, and how far apart two joined pylons may stand. */
export const REACH = { depot: 6.6, pylon: 4.6, link: 8.1 } as const;
/** How many of each thing a machine keeps by it, how much fuel a boiler holds, and what a crate holds. */
export const BUFFER = 4;
export const FUEL = 8;
export const CRATE = 32;
/** The longest a tunnel can be once tunnels are open, in tiles passed under. */
export const SPAN = 3;

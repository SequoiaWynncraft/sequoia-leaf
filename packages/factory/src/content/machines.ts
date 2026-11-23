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
  "study",
  "stop",
  "sorter",
] as const;
export type KindName = (typeof KINDS)[number];

export interface KindInfo {
  readonly name: string;
  /** Coins to build one; all of it comes back when it is taken away. */
  readonly cost: number;
  /** Power it draws while it stands within reach, and power it gives. */
  readonly draw: number;
  readonly gives: number;
  readonly what: string;
}

export const KIND: Record<KindName, KindInfo> = {
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
    what: "Splits one line into up to three: ahead, left and right, an item each way in turn. A side with no belt, or a full one, is skipped. Each way can be shut on its card. Nothing is lost.",
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
  study: {
    name: "Study",
    cost: 200,
    draw: 6,
    gives: 0,
    what: "Takes in folios from any side, and puts 1 every 5 seconds towards the research being studied. Holds up to 20 of each kind.",
  },
  stop: {
    name: "Cart stop",
    cost: 150,
    draw: 0,
    gives: 0,
    what: "Takes items in from any side. Each counts as having reached the depot.",
  },
  sorter: {
    name: "Sorter",
    cost: 12,
    draw: 0,
    gives: 0,
    what: "Takes items in from behind. The one item it is set to goes out to its left; everything else goes straight on.",
  },
};

/**
 * What a new yard has to hand: pieces left behind the workshop, enough for a first line. Standing
 * one costs nothing and taking it away gives nothing back, but it can be stood again elsewhere, so
 * a yard can always be started, and started over, from an empty purse.
 */
export const STARTERS: Partial<Record<KindName, number>> = { gatherer: 1, mill: 1, belt: 12 };

/**
 * Ticks for a gatherer to gather one thing, for a boiler to burn one piece, and for a Study to take
 * in one folio, at grade 1; a belt at grade 1 carries a thing across a tile in 4. A gatherer is a
 * little slower than the mill it feeds (see the recipes), so at first it is the gatherer that sets a
 * line's pace; gatherers and machines of higher grades then take turns at being what holds a line back.
 */
export const TICKS = { gather: 15, burn: 20, study: 50 } as const;

/**
 * The kinds that have a grade, 1 to 3, kept on the piece. A splitter, joiner or sorter passes things
 * on at a belt's pace for its grade, and its grades open with the belt's (`nodes.ts`).
 */
export const GRADED: readonly KindName[] = [
  "belt",
  "tunnel",
  "splitter",
  "joiner",
  "sorter",
  "gatherer",
  "mill",
  "bench",
  "workshop",
  "study",
];
/** Grades 1 to 3, against grade 1: how fast a piece works or carries, what it costs, and the power it draws. */
export const GRADES = [
  { pace: 1, price: 1, draw: 1 },
  { pace: 1.5, price: 3, draw: 1.5 },
  { pace: 2, price: 8, draw: 2 },
] as const;
/** How far power reaches from the depot and from a pylon, and how far apart two joined pylons may stand, in hundredths of a tile. */
export const REACH = { depot: 660, pylon: 460, link: 810 } as const;
/** How many recipes' worth of each part a machine keeps by it, how much fuel a boiler holds, and how many of each folio a Study holds. */
export const BUFFER = 4;
export const FUEL = 8;
export const STUDY_HOLDS = 20;
/** The most tiles across and down a blueprint holds. */
export const BLUEPRINT = { w: 32, h: 24 } as const;
/** The most pieces one `stand` command carries: Leaf reads a command of at most 16 KiB. */
export const STAND_MOST = 160;

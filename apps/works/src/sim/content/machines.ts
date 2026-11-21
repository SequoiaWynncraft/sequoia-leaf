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
  belt: { name: "Belt", cost: 1, draw: 0, gives: 0, what: "Carries one thing per tile the way it points." },
  gatherer: { name: "Gatherer", cost: 10, draw: 1, gives: 0, what: "Stands on a deposit and gathers what is there." },
  mill: {
    name: "Mill",
    cost: 20,
    draw: 3,
    gives: 0,
    what: "One thing in, one out. It saws, fires or presses, by what arrives.",
  },
  bench: { name: "Bench", cost: 40, draw: 4, gives: 0, what: "Puts two different things together." },
  workshop: { name: "Workshop", cost: 120, draw: 8, gives: 0, what: "Puts three different things together." },
  splitter: {
    name: "Splitter",
    cost: 8,
    draw: 0,
    gives: 0,
    what: "Takes things in at the back and shares them ahead, left and right by turns.",
  },
  joiner: {
    name: "Joiner",
    cost: 8,
    draw: 0,
    gives: 0,
    what: "Takes from the back and both sides turn about, so no line is kept waiting.",
  },
  tunnel: {
    name: "Tunnel",
    cost: 12,
    draw: 0,
    gives: 0,
    what: "A belt that goes under one to three tiles and comes up the other side.",
  },
  crate: { name: "Crate", cost: 20, draw: 0, gives: 0, what: "Holds a stack and lets it out again. Tap to shut it." },
  pylon: { name: "Pylon", cost: 6, draw: 0, gives: 0, what: "Carries power further from the depot." },
  wheel: { name: "Waterwheel", cost: 60, draw: 0, gives: 10, what: "Gives steady power. Only beside the stream." },
  boiler: { name: "Boiler", cost: 90, draw: 0, gives: 30, what: "Gives a lot of power while it is fed deadfall." },
  depot: { name: "Depot", cost: 0, draw: 0, gives: 20, what: "Takes everything in and pays for it." },
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

/**
 * Plans: improvements bought with Coins at the depot. Each is opened by the story, some want an
 * earlier plan first, and each changes how the yard is best laid out.
 */
import type { KindName } from "./machines.ts";

export const PLAN_IDS = [
  "rakes",
  "boiler",
  "waxed",
  "flywheel",
  "bigcrates",
  "tallpylons",
  "workshop",
  "tooling",
  "tunnel",
  "barrows",
  "rollers",
  "jigs",
  "fourth",
] as const;
export type PlanName = (typeof PLAN_IDS)[number];

/**
 * What a plan changes. The paces are how many times the plain pace a thing then goes at; where two
 * owned plans change the same thing, the larger holds.
 */
export interface Effect {
  /** Gatherers, belts (and tunnels), and the machines that make things. */
  readonly gather?: number;
  readonly belt?: number;
  readonly craft?: number;
  /** How far a pylon reaches and links, times the plain reach. */
  readonly reach?: number;
  /** What a crate holds, and what the depot gives in power. */
  readonly crate?: number;
  readonly depot?: number;
  /** How many standing orders hang on the board. */
  readonly slots?: number;
  /** Machines it opens. */
  readonly opens?: readonly KindName[];
}

export interface PlanInfo {
  readonly id: PlanName;
  readonly name: string;
  readonly what: string;
  readonly price: number;
  readonly needs: readonly PlanName[];
  readonly effect: Effect;
}

export const PLANS: readonly PlanInfo[] = [
  {
    id: "rakes",
    name: "Sharper rakes",
    what: "Gatherers work 50% faster.",
    price: 180,
    needs: [],
    effect: { gather: 1.5 },
  },
  {
    id: "boiler",
    name: "The boiler",
    what: "Unlocks the boiler: a lot of power, as long as it has deadfall to burn.",
    price: 220,
    needs: [],
    effect: { opens: ["boiler"] },
  },
  {
    id: "waxed",
    name: "Waxed belts",
    what: "Belts and tunnels move items 50% faster.",
    price: 350,
    needs: [],
    effect: { belt: 1.5 },
  },
  {
    id: "flywheel",
    name: "A bigger flywheel",
    what: "The depot makes twice as much power.",
    price: 450,
    needs: [],
    effect: { depot: 40 },
  },
  {
    id: "bigcrates",
    name: "Bigger crates",
    what: "A crate holds four times as much.",
    price: 300,
    needs: [],
    effect: { crate: 128 },
  },
  {
    id: "tallpylons",
    name: "Taller pylons",
    what: "Pylons reach a third further, and can stand a third further apart.",
    price: 500,
    needs: [],
    effect: { reach: 1.35 },
  },
  {
    id: "workshop",
    name: "The workshop",
    what: "Unlocks the workshop, which combines three items into one.",
    price: 900,
    needs: [],
    effect: { opens: ["workshop"] },
  },
  {
    id: "tooling",
    name: "Second-tier machines",
    what: "Mills, benches and workshops work 50% faster.",
    price: 1500,
    needs: [],
    effect: { craft: 1.5 },
  },
  {
    id: "tunnel",
    name: "The tunnel",
    what: "Unlocks the tunnel: a belt that runs under other belts, a redwood's roots or the stream.",
    price: 300,
    needs: [],
    effect: { opens: ["tunnel"] },
  },
  {
    id: "barrows",
    name: "Wheelbarrows",
    what: "Gatherers now work at twice their starting speed.",
    price: 1200,
    needs: ["rakes"],
    effect: { gather: 2 },
  },
  {
    id: "rollers",
    name: "Roller belts",
    what: "Belts and tunnels now move items at twice their starting speed.",
    price: 3200,
    needs: ["waxed"],
    effect: { belt: 2 },
  },
  {
    id: "jigs",
    name: "Third-tier machines",
    what: "Mills, benches and workshops now work at twice their starting speed.",
    price: 7000,
    needs: ["tooling"],
    effect: { craft: 2 },
  },
  {
    id: "fourth",
    name: "A fourth hook",
    what: "The order board holds four orders at a time, up from three.",
    price: 4000,
    needs: [],
    effect: { slots: 4 },
  },
];

/**
 * Tier 5's nodes, put on the end of `NODES` (`nodes.ts`) in this order. The first two want only goods
 * a tier 4 yard makes, and pay toward the first plot of the land tier 4's commission puts up for sale.
 */
import type { NodeInfo } from "./nodes.ts";

export const TIER_5: readonly NodeInfo[] = [
  {
    id: "survey",
    tier: 5,
    kind: "project",
    title: "A survey of the outer woods",
    from: "Tindra",
    say: "Tindra has drawn the land past the fence. She would like to know if it is there.",
    want: { pole: 1500, tool: 2000, hamper: 1500 },
    pay: 20000,
    unlocks: {},
  },
  {
    id: "stakes",
    tier: 5,
    kind: "project",
    title: "Stakes and string",
    from: "The gnomes",
    say: "The gnomes are marking out the new plots. So far they have marked out each other, twice.",
    want: { frame: 3000, gear: 2000 },
    pay: 15000,
    unlocks: {},
  },
];

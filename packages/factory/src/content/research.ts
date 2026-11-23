/**
 * Research: from tier 3 on, unlocks are studied. A piece of research costs folios, which Studies
 * take in; it can be studied once its tier is open and what it needs is known or done.
 */
import type { Wants } from "./items.ts";
import type { Unlocks } from "./nodes.ts";

/** How many pieces of research may be in the line: one studied, and the rest waiting. */
export const LINE = 4;

export interface ResearchInfo {
  readonly id: string;
  readonly tier: number;
  readonly name: string;
  readonly what: string;
  /** What it costs, in folios. */
  readonly cost: Wants;
  /** Research known, or nodes done, first. */
  readonly needs?: readonly string[];
  readonly unlocks: Unlocks;
}

export const RESEARCH: readonly ResearchInfo[] = [
  {
    id: "oilpress",
    tier: 3,
    name: "The oil press",
    what: "A mill makes lamp oil from resin.",
    cost: { timber: 60 },
    unlocks: { recipes: ["oil"] },
  },
  {
    id: "workshop",
    tier: 3,
    name: "The workshop",
    what: "Unlocks the workshop, which makes one item from three.",
    cost: { timber: 150 },
    unlocks: { kinds: ["workshop"] },
  },
  {
    id: "flywheel",
    tier: 3,
    name: "A bigger flywheel",
    what: "The depot makes 40 power, up from 20.",
    cost: { timber: 200 },
    unlocks: { depot: 40 },
  },
  {
    id: "tooling",
    tier: 3,
    name: "Second-tier machines",
    what: "Unlocks grade 2 mills, benches and workshops.",
    cost: { timber: 400 },
    needs: ["workshop"],
    unlocks: { grades: { mill: 2, bench: 2, workshop: 2 } },
  },
  {
    id: "sorter",
    tier: 3,
    name: "The sorter",
    what: "Unlocks the sorter, which sends one item to its left and the rest straight on.",
    cost: { timber: 300 },
    unlocks: { kinds: ["sorter"] },
  },
  {
    id: "planchest",
    tier: 3,
    name: "A plan chest",
    what: "Keep 3 blueprints of up to 400 pieces each.",
    cost: { timber: 300 },
    unlocks: { blueprints: { count: 3, pieces: 400 } },
  },
  {
    id: "carttrack",
    tier: 3,
    name: "The cart track",
    what: "Unlocks 1 cart stop.",
    cost: { timber: 400 },
    unlocks: { kinds: ["stop"], stops: 1 },
  },
  {
    id: "nightshift",
    tier: 3,
    name: "A night shift",
    what: "The yard runs for 12 hours after you leave, up from 8.",
    cost: { timber: 400 },
    unlocks: { away: 12 },
  },
  {
    id: "upgrading",
    tier: 3,
    name: "Upgrading an area",
    what: "Select can raise every piece in an area to the highest grade unlocked.",
    cost: { timber: 250 },
    needs: ["planchest"],
    unlocks: { tools: ["upgrade"] },
  },
  {
    id: "brassfolio",
    tier: 3,
    name: "The Brass folio",
    what: "A workshop makes Brass folios from 1 gear, 1 lantern and 1 ingot.",
    cost: { timber: 900 },
    needs: ["workshop", "oilpress"],
    unlocks: { recipes: ["brass"] },
  },
  {
    id: "tooling3",
    tier: 4,
    name: "Third-tier machines",
    what: "Unlocks grade 3 mills, benches and workshops.",
    cost: { brass: 300 },
    needs: ["tooling"],
    unlocks: { grades: { mill: 3, bench: 3, workshop: 3 } },
  },
  {
    id: "flywheel2",
    tier: 4,
    name: "A heavier flywheel",
    what: "The depot makes 60 power, up from 40.",
    cost: { brass: 200 },
    needs: ["flywheel"],
    unlocks: { depot: 60 },
  },
  {
    id: "nightshift2",
    tier: 4,
    name: "A second night shift",
    what: "The yard runs for 16 hours after you leave, up from 12.",
    cost: { brass: 250 },
    needs: ["nightshift"],
    unlocks: { away: 16 },
  },
  {
    id: "studydesk",
    tier: 4,
    name: "A second desk",
    what: "Unlocks grade 2 Studies.",
    cost: { brass: 200 },
    unlocks: { grades: { study: 2 } },
  },
];

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
    cost: { timber: 90 },
    unlocks: { recipes: ["oil"] },
  },
  {
    id: "workshop",
    tier: 3,
    name: "The workshop",
    what: "Unlocks the workshop, which makes one item from three.",
    cost: { timber: 225 },
    unlocks: { kinds: ["workshop"] },
  },
  {
    id: "flywheel",
    tier: 3,
    name: "A bigger flywheel",
    what: "The depot makes 40 power, up from 20.",
    cost: { timber: 300 },
    unlocks: { depot: 40 },
  },
  {
    id: "tooling",
    tier: 3,
    name: "Second-tier machines",
    what: "Unlocks grade 2 mills, benches and workshops.",
    cost: { timber: 600 },
    needs: ["workshop"],
    unlocks: { grades: { mill: 2, bench: 2, workshop: 2 } },
  },
  {
    id: "sorter",
    tier: 3,
    name: "The sorter",
    what: "Unlocks the sorter, which sends one item to its left or right and the rest straight on.",
    cost: { timber: 450 },
    unlocks: { kinds: ["sorter"] },
  },
  {
    id: "planchest",
    tier: 3,
    name: "A plan chest",
    what: "Keep 3 blueprints of up to 400 pieces each.",
    cost: { timber: 450 },
    unlocks: { blueprints: { count: 3, pieces: 400 } },
  },
  {
    id: "carttrack",
    tier: 3,
    name: "The cart track",
    what: "Unlocks 1 cart stop.",
    cost: { timber: 600 },
    unlocks: { kinds: ["stop"], stops: 1 },
  },
  {
    id: "nightshift",
    tier: 3,
    name: "A night shift",
    what: "The yard runs for 12 hours after you leave, up from 8.",
    cost: { timber: 600 },
    unlocks: { away: 12 },
  },
  {
    id: "upgrading",
    tier: 3,
    name: "Upgrading an area",
    what: "Select can raise every piece in an area to the highest grade unlocked.",
    cost: { timber: 375 },
    needs: ["planchest"],
    unlocks: { tools: ["upgrade"] },
  },
  {
    id: "brassfolio",
    tier: 3,
    name: "The Brass folio",
    what: "A workshop makes Brass folios from 1 gear, 1 lantern and 1 ingot.",
    cost: { timber: 1350 },
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
  {
    id: "waysin",
    tier: 4,
    name: "Ways in",
    what: "A splitter's ahead, left or right can be set to In on its card. It takes items in there as well as from behind, in turn, and sends them out of its open ways.",
    cost: { timber: 500, brass: 300 },
    needs: ["flags"],
    unlocks: { ins: true },
  },
  // Tier 4's long works: the goods none of them made with a lantern, studied with both folios.
  {
    id: "pipework",
    tier: 4,
    name: "Pipework",
    what: "A bench makes a pipe from 2 ingots and 1 lamp oil.",
    cost: { timber: 500, brass: 250 },
    unlocks: { recipes: ["pipe"] },
  },
  {
    id: "fireworks",
    tier: 4,
    name: "Fireworks",
    what: "A bench makes a firework from 1 pot and 1 lamp oil.",
    cost: { timber: 300, brass: 150 },
    unlocks: { recipes: ["firework"] },
  },
  {
    id: "lenses",
    tier: 4,
    name: "Ground lenses",
    what: "A bench makes a spyglass from 1 pipe and 2 glass.",
    cost: { timber: 600, brass: 400 },
    needs: ["pipework"],
    unlocks: { recipes: ["spyglass"] },
  },
  {
    id: "clockmaking",
    tier: 4,
    name: "Clockmaking",
    what: "A workshop makes a clock from 2 gears, 1 frame and 1 glass.",
    cost: { timber: 400, brass: 600 },
    needs: ["tooling3"],
    unlocks: { recipes: ["clock"] },
  },
  {
    id: "orreryplans",
    tier: 4,
    name: "The orrery",
    what: "A workshop makes an orrery from 2 clocks, 1 spyglass and 1 Brass folio.",
    cost: { timber: 1500, brass: 1500 },
    needs: ["lenses", "clockmaking", "observatory"],
    unlocks: { recipes: ["orrery"] },
  },
  {
    id: "nightshift3",
    tier: 4,
    name: "A third night shift",
    what: "The yard runs for 24 hours after you leave, up from 20.",
    cost: { timber: 2000, brass: 2000 },
    needs: ["nightshift2", "roadridge"],
    unlocks: { away: 24 },
  },
  // The most the game asks for any research: about 15 hours of a grade III line of each folio.
  {
    id: "wholeyard",
    tier: 4,
    name: "A plan of the whole yard",
    what: "Select can save the whole yard as a blueprint, and put it back where it was.",
    cost: { timber: 15000, brass: 15000 },
    needs: ["shelves"],
    unlocks: { tools: ["whole"] },
  },
  // Tier 5, the wire.
  {
    id: "felling",
    tier: 5,
    name: "Felling",
    what: "Redwoods on your land can be felled. The first costs 1,000 Coins. Each one after costs half as much again, rounded down to a whole 100.",
    cost: { timber: 6000, brass: 4000 },
    unlocks: { felling: true },
  },
  {
    id: "deepculvert",
    tier: 5,
    name: "A deep culvert",
    what: "A tunnel passes under up to 12 tiles, up from 5. Each tile beyond 5 adds 2 Coins to its price at grade 1, 6 at grade 2 and 16 at grade 3.",
    cost: { timber: 8000, brass: 5000 },
    needs: ["longculvert"],
    unlocks: { span: 12 },
  },
  {
    id: "widemouths",
    tier: 5,
    name: "Wide mouths",
    what: "A tunnel takes items in from the left and right of its way in, as well as from behind.",
    cost: { timber: 6000, brass: 6000 },
    needs: ["deepculvert"],
    unlocks: { mouths: true },
  },
  // Reach, for building far from where you stand (`Unlocks.range`).
  {
    id: "longreach",
    tier: 3,
    name: "Long reach",
    what: "You can build up to 2 plots away from the plot you stand on, up from 1.",
    cost: { timber: 150 },
    unlocks: { range: 2 },
  },
  {
    id: "longerreach",
    tier: 5,
    name: "Longer reach",
    what: "You can build up to 3 plots away from the plot you stand on, up from 2.",
    cost: { timber: 6000, brass: 4000 },
    needs: ["longreach"],
    unlocks: { range: 3 },
  },
];

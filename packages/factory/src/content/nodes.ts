/**
 * The tiers, as nodes: lessons first, done in their order; then in each tier projects, done in any
 * order once the tier is open, and one commission, which opens the next tier. Each is a delivery to
 * the depot; finishing it may pay, unlocks something, and a commission leaves something in the town.
 *
 * What a node or a piece of research unlocks is one type (`Unlocks`). A new yard starts with `START`.
 */
import type { ItemName, Wants } from "./items.ts";
import type { KindName } from "./machines.ts";
import type { PlotName } from "./plots.ts";

export const TOOLS = ["paint", "select", "upgrade"] as const;
export type Tool = (typeof TOOLS)[number];

/** What finishing a node or a piece of research unlocks. Where two give a number, the larger holds. */
export interface Unlocks {
  /** Kinds of piece, at grade 1. */
  readonly kinds?: readonly KindName[];
  /** The highest grade of a kind that may be built. */
  readonly grades?: Partial<Record<KindName, number>>;
  /** Recipes, by what they make. A recipe that nothing unlocks is known from the start. */
  readonly recipes?: readonly ItemName[];
  /** Plots put up for sale. */
  readonly plots?: readonly PlotName[];
  readonly tools?: readonly Tool[];
  /** How many blueprints the yard keeps, and the most pieces one holds. */
  readonly blueprints?: { readonly count: number; readonly pieces: number };
  /** How many cart stops may stand. */
  readonly stops?: number;
  /** How many things a crate holds. */
  readonly crate?: number;
  /** How far a pylon reaches and may stand from the next, in hundredths of its plain reach. */
  readonly reach?: number;
  /** The power the depot gives. */
  readonly depot?: number;
  /** The most tiles a tunnel passes under. */
  readonly span?: number;
  /** Hours the yard runs after its owner's last command. */
  readonly away?: number;
  /** How many orders the board holds. */
  readonly hooks?: number;
  /** The board of standing orders goes up. */
  readonly board?: true;
}

/** What a new yard has. */
export const START: Unlocks = {
  kinds: ["belt", "gatherer", "mill", "pylon"],
  plots: ["yard"],
  crate: 32,
  reach: 100,
  depot: 20,
  away: 8,
  hooks: 3,
};

/** Something a finished node leaves in the town, for the town to show. */
export interface Gift {
  readonly id: string;
  readonly line: string;
}

export interface NodeInfo {
  readonly id: string;
  readonly tier: number;
  readonly kind: "lesson" | "project" | "commission";
  readonly title: string;
  readonly from: string;
  /** What whoever asked says about it. */
  readonly say: string;
  readonly want: Wants;
  /** Coins it pays when it is finished. */
  readonly pay?: number;
  readonly unlocks: Unlocks;
  /** The nodes done, or research known, first. */
  readonly needs?: readonly string[];
  readonly gift?: Gift;
}

export const NODES: readonly NodeInfo[] = [
  // Tier 0: the lesson.
  {
    id: "planks",
    tier: 0,
    kind: "lesson",
    title: "Planks for the Treasury",
    from: "Cinfy",
    say: "The Treasury floor creaks, and I would rather it didn't while I am counting.",
    want: { plank: 12 },
    pay: 80,
    unlocks: {},
  },
  {
    id: "ingots",
    tier: 0,
    kind: "lesson",
    title: "Ingots and bricks",
    from: "Cinfy",
    say: "Ore and stone lie at the corners of the yard, past where the depot's power reaches. Pylons will carry it.",
    want: { ingot: 12, brick: 12 },
    pay: 160,
    unlocks: { kinds: ["bench"] },
  },
  {
    id: "tools",
    tier: 0,
    kind: "lesson",
    title: "Tools for the raid parties",
    from: "The raid parties",
    say: "They came back with half the shovels they left with. Nobody will say where the other half went.",
    want: { tool: 10 },
    pay: 260,
    unlocks: { kinds: ["splitter", "joiner"] },
  },
  {
    id: "gears",
    tier: 0,
    kind: "lesson",
    title: "Gears and frames",
    from: "The crab pond",
    say: "The crabs want a little gate. With a gear. They have drawn it. It is mostly crab.",
    want: { gear: 10, frame: 10 },
    pay: 500,
    unlocks: { board: true, plots: ["meadow"] },
  },

  // Tier 1: the home yard.
  {
    id: "boiler",
    tier: 1,
    kind: "project",
    title: "A boiler for the workshop",
    from: "The gnomes",
    say: "The workshop is cold. The gnomes are wearing two hats each and would like to stop.",
    want: { brick: 40, ingot: 40 },
    unlocks: { kinds: ["boiler"] },
  },
  {
    id: "crates",
    tier: 1,
    kind: "project",
    title: "Crates for the market",
    from: "The market stalls",
    say: "Market day is coming, and everything is on the ground again.",
    want: { plank: 120, frame: 60 },
    unlocks: { kinds: ["crate"] },
  },
  {
    id: "culvert",
    tier: 1,
    kind: "project",
    title: "Bricks for the old culvert",
    from: "Pipwick",
    say: "The old culvert under the path has fallen in. I know because I fell in it.",
    want: { brick: 80, gear: 60 },
    unlocks: { kinds: ["tunnel"], span: 3 },
  },
  {
    id: "signs",
    tier: 1,
    kind: "project",
    title: "Signs for the paths",
    from: "Pipwick",
    say: "I walk every path in town, and two of them I still get lost on. Signs, please. Painted.",
    want: { frame: 80, tool: 40 },
    unlocks: { tools: ["paint"] },
  },
  {
    id: "banners",
    tier: 1,
    kind: "commission",
    title: "Poles for the new banners",
    from: "The guild",
    say: "The guild took a hill, and then some more hills, and the banners are folded on a shelf. A banner should not be on a shelf.",
    want: { engine: 60, pole: 60 },
    pay: 1500,
    unlocks: { plots: ["bank", "stream", "quarry"], recipes: ["hamper", "shell"] },
    gift: { id: "banner-pole", line: "A new banner pole stands in town, and the banner is up it." },
  },

  // Tier 2: the stream.
  {
    id: "stew",
    tier: 2,
    kind: "project",
    title: "Pots for the campfire stew",
    from: "The campfire",
    say: "Everybody is bringing a bowl and nobody is bringing a pot. There is clay to the west.",
    want: { pot: 200 },
    unlocks: { kinds: ["wheel"] },
  },
  {
    id: "chain",
    tier: 2,
    kind: "project",
    title: "A surveyor's chain",
    from: "The gnomes",
    say: "The gnomes want to measure the yard. They have a piece of string. It is not long enough.",
    want: { gear: 120, frame: 120 },
    unlocks: { tools: ["select"] },
  },
  {
    id: "drawing",
    tier: 2,
    kind: "project",
    title: "A drawing board",
    from: "Tindra",
    say: "Tindra draws everything before she builds it. She would like to draw yours.",
    want: { plank: 150, glass: 100 },
    unlocks: { blueprints: { count: 1, pieces: 150 } },
    needs: ["chain"],
  },
  {
    id: "wax",
    tier: 2,
    kind: "project",
    title: "Wax for the belts",
    from: "The gnomes",
    say: "The belts squeak. The gnomes say it is the belts. It is mostly the gnomes. They will carry the wax in hampers.",
    want: { hamper: 80 },
    unlocks: { grades: { belt: 2, tunnel: 2 } },
  },
  {
    id: "rakes",
    tier: 2,
    kind: "project",
    title: "Rakes for the gnomes",
    from: "The gnomes",
    say: "The gnomes have been raking with their hands. They are tired of it, and so are their hands.",
    want: { tool: 100 },
    unlocks: { grades: { gatherer: 2 } },
  },
  {
    id: "windows",
    tier: 2,
    kind: "project",
    title: "Glass for the Treasury windows",
    from: "Cinfy",
    say: "I should like to see who is coming. There is sand by the stream.",
    want: { glass: 200 },
    unlocks: { reach: 135 },
  },
  {
    id: "shells",
    tier: 2,
    kind: "project",
    title: "Shells for the shy crabs",
    from: "The crab pond",
    say: "Some of them would like somewhere to be shy in. Glazed, please. They were firm about glazed.",
    want: { shell: 100 },
    unlocks: { crate: 128 },
  },
  {
    id: "hall",
    tier: 2,
    kind: "commission",
    title: "A hall for the scholars",
    from: "Pipwick",
    say: "The gnomes have questions. They would like somewhere to keep them.",
    want: { frame: 400, glass: 400, hamper: 300 },
    pay: 3000,
    unlocks: { kinds: ["study"], recipes: ["timber"], plots: ["grove"] },
    gift: { id: "scholars-hall", line: "The scholars' hall stands in town, full of gnomes with questions." },
  },

  // Tier 3: the Study.
  {
    id: "lanterns",
    tier: 3,
    kind: "commission",
    title: "Lanterns for the great tree",
    from: "The guild",
    say: "One for every raid that came home, and there have been a lot of raids. And the scholars ask for the first Brass folios, for the tree's own shelf.",
    want: { lantern: 400, brass: 60 },
    pay: 5000,
    unlocks: {},
    needs: ["oilpress", "workshop", "brassfolio"],
    gift: { id: "tree-lanterns", line: "Lanterns from the Works hang in the great tree." },
  },
];

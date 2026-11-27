import type { KindName } from "../kinds/list.ts";
/**
 * The tiers, as nodes: lessons first, done in their order; then in each tier projects, done in any
 * order once the tier is open, and one commission, which opens the next tier. Each is a delivery to
 * the depot; finishing it may pay, unlocks something, and a commission leaves something in the town.
 *
 * What a node or a piece of research unlocks is one type (`Unlocks`). A new yard starts with `START`.
 */
import type { ItemName, Wants } from "./items.ts";
import type { PlotName } from "./plots.ts";

/** `whole`: a blueprint of the whole yard, kept and put back with Select (`whole.ts`). */
export const TOOLS = ["paint", "select", "upgrade", "whole"] as const;
/** How many nodes may wait in line after the one in hand. */
export const QUEUE = 3;
export type Tool = (typeof TOOLS)[number];

/** What finishing a node or a piece of research unlocks. Where two give a number, the larger holds. */
export interface Unlocks {
  /** Kinds of piece, at grade 1. */
  readonly kinds?: readonly KindName[];
  /** The highest grade of a kind that may be built, once the kind itself is unlocked. */
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
  /** A splitter may put one of its ways first. */
  readonly first?: true;
  /** A splitter may turn its ways out to take things in, as well as from behind. */
  readonly ins?: true;
  /** Redwoods on the yard's land may be felled, each dearer than the last (`fellPrice`). */
  readonly felling?: true;
  /** A tunnel's way-in mouth takes things in from its left and right, as well as from behind. */
  readonly mouths?: true;
  /**
   * How many plots out from the plot you stand on you build: 1 is the plots round it. `ANYWHERE` is
   * every plot of any land.
   */
  readonly range?: number;
}

/** A range that takes in every plot of any land: building from anywhere. */
export const ANYWHERE = 255;

/** What a new yard has. */
export const START: Unlocks = {
  kinds: ["belt", "gatherer", "mill", "pylon"],
  plots: ["yard"],
  crate: 32,
  reach: 100,
  range: 1,
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
    say: "The Treasury floor creaks. I am trying to count.",
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
    say: "Ore and stone are past the depot's power. Pylons carry it there.",
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
    say: "Half the shovels came back. Nobody will say where the rest went.",
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
    say: "The crabs want a gate with a gear. They drew it. It is mostly crab.",
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
    say: "The workshop is cold. Every gnome is wearing two hats.",
    want: { brick: 40, ingot: 40 },
    unlocks: { kinds: ["boiler"] },
  },
  {
    id: "crates",
    tier: 1,
    kind: "project",
    title: "Crates for the market",
    from: "The market stalls",
    say: "Market day is coming. Everything is on the ground again.",
    want: { plank: 120, frame: 60 },
    unlocks: { kinds: ["crate"] },
  },
  {
    id: "culvert",
    tier: 1,
    kind: "project",
    title: "Bricks for the old culvert",
    from: "Pipwick",
    say: "The culvert under the path fell in. I know because I fell in it.",
    want: { brick: 80, gear: 60 },
    unlocks: { kinds: ["tunnel"], span: 3 },
  },
  {
    id: "signs",
    tier: 1,
    kind: "project",
    title: "Signs for the paths",
    from: "Pipwick",
    say: "I still get lost on two paths. Signs, please. Painted.",
    want: { frame: 80, tool: 40 },
    unlocks: { tools: ["paint"] },
  },
  {
    id: "banners",
    tier: 1,
    kind: "commission",
    title: "Poles for the new banners",
    from: "The guild",
    say: "The guild keeps taking hills. The banners are still on a shelf.",
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
    say: "Everybody brought a bowl. Nobody brought a pot. There is clay to the west.",
    want: { pot: 200 },
    unlocks: { kinds: ["wheel"] },
  },
  {
    id: "chain",
    tier: 2,
    kind: "project",
    title: "A surveyor's chain",
    from: "The gnomes",
    say: "The gnomes want to measure the yard. Their string is too short.",
    want: { gear: 120, frame: 120 },
    unlocks: { tools: ["select"] },
  },
  {
    id: "drawing",
    tier: 2,
    kind: "project",
    title: "A drawing board",
    from: "Tindra",
    say: "Tindra draws everything before she builds it. Yours is next.",
    want: { plank: 150, glass: 100 },
    unlocks: { blueprints: { count: 1, pieces: 150 } },
    needs: ["chain"],
  },
  {
    id: "wax",
    tier: 2,
    kind: "project",
    title: "Wax for the lines",
    from: "The gnomes",
    say: "The lines squeak. It is mostly the gnomes. The wax comes in hampers.",
    want: { hamper: 80 },
    unlocks: { grades: { belt: 2, tunnel: 2, splitter: 2, joiner: 2, sorter: 2 } },
  },
  {
    id: "rakes",
    tier: 2,
    kind: "project",
    title: "Rakes for the gnomes",
    from: "The gnomes",
    say: "The gnomes rake with their hands. Their hands have complained.",
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
    say: "Some crabs want somewhere to be shy. Glazed. They were firm about glazed.",
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
    say: "A lantern for every raid that came home. The scholars want the first Brass folios, too.",
    want: { lantern: 400, brass: 60 },
    pay: 5000,
    unlocks: { plots: ["hollow", "seam", "pond"] },
    // Every piece of the tier's research: the Study is what tier 3 is about, and it works while the yard's owner is away.
    needs: [
      "oilpress",
      "workshop",
      "flywheel",
      "tooling",
      "sorter",
      "planchest",
      "carttrack",
      "nightshift",
      "upgrading",
      "brassfolio",
    ],
    gift: { id: "tree-lanterns", line: "Lanterns from the Works hang in the great tree." },
  },

  // Tier 4: the gate.
  {
    id: "flags",
    tier: 4,
    kind: "project",
    title: "Flags for the splitters",
    from: "The gnomes",
    say: "The gnomes want to tell a splitter which way comes first. They made flags. The flags are small.",
    want: { tool: 200, frame: 200 },
    unlocks: { first: true },
  },
  {
    id: "longculvert",
    tier: 4,
    kind: "project",
    title: "A longer culvert",
    from: "Pipwick",
    say: "The new path crosses the stream twice. I have fallen in both.",
    want: { brick: 300, gear: 200 },
    unlocks: { span: 5 },
  },
  {
    id: "secondcart",
    tier: 4,
    kind: "project",
    title: "A second cart",
    from: "The market stalls",
    say: "One cart cannot keep up with market day.",
    want: { engine: 120, frame: 200 },
    unlocks: { stops: 2 },
    needs: ["carttrack"],
  },
  {
    id: "brassfittings",
    tier: 4,
    kind: "project",
    title: "Iron rollers for the lines",
    from: "The gnomes",
    say: "Iron rollers and brass rails. The gnomes have tried the rollers already. On themselves.",
    want: { lantern: 150, gear: 300 },
    unlocks: { grades: { belt: 3, tunnel: 3, splitter: 3, joiner: 3, sorter: 3, gatherer: 3 } },
  },
  {
    id: "shelves",
    tier: 4,
    kind: "project",
    title: "Shelves for the plan chest",
    from: "Tindra",
    say: "The plans are on the floor again. Four shelves, please.",
    want: { frame: 300, glass: 200 },
    unlocks: { blueprints: { count: 4, pieces: 1000 } },
    needs: ["planchest"],
  },
  {
    id: "kits",
    tier: 4,
    kind: "commission",
    title: "Raid kits for the gate",
    from: "The raid parties",
    say: "Every party that goes out takes a kit. Every party that comes back has lost it.",
    want: { kit: 300, engine: 150 },
    pay: 8000,
    unlocks: {},
    gift: { id: "gate-kits", line: "Raid kits from the Works are stacked by the gate." },
  },
  // Tier 4's long works: projects for the days after the gate, none of them needed for the next
  // tier. Each is sized in hours of a whole line of grade III machines making what it wants.
  {
    id: "roadmill",
    tier: 4,
    kind: "project",
    title: "The beacon road: to the old mill",
    from: "The raid parties",
    say: "Parties coming home at night walk into the river. A line of beacons from the gate to the old mill would stop most of that.",
    want: { beacon: 600, pole: 1200 },
    pay: 2000,
    unlocks: {},
  },
  {
    id: "roadridge",
    tier: 4,
    kind: "project",
    title: "The beacon road: to the ridge",
    from: "The raid parties",
    say: "Past the mill the road climbs to the ridge, where a beacon is not enough. A lost party sends up a firework, and the gate sends one back.",
    want: { beacon: 2400, firework: 4000 },
    pay: 4000,
    unlocks: { away: 20 },
    needs: ["roadmill", "fireworks"],
  },
  {
    id: "roadcamp",
    tier: 4,
    kind: "project",
    title: "The beacon road: to the far camp",
    from: "The guild",
    say: "From the ridge you can see the far camp. With beacons all the way, a cart could go there and back. It will want spyglasses, and kits for whoever goes.",
    want: { beacon: 6000, spyglass: 4000, kit: 3000 },
    pay: 8000,
    unlocks: { stops: 3 },
    needs: ["roadridge", "lenses", "secondcart"],
  },
  {
    id: "market",
    tier: 4,
    kind: "project",
    title: "Market day",
    from: "The market stalls",
    say: "Market day is every day now. The stalls want a bit of everything, and two more stalls to sell it from.",
    want: {
      pipe: 500,
      firework: 500,
      tool: 500,
      gear: 500,
      frame: 500,
      hamper: 500,
      shell: 500,
      engine: 500,
      pole: 500,
      timber: 500,
    },
    pay: 3000,
    unlocks: { hooks: 5 },
    needs: ["pipework", "fireworks"],
  },
  {
    id: "rollcall",
    tier: 4,
    kind: "project",
    title: "Crab roll call",
    from: "Crab #7",
    say: "Roll call is at dawn, and Crab #7 would like it well attended for once. Crab #7 has counted: 7,777 should do. Afterwards the crabs will tidy the crates. They are good at it.",
    want: { crab: 7777 },
    pay: 7777,
    unlocks: { crate: 512 },
  },
  {
    id: "observatory",
    tier: 4,
    kind: "project",
    title: "An observatory on the ridge",
    from: "The scholars",
    say: "The scholars want to look at the stars. Until now they have been looking at the ceiling.",
    want: { spyglass: 2000, clock: 1500, frame: 3000, glass: 4000 },
    pay: 5000,
    unlocks: { grades: { study: 3 } },
    needs: ["lenses", "clockmaking"],
  },
  {
    id: "sky",
    tier: 4,
    kind: "project",
    title: "A sky for the great tree",
    from: "The guild",
    say: "Over the great tree, the whole sky, turning. Nobody knows how it would work. Everybody wants one.",
    want: { orrery: 10000, clock: 15000, beacon: 12000, crab: 12000 },
    pay: 20000,
    unlocks: { depot: 100 },
    needs: ["observatory", "orreryplans"],
  },
];

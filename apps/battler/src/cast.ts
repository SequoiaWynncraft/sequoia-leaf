/**
 * Who is in the Little Raid: the twelve spirits a member can take along, the trouble the forest
 * sends against them, the snacks at the stall, and the waves of a run. Words and numbers only;
 * what the abilities do is in `sim.ts`.
 */
export const SPIRITS = [
  "leafling",
  "mossmote",
  "glorp",
  "slug",
  "chickaree",
  "worm",
  "emberkit",
  "rock",
  "moth",
  "owl",
  "greg",
  "fox",
] as const;
export type SpiritKind = (typeof SPIRITS)[number];
export const TROUBLES = [
  "gnat",
  "bramble",
  "wasp",
  "puddle",
  "toadstool",
  "gust",
  "magpie",
  "crab",
  "mud",
  "bigcrab",
] as const;
export type TroubleKind = (typeof TROUBLES)[number];
/** A Glorplet is the bit that comes off a Glorp: it is never sold, only made. */
export type Kind = SpiritKind | TroubleKind | "glorplet";

export interface Role {
  readonly name: string;
  readonly atk: number;
  readonly hp: number;
  /** When it first turns up at the stall: 1 from the start, 2 from round three, 3 from round five. Never, at 0. */
  readonly tier: 0 | 1 | 2 | 3;
  /** When its ability fires, and what it does at a level. Empty for those with none. */
  readonly when: string;
  readonly does: (level: number) => string;
  readonly quip: string;
}
const times = (n: number): string => (n === 1 ? "Once" : n === 2 ? "Twice" : "Three times");
const plain = (): string => "";

export const ROLE: Record<Kind, Role> = {
  leafling: {
    name: "Leafling",
    atk: 2,
    hp: 3,
    tier: 1,
    when: "A friend is bought",
    does: (l) => `Tells the friend ahead of it how to do things properly: +${l} attack, for good.`,
    quip: "A sprout with opinions.",
  },
  mossmote: {
    name: "Mossmote",
    atk: 1,
    hp: 3,
    tier: 1,
    when: "Start of the fight",
    does: (l) =>
      `Tucks a cushion in front of the ${l === 1 ? "friend" : `${l} friends`} ahead of it: the first hit on ${l === 1 ? "it" : "each"} does no harm.`,
    quip: "Soft. Very soft.",
  },
  glorp: {
    name: "Glorp",
    atk: 2,
    hp: 4,
    tier: 1,
    when: "When it is hurt",
    does: (l) => `A bit comes off: a ${l}/${l} Glorplet joins the line behind it, if there is room.`,
    quip: "Blue. Wobbly. Plural, shortly.",
  },
  slug: {
    name: "Slug",
    atk: 1,
    hp: 5,
    tier: 1,
    when: "When it is hurt",
    does: (l) => `Slimes whoever did it: -${l} attack for the rest of the fight.`,
    quip: "In no hurry at all.",
  },
  chickaree: {
    name: "Chickaree",
    atk: 1,
    hp: 2,
    tier: 1,
    when: "End of the turn",
    does: (l) => `Buries one leftover acorn. Next turn it comes back as ${1 + l}.`,
    quip: "Buries cones. Forgets where. Finds more.",
  },
  worm: {
    name: "Worm",
    atk: 3,
    hp: 2,
    tier: 2,
    when: "When it faints",
    does: (l) => `Burrows instead, and pops up at the back of the line with 1 health. ${times(l)} a fight.`,
    quip: "Has been underground. Will be again.",
  },
  emberkit: {
    name: "Emberkit",
    atk: 2,
    hp: 2,
    tier: 2,
    when: "After every clash",
    does: (l) =>
      `While it is at the very back of the line, a spark jumps from its fire: ${l} damage to the trouble at the front.`,
    quip: "Asleep in the fire. Do not move the fire.",
  },
  rock: {
    name: "Rock",
    atk: 0,
    hp: 8,
    tier: 2,
    when: "Always",
    does: (l) =>
      `Does nothing. Shrugs ${2 * l} off every hit, and whoever hit it stubs a toe (${l} damage). Will not be moved, by you or by anything else.`,
    quip: "It is a rock. It came anyway.",
  },
  moth: {
    name: "Moth",
    atk: 2,
    hp: 2,
    tier: 2,
    when: "A friend faints",
    does: (l) => `Flutters to where they were: +${l} attack and +${l} health for the rest of the fight.`,
    quip: "Drawn to whatever just went out.",
  },
  owl: {
    name: "Fog Owl",
    atk: 3,
    hp: 3,
    tier: 3,
    when: "Start of the fight",
    does: (l) => `Swoops out of the fog onto the trouble at the very back: ${4 * l} damage.`,
    quip: "You will not hear it. It heard you.",
  },
  greg: {
    name: "Greg",
    atk: 2,
    hp: 5,
    tier: 3,
    when: "A snack is handed out",
    does: (l) => `Eats any snack given to him or to the spirit next to him, and gets +${l}/+${l} on top.`,
    quip: "Eats offerings. All of them.",
  },
  fox: {
    name: "White Fox",
    atk: 5,
    hp: 5,
    tier: 3,
    when: "It sends trouble packing",
    does: (l) => `Its gold antlers ring: every other friend gets +${l}/+${l} for the rest of the fight.`,
    quip: "Nobody knows whose it is.",
  },
  glorplet: {
    name: "Glorplet",
    atk: 1,
    hp: 1,
    tier: 0,
    when: "",
    does: plain,
    quip: "A bit of Glorp, out on its own.",
  },
  gnat: { name: "Gnat", atk: 1, hp: 1, tier: 0, when: "", does: plain, quip: "There are always more." },
  bramble: {
    name: "Bramble",
    atk: 1,
    hp: 3,
    tier: 0,
    when: "When it is hurt",
    does: (l) => `Thorny: whoever did it takes ${l} damage.`,
    quip: "It was here first.",
  },
  wasp: { name: "Wasp", atk: 3, hp: 1, tier: 0, when: "", does: plain, quip: "All sting, no patience." },
  puddle: { name: "Puddle", atk: 1, hp: 5, tier: 0, when: "", does: plain, quip: "Deeper than it looks." },
  toadstool: {
    name: "Toadstool",
    atk: 2,
    hp: 3,
    tier: 0,
    when: "When it faints",
    does: (l) => `Puffs spores: ${l} damage to every spirit in your line.`,
    quip: "Do not sit on it.",
  },
  gust: {
    name: "Gust",
    atk: 2,
    hp: 3,
    tier: 0,
    when: "Start of the fight",
    does: () => "Blows the spirit at your front to the back of the line. Unless it is a Rock.",
    quip: "Rearranges things.",
  },
  magpie: {
    name: "Magpie",
    atk: 3,
    hp: 3,
    tier: 0,
    when: "Start of the fight",
    does: (l) => `Pecks one of your spirits, whichever it fancies, for ${2 * l} damage.`,
    quip: "Likes shiny things. You are shiny.",
  },
  crab: {
    name: "Crab",
    atk: 2,
    hp: 4,
    tier: 0,
    when: "Shell",
    does: () => "The first hit on it does no harm.",
    quip: "Present at roll call.",
  },
  mud: { name: "Mud", atk: 3, hp: 8, tier: 0, when: "", does: plain, quip: "A great deal of mud." },
  bigcrab: {
    name: "The Crab Nobody Counted",
    atk: 6,
    hp: 30,
    tier: 0,
    when: "After every clash it is in",
    does: () => "Gets crabbier: +1 attack. Its shell takes the first four hits.",
    quip: "Every roll call, one crab is unaccounted for. Here it is.",
  },
};

export const SNACKS = ["berry", "peppernut", "honeycake", "marshmallow", "stew"] as const;
export type SnackKind = (typeof SNACKS)[number];
export interface Snack {
  readonly name: string;
  readonly cost: number;
  readonly atk: number;
  readonly hp: number;
  /** Cushions it leaves the eater with at the start of every fight. */
  readonly cushion: number;
  /** A portion for everyone in the line, not for one spirit. */
  readonly all: boolean;
  readonly does: string;
}
export const SNACK: Record<SnackKind, Snack> = {
  berry: { name: "Berry", cost: 1, atk: 0, hp: 1, cushion: 0, all: false, does: "+1 health, for good." },
  peppernut: { name: "Pepper nut", cost: 2, atk: 2, hp: 0, cushion: 0, all: false, does: "+2 attack, for good." },
  honeycake: { name: "Honey cake", cost: 2, atk: 0, hp: 3, cushion: 0, all: false, does: "+3 health, for good." },
  marshmallow: {
    name: "Marshmallow",
    cost: 3,
    atk: 0,
    hp: 0,
    cushion: 1,
    all: false,
    does: "Starts every fight with a cushion: the first hit on it does no harm.",
  },
  stew: {
    name: "Mushroom stew",
    cost: 4,
    atk: 1,
    hp: 1,
    cushion: 0,
    all: true,
    does: "A bowl for everyone in the line: +1/+1 each, for good.",
  },
};

/** One of the trouble in a wave: what it is, its attack and health, and its ability's level. */
export type Muster = readonly [kind: TroubleKind, atk: number, hp: number, level?: number];
export interface WavePlan {
  readonly name: string;
  readonly party: readonly Muster[];
}
/** What the forest sends, round by round, front first; one of each round's plans is drawn. The last round is the boss. */
export const WAVES: readonly (readonly WavePlan[])[] = [
  [
    {
      name: "A few gnats",
      party: [
        ["gnat", 1, 1],
        ["gnat", 1, 2],
        ["gnat", 1, 1],
      ],
    },
    {
      name: "Gnats in the brambles",
      party: [
        ["gnat", 1, 2],
        ["bramble", 1, 2],
      ],
    },
  ],
  [
    {
      name: "Wasps over a puddle",
      party: [
        ["wasp", 3, 1],
        ["puddle", 2, 5],
        ["gnat", 1, 2],
        ["wasp", 2, 1],
      ],
    },
    {
      name: "A bramble patch",
      party: [
        ["bramble", 1, 3],
        ["wasp", 3, 1],
        ["bramble", 2, 4],
        ["gnat", 1, 1],
      ],
    },
  ],
  [
    {
      name: "Crabs on a breeze",
      party: [
        ["crab", 3, 4],
        ["crab", 3, 4],
        ["wasp", 4, 2],
        ["gust", 2, 4],
      ],
    },
    {
      name: "A magpie and its friends",
      party: [
        ["puddle", 2, 8],
        ["bramble", 2, 4],
        ["wasp", 4, 2],
        ["magpie", 3, 4],
      ],
    },
  ],
  [
    {
      name: "A toadstool ring",
      party: [
        ["toadstool", 3, 4],
        ["puddle", 3, 9],
        ["toadstool", 3, 4],
        ["wasp", 5, 2],
        ["gnat", 2, 2],
      ],
    },
    {
      name: "Crabs in the mud",
      party: [
        ["mud", 3, 9],
        ["crab", 3, 5],
        ["crab", 4, 5],
        ["wasp", 5, 2],
        ["magpie", 3, 4],
      ],
    },
  ],
  [
    {
      name: "A stiff wind",
      party: [
        ["mud", 4, 10],
        ["bramble", 2, 6],
        ["wasp", 6, 3],
        ["gust", 3, 6],
        ["magpie", 4, 4],
      ],
    },
    {
      name: "Roll call",
      party: [
        ["crab", 4, 5],
        ["crab", 4, 5],
        ["crab", 4, 6],
        ["crab", 4, 6],
        ["wasp", 6, 2],
      ],
    },
  ],
  [
    {
      name: "The wet end of the grove",
      party: [
        ["mud", 5, 12],
        ["toadstool", 3, 6, 2],
        ["bramble", 3, 7],
        ["wasp", 7, 3],
        ["magpie", 4, 5],
      ],
    },
    {
      name: "Crabs, with a following wind",
      party: [
        ["crab", 4, 7],
        ["crab", 5, 6],
        ["toadstool", 4, 5, 2],
        ["crab", 5, 6],
        ["gust", 4, 7],
      ],
    },
  ],
  [
    {
      name: "Everything at once",
      party: [
        ["mud", 6, 14],
        ["bramble", 4, 8, 2],
        ["wasp", 8, 4],
        ["toadstool", 4, 7, 2],
        ["gust", 5, 8],
      ],
    },
    {
      name: "The crabs close ranks",
      party: [
        ["crab", 5, 8],
        ["mud", 6, 12],
        ["crab", 5, 8],
        ["wasp", 8, 4],
        ["magpie", 5, 6, 2],
      ],
    },
  ],
  [
    {
      name: "The crab nobody counted",
      party: [
        ["crab", 4, 7],
        ["crab", 4, 7],
        ["bigcrab", 5, 28],
      ],
    },
  ],
];

/** Made-up guild-mates, whose saved parties turn up in friendly bouts. */
export const HANDLES = [
  "Bramblewick",
  "Tansy Fen",
  "old_moss_hat",
  "Quillaby",
  "Pip Underbough",
  "Dunmere",
  "Hobbleknot",
  "Wren of Ash",
] as const;

/**
 * Everything written or made up: the guild-mates and what they say, the shop, the board, the
 * market, what happens in the guild, and how each mate keeps their own camp. All of it stands in
 * for what a server would send.
 */
import type { Look } from "./figure.ts";
import type { GlorpHue } from "./sprites.ts";

export type FixedId = "cabin" | "fire" | "mailbox" | "bench" | "board" | "shelf" | "sign" | "pool";
export type DecoKind = "lamp" | "pot" | "fern" | "gnome" | "stump" | "shroom" | "rug" | "statue" | "flag";
export type Kind = FixedId | DecoKind;
export type UV = [number, number];

export const FIXED: readonly FixedId[] = ["cabin", "fire", "mailbox", "bench", "board", "shelf", "sign", "pool"];

export const NAMES: Record<Kind, string> = {
  cabin: "Cabin",
  fire: "Campfire",
  mailbox: "Mailbox",
  bench: "The Works",
  board: "Quest board",
  shelf: "Trophy shelf",
  sign: "Signpost",
  pool: "Crab pond",
  lamp: "Lantern post",
  pot: "Flower pot",
  fern: "Potted fern",
  gnome: "Gnome",
  stump: "Stump stool",
  shroom: "Mushrooms",
  rug: "Woven rug",
  statue: "Crab statue",
  flag: "Pennant",
};

export const DECOS: readonly DecoKind[] = ["lamp", "pot", "fern", "gnome", "stump", "shroom", "rug", "statue", "flag"];

/** Where things stand by default, as shares of the clearing: across, then from the back to the front. */
export const SPOTS: { wide: Record<FixedId, UV>; tall: Record<FixedId, UV> }[] = [
  {
    wide: {
      cabin: [0.18, 0.16],
      board: [0.43, 0.07],
      bench: [0.62, 0.1],
      shelf: [0.83, 0.13],
      mailbox: [0.045, 0.56],
      fire: [0.49, 0.6],
      sign: [0.9, 0.7],
      pool: [0.2, 0.84],
    },
    tall: {
      cabin: [0.27, 0.07],
      board: [0.66, 0.045],
      shelf: [0.9, 0.09],
      mailbox: [0.08, 0.34],
      bench: [0.77, 0.33],
      fire: [0.5, 0.56],
      sign: [0.86, 0.76],
      pool: [0.27, 0.87],
    },
  },
  {
    wide: {
      cabin: [0.8, 0.17],
      board: [0.2, 0.08],
      bench: [0.4, 0.09],
      shelf: [0.58, 0.07],
      mailbox: [0.95, 0.5],
      fire: [0.36, 0.62],
      sign: [0.9, 0.86],
      pool: [0.68, 0.72],
    },
    tall: {
      cabin: [0.7, 0.07],
      board: [0.25, 0.05],
      shelf: [0.08, 0.28],
      mailbox: [0.93, 0.33],
      bench: [0.25, 0.4],
      fire: [0.55, 0.6],
      sign: [0.88, 0.82],
      pool: [0.3, 0.8],
    },
  },
  {
    wide: {
      cabin: [0.5, 0.14],
      board: [0.23, 0.12],
      bench: [0.78, 0.13],
      shelf: [0.07, 0.34],
      mailbox: [0.68, 0.36],
      fire: [0.3, 0.68],
      sign: [0.93, 0.74],
      pool: [0.66, 0.82],
    },
    tall: {
      cabin: [0.5, 0.08],
      board: [0.13, 0.22],
      shelf: [0.9, 0.2],
      mailbox: [0.78, 0.36],
      bench: [0.24, 0.5],
      fire: [0.62, 0.62],
      sign: [0.88, 0.84],
      pool: [0.3, 0.84],
    },
  },
];

export type PetSpec =
  | { kind: "glorp"; hue: GlorpHue; name: string; sprout?: boolean }
  | { kind: "cat"; name: string }
  | { kind: "fox"; name: string };

export interface CampSpec {
  home: "cabin" | "tent";
  roof: string;
  /** Which of the layouts in `SPOTS`. */
  plan: number;
  rose: boolean;
  lights: boolean;
  pets: PetSpec[];
  /** Decorations as [kind, across, back-to-front]. */
  extras: [DecoKind, number, number][];
  /** Fixed things this camp goes without. */
  lacks: FixedId[];
  banner: number;
}

export const MY_PETS: PetSpec[] = [
  { kind: "glorp", hue: "blue", name: "Glape", sprout: true },
  { kind: "cat", name: "Erm" },
  { kind: "fox", name: "Snowdrop" },
];
export const SHOP_PET: PetSpec = { kind: "glorp", hue: "pink", name: "Glorpe" };

export const MY_EXTRAS: [DecoKind, number, number][] = [
  ["lamp", 0.33, 0.3],
  ["rug", 0.66, 0.74],
  ["pot", 0.1, 0.42],
  ["stump", 0.74, 0.5],
  ["shroom", 0.93, 0.44],
];

export const RANKS = ["Seed", "Sprout", "Sapling", "Bough", "Canopy", "Elder"] as const;

export interface Mate {
  id: string;
  name: string;
  rank: (typeof RANKS)[number];
  level: number;
  look: Look;
  /** What their card says they are up to when they are not here. */
  doing: string;
  camp: CampSpec;
  /** Lines only they say. */
  own: string[];
}

export const MATES: Mate[] = [
  {
    id: "thistle",
    name: "Thistlewick",
    rank: "Canopy",
    level: 61,
    doing: "sorting lanterns by hum",
    own: ["I have opinions about your roof.", "A wizard is never late. I was lost."],
    look: {
      skin: "#e8b48a",
      hair: "#d8d0e8",
      cut: "long",
      eyes: "#3b7340",
      shirt: "#5a296e",
      trim: "#f5b95e",
      sleeves: "long",
      pants: "#3d2050",
      boots: "#3b1f19",
      hat: "wizard",
      hatInk: "#5a296e",
    },
    camp: {
      home: "cabin",
      roof: "plum",
      plan: 1,
      rose: true,
      lights: true,
      banner: 2,
      lacks: [],
      pets: [
        { kind: "fox", name: "Hex" },
        { kind: "glorp", hue: "plum", name: "Orb" },
      ],
      extras: [
        ["lamp", 0.1, 0.3],
        ["lamp", 0.52, 0.34],
        ["lamp", 0.93, 0.26],
        ["flag", 0.66, 0.2],
        ["rug", 0.36, 0.86],
        ["statue", 0.08, 0.8],
        ["fern", 0.7, 0.36],
      ],
    },
  },
  {
    id: "ember",
    name: "Emberlyn",
    rank: "Bough",
    level: 44,
    doing: "teaching a glorp to fetch",
    own: ["I brought marshmallows. I ate the marshmallows.", "Your fox likes me best."],
    look: {
      skin: "#c98a5e",
      hair: "#e67967",
      cut: "bun",
      eyes: "#3b1f19",
      shirt: "#3b7340",
      trim: "#f5b95e",
      sleeves: "short",
      pants: "#593d29",
      boots: "#3b1f19",
      extra: "scarf",
    },
    camp: {
      home: "tent",
      roof: "coral",
      plan: 2,
      rose: false,
      lights: false,
      banner: 0,
      lacks: ["shelf"],
      pets: [
        { kind: "glorp", hue: "gold", name: "Toast" },
        { kind: "glorp", hue: "pink", name: "Jam" },
        { kind: "glorp", hue: "green", name: "Pea" },
      ],
      extras: [
        ["pot", 0.38, 0.3],
        ["pot", 0.62, 0.3],
        ["pot", 0.12, 0.6],
        ["stump", 0.5, 0.86],
        ["stump", 0.14, 0.86],
        ["rug", 0.5, 0.4],
        ["shroom", 0.86, 0.5],
      ],
    },
  },
  {
    id: "barkley",
    name: "Old Barkley",
    rank: "Elder",
    level: 88,
    doing: "telling the fire a long story",
    own: ["In my day the crabs had names.", "Sit. The fire likes company."],
    look: {
      skin: "#e8b48a",
      hair: "#a6a6a6",
      cut: "short",
      eyes: "#4a7fc0",
      shirt: "#79553a",
      trim: "#3b1f19",
      sleeves: "long",
      pants: "#525252",
      boots: "#3b1f19",
      extra: "beard",
    },
    camp: {
      home: "cabin",
      roof: "moss",
      plan: 0,
      rose: false,
      lights: true,
      banner: 1,
      lacks: [],
      pets: [
        { kind: "cat", name: "Mister Bark" },
        { kind: "cat", name: "Second Cat" },
      ],
      extras: [
        ["lamp", 0.34, 0.28],
        ["lamp", 0.96, 0.4],
        ["gnome", 0.72, 0.46],
        ["gnome", 0.78, 0.5],
        ["gnome", 0.66, 0.52],
        ["fern", 0.06, 0.4],
        ["stump", 0.8, 0.9],
      ],
    },
  },
  {
    id: "pipkin",
    name: "Pipkin",
    rank: "Sprout",
    level: 12,
    doing: "counting crabs, losing count",
    own: ["ribbit. I mean hi.", "Is it true you have NINE crabs?"],
    look: {
      skin: "#f0c9a0",
      hair: "#3b1f19",
      cut: "hood",
      eyes: "#1a0f1e",
      shirt: "#62a658",
      trim: "#3b7340",
      sleeves: "long",
      pants: "#3b7340",
      boots: "#24482a",
      hat: "frog",
      hatInk: "#62a658",
    },
    camp: {
      home: "tent",
      roof: "moss",
      plan: 1,
      rose: false,
      lights: false,
      banner: 3,
      lacks: ["bench"],
      pets: [
        { kind: "glorp", hue: "green", name: "Frog One", sprout: true },
        { kind: "glorp", hue: "green", name: "Frog Two" },
      ],
      extras: [
        ["shroom", 0.1, 0.4],
        ["shroom", 0.3, 0.3],
        ["shroom", 0.56, 0.36],
        ["shroom", 0.74, 0.9],
        ["shroom", 0.16, 0.9],
        ["statue", 0.5, 0.9],
        ["fern", 0.92, 0.3],
      ],
    },
  },
  {
    id: "nettle",
    name: "Nettlejack",
    rank: "Bough",
    level: 39,
    doing: "oiling something that ticks",
    own: ["The Works is humming tonight.", "I can fix that. I can also break it."],
    look: {
      skin: "#a9744f",
      hair: "#2a1733",
      cut: "spiky",
      eyes: "#3b1f19",
      shirt: "#3a7f86",
      trim: "#d49045",
      sleeves: "long",
      pants: "#3d2050",
      boots: "#3b1f19",
      extra: "goggles",
    },
    camp: {
      home: "tent",
      roof: "sky",
      plan: 2,
      rose: false,
      lights: false,
      banner: 2,
      lacks: [],
      pets: [{ kind: "glorp", hue: "blue", name: "Sprocket" }],
      extras: [
        ["statue", 0.1, 0.5],
        ["statue", 0.9, 0.36],
        ["statue", 0.5, 0.44],
        ["lamp", 0.4, 0.34],
        ["stump", 0.14, 0.76],
        ["flag", 0.94, 0.56],
      ],
    },
  },
  {
    id: "quill",
    name: "Quillow",
    rank: "Sapling",
    level: 27,
    doing: "painting a banner, badly, happily",
    own: ["I painted your crabs. They would not sit still.", "The light is good here."],
    look: {
      skin: "#f0c9a0",
      hair: "#6fb0e8",
      cut: "long",
      eyes: "#5a296e",
      shirt: "#fff3cf",
      trim: "#e67fb0",
      sleeves: "short",
      pants: "#b84d84",
      boots: "#5a296e",
      extra: "apron",
      extraInk: "#e67fb0",
      hat: "leaf",
      hatInk: "#62a658",
    },
    camp: {
      home: "cabin",
      roof: "coral",
      plan: 2,
      rose: true,
      lights: true,
      banner: 0,
      lacks: [],
      pets: [
        { kind: "cat", name: "Smudge" },
        { kind: "glorp", hue: "pink", name: "Blot" },
      ],
      extras: [
        ["pot", 0.34, 0.34],
        ["pot", 0.4, 0.36],
        ["flag", 0.08, 0.2],
        ["flag", 0.92, 0.2],
        ["rug", 0.5, 0.52],
        ["fern", 0.14, 0.6],
        ["lamp", 0.86, 0.5],
      ],
    },
  },
  {
    id: "marrow",
    name: "Marrowmoss",
    rank: "Canopy",
    level: 57,
    doing: "standing very still in the ferns",
    own: ["I was a bush for an hour. Nobody noticed.", "Moss is a lifestyle."],
    look: {
      skin: "#d9c9b0",
      hair: "#24482a",
      cut: "hood",
      eyes: "#f5b95e",
      shirt: "#2f5c34",
      trim: "#62a658",
      sleeves: "long",
      pants: "#24482a",
      boots: "#3b1f19",
      extra: "stripe",
      extraInk: "#3b7340",
    },
    camp: {
      home: "cabin",
      roof: "moss",
      plan: 1,
      rose: false,
      lights: false,
      banner: 1,
      lacks: ["board"],
      pets: [{ kind: "fox", name: "Lichen" }],
      extras: [
        ["fern", 0.1, 0.3],
        ["fern", 0.2, 0.36],
        ["fern", 0.42, 0.3],
        ["fern", 0.9, 0.5],
        ["fern", 0.12, 0.7],
        ["shroom", 0.56, 0.9],
        ["stump", 0.84, 0.76],
      ],
    },
  },
  {
    id: "soot",
    name: "Sootsprite",
    rank: "Sapling",
    level: 21,
    doing: "poking the embers",
    own: ["I am not on fire. Today.", "meow."],
    look: {
      skin: "#e8b48a",
      hair: "#1a0f1e",
      cut: "hood",
      eyes: "#e67967",
      shirt: "#3a3340",
      trim: "#e67967",
      sleeves: "long",
      pants: "#2a1733",
      boots: "#1a0f1e",
      extra: "stripe",
      extraInk: "#e67967",
      hat: "ears",
      hatInk: "#3a3340",
    },
    camp: {
      home: "tent",
      roof: "plum",
      plan: 0,
      rose: true,
      lights: false,
      banner: 3,
      lacks: ["pool"],
      pets: [
        { kind: "cat", name: "Cinder" },
        { kind: "glorp", hue: "gold", name: "Spark" },
      ],
      extras: [
        ["lamp", 0.36, 0.3],
        ["lamp", 0.2, 0.84],
        ["lamp", 0.76, 0.84],
        ["stump", 0.3, 0.5],
        ["rug", 0.2, 0.66],
        ["gnome", 0.94, 0.4],
      ],
    },
  },
];

/** The shopkeeper. */
export const CINFY: Look = {
  skin: "#e8b48a",
  hair: "#593d29",
  cut: "short",
  eyes: "#24482a",
  shirt: "#5a296e",
  trim: "#f5b95e",
  sleeves: "long",
  pants: "#2a1733",
  boots: "#1a0f1e",
  extra: "visor",
  extraInk: "#62a658",
};

/** What the member wears when no sheet of their own is beside the page. */
export const SPARE_LOOK: Look = {
  skin: "#e8b48a",
  hair: "#6f3826",
  cut: "short",
  eyes: "#3b1f19",
  shirt: "#f5b95e",
  trim: "#8a4a30",
  sleeves: "long",
  pants: "#3d2050",
  boots: "#3b1f19",
  extra: "scarf",
  extraInk: "#3b7340",
};

export const HELLO = ["evening!", "knock knock.", "room by the fire?", "hi hi hi.", "I come bearing a pinecone.", "smelled the fire. came over."];
export const BYE = ["leafin. night!", "back to my camp.", "gn. glory to Sequoia.", "off I go. be nice to the fox."];
export const CHAT = [
  "erm. nice camp.",
  "groot in ten? I brought snacks.",
  "your crabs are plotting something.",
  "no gg left behind!",
  "glory to Sequoia. also hi.",
  "I counted the crabs. don't ask.",
  "who let the gnome in?",
  "this is the best fire. I checked.",
  "seqwawa.",
  "we held the ridge! barely!",
  "one more story, then leafin.",
  "your cabin smells like cedar.",
  "Cinfy says hi. Cinfy also says pay up.",
  "raid was a mess. ten out of ten.",
  "the glorp winked at me.",
  "is that crab meant to be up there?",
];
export const CHEERS = ["gg!", "LET'S GO", "glory!", "groot!", "woo!", "gg gg gg"];
export const WAVES = ["o/", "hey you.", "evening!", "hi!", "there you are."];
export const WELCOME = ["welcome back!", "there you are!", "you missed a good raid.", "the fire's warm."];
export const HOST_HI = ["you came! sit, sit.", "welcome to my camp.", "mind the gnome.", "oh! a visitor. hi."];
export const GIFT_THANKS = ["for me? erm. thank you.", "I will treasure this pinecone.", "you shouldn't have. (you should.)"];

export const RAIDS = ["the Sunken Vault", "the Lantern Depths", "the Thornwarden", "the Hollow King", "the Brine Cellar"];

export interface Land {
  name: string;
  ink: string;
  dark: string;
}
export const LANDS: Land[] = [
  { name: "Cinder Ridge", ink: "#b84d84", dark: "#7a348a" },
  { name: "the Old Orchard", ink: "#3b7340", dark: "#24482a" },
  { name: "Mistfall Crossing", ink: "#4a7fc0", dark: "#3d2050" },
  { name: "Gull Rock", ink: "#d49045", dark: "#8a4a30" },
];

export interface ShopItem {
  id: "glorp" | "lights" | "rose";
  name: string;
  blurb: string;
  price: number;
}
export const SHOP: ShopItem[] = [
  { id: "glorp", name: "Glorpe, a pink glorp", blurb: "Round. Pleased to be here. Comes when it likes.", price: 30 },
  { id: "lights", name: "String of lanterns", blurb: "For the cabin's eave. Lit, obviously.", price: 18 },
  { id: "rose", name: "Rosewood logs", blurb: "The fire burns pink. Smells faintly of jam.", price: 12 },
];

export interface Listing {
  by: string;
  what: string;
  note: string;
  price: number;
  reply: string;
}
export const MARKET: Listing[] = [
  { by: "nettle", what: "A raid carry, any vault", note: "I bring the key. You bring snacks.", price: 20, reply: "deal. tomorrow, after supper." },
  { by: "quill", what: "A banner, hand-painted", note: "Your crabs on it, if they hold still.", price: 14, reply: "yes!! send me your colours." },
  { by: "pipkin", what: "Crab-sitting, one evening", note: "I will count them every hour.", price: 3, reply: "ribbit. your crabs are in good claws." },
  { by: "barkley", what: "A lantern that hums", note: "It only knows one tune. It is a good tune.", price: 9, reply: "it's yours. it hums when it rains." },
];

export interface Quest {
  id: "raids" | "seats" | "land";
  name: string;
  what: string;
  need: number;
  leaf: number;
  note?: string;
}
export const QUESTS: Quest[] = [
  { id: "raids", name: "Groot together", what: "Finish 3 guild raids", need: 3, leaf: 15 },
  { id: "seats", name: "Warm seats", what: "Sit by a fire with 3 guild-mates", need: 3, leaf: 8 },
  {
    id: "land",
    name: "Hold the line",
    what: "The guild wins 2 territories tonight",
    need: 2,
    leaf: 10,
    note: "Everyone shares this one. Open for 1h 12m.",
  },
];

export const CRAB_HIDES: Partial<Record<FixedId, string>> = {
  cabin: "on the cabin roof",
  shelf: "on the trophy shelf",
  board: "behind the quest board",
  bench: "inside the Works",
  mailbox: "on the mailbox",
};

export const TREASURY_LINES = {
  hello: "Welcome to the Treasury. Mind the ledger.",
  bought: "A pleasure. It is already on its way.",
  short: (n: number): string => `erm. You are ${n} Leaf short.`,
  owned: "Sold. To you. I wrote it down.",
  all: "You have bought everything. I am proud and also bored.",
};

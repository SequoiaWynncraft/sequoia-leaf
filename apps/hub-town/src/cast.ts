/** The made-up guild: who is about, what they look like, and the things they say. Nobody here is a real member. */

import type { Look } from "./skin.ts";
import type { Errand } from "./world.ts";

export interface Member {
  name: string;
  rank: string;
  level: number;
  /** How high their voice is, for the blips when they speak. */
  voice: number;
  look: Look;
}

export const RANKS = ["Seedling", "Sapling", "Ranger", "Warden", "Elder"] as const;

export const CINFY: Member = {
  name: "Cinfy",
  rank: "Keeper of the Treasury",
  level: 99,
  voice: 520,
  look: {
    skin: "#f6dcc2",
    hair: "#f1e2a6",
    light: "#fff8d8",
    eye: "#5a296e",
    top: "#5a296e",
    legs: "#3d2050",
    shoes: "#2a1733",
    style: "long",
    sleeves: "long",
    detail: "buttons",
    trim: "#f5b95e",
    glasses: true,
  },
};

export const YOU: Look = {
  skin: "#eec39a",
  hair: "#6f3826",
  light: "#a35d3b",
  eye: "#243a66",
  top: "#b84d84",
  legs: "#3d2050",
  shoes: "#3b1f19",
  style: "short",
  sleeves: "long",
  detail: "scarf",
  trim: "#f5b95e",
};

export const MATES: readonly Member[] = [
  {
    name: "Mossback",
    rank: "Warden",
    level: 91,
    voice: 300,
    look: {
      skin: "#d9a57c",
      hair: "#3b7340",
      light: "#62a658",
      eye: "#3b1f19",
      top: "#6f3826",
      legs: "#2f5c34",
      shoes: "#3b1f19",
      style: "hood",
      sleeves: "long",
      detail: "belt",
      trim: "#d49045",
    },
  },
  {
    name: "Pipwick",
    rank: "Sapling",
    level: 34,
    voice: 760,
    look: {
      skin: "#f0c8a0",
      hair: "#e0823a",
      light: "#f5b95e",
      eye: "#2f5884",
      top: "#2f8a8a",
      legs: "#593d29",
      shoes: "#3b1f19",
      style: "short",
      sleeves: "short",
      detail: "scarf",
      trim: "#f5b95e",
    },
  },
  {
    name: "Quillfeather",
    rank: "Elder",
    level: 104,
    voice: 380,
    look: {
      skin: "#8a5a3c",
      hair: "#e8e4f0",
      light: "#ffffff",
      eye: "#f5b95e",
      top: "#5a296e",
      legs: "#3d2050",
      shoes: "#2a1733",
      style: "long",
      sleeves: "long",
      detail: "belt",
      trim: "#f5b95e",
    },
  },
  {
    name: "Tindra",
    rank: "Ranger",
    level: 67,
    voice: 680,
    look: {
      skin: "#f2cfae",
      hair: "#e88fb4",
      light: "#ffc2d8",
      eye: "#3b7340",
      top: "#f3e6c8",
      legs: "#b84d84",
      shoes: "#542a1f",
      style: "long",
      sleeves: "short",
      detail: "apron",
      trim: "#b84d84",
    },
  },
  {
    name: "Bramblewick",
    rank: "Ranger",
    level: 58,
    voice: 340,
    look: {
      skin: "#d9a57c",
      hair: "#6f3826",
      light: "#8a4a30",
      eye: "#3b1f19",
      top: "#4b8c4a",
      legs: "#79553a",
      shoes: "#3b1f19",
      style: "cap",
      sleeves: "short",
      trim: "#e8c860",
    },
  },
  {
    name: "Embertoe",
    rank: "Warden",
    level: 88,
    voice: 420,
    look: {
      skin: "#f5d2b4",
      hair: "#c2382e",
      light: "#e67967",
      eye: "#3b1f19",
      top: "#4a4a52",
      legs: "#2e2e36",
      shoes: "#1a0f1e",
      style: "short",
      sleeves: "long",
      detail: "apron",
      trim: "#8a4a30",
    },
  },
  {
    name: "Sootpaw",
    rank: "Sapling",
    level: 41,
    voice: 880,
    look: {
      skin: "#f2dcc8",
      hair: "#2b2530",
      light: "#e88fb4",
      eye: "#62a658",
      top: "#3a3340",
      legs: "#2b2530",
      shoes: "#2b2530",
      style: "ears",
      sleeves: "long",
      hands: "#f3ede0",
      detail: "scarf",
      trim: "#e67967",
    },
  },
  {
    name: "Wrenly",
    rank: "Ranger",
    level: 72,
    voice: 600,
    look: {
      skin: "#f0c8a0",
      hair: "#3f6fb0",
      light: "#7aa8e0",
      eye: "#3b1f19",
      top: "#efe2c0",
      legs: "#243a66",
      shoes: "#3b1f19",
      style: "short",
      sleeves: "long",
      detail: "buttons",
      trim: "#d49045",
      glasses: true,
    },
  },
  {
    name: "Fernwhistle",
    rank: "Seedling",
    level: 12,
    voice: 720,
    look: {
      skin: "#7a4a30",
      hair: "#4b8c4a",
      light: "#8fd07a",
      eye: "#f5b95e",
      top: "#f0c040",
      legs: "#6f3826",
      shoes: "#2a1733",
      style: "long",
      sleeves: "long",
      detail: "buttons",
      trim: "#fff3cf",
    },
  },
];

/** What people say while about an errand, by where they are. */
export const LINES: Readonly<Record<Errand | "fire" | "bench" | "any", readonly string[]>> = {
  treasury: ["just looking, Cinfy", "how much for the sun?", "put it on my tab", "ooh, shiny"],
  quests: ["ooh, a new one", "three raids? easy.", "who pinned this upside down", "erm. which one's mine"],
  market: ["is this haunted?", "fresh bread!", "I'll take two", "does it come in gold"],
  stall: ["best prices in the grove!", "no refunds. be nice.", "handmade! mostly!", "one careful owner"],
  works: ["the belt is so soothing", "clank. clank. clank.", "who took my planks", "it's making more planks"],
  pond: ["hello, crab 3", "where IS number 7", "I counted eight. again.", "they're plotting"],
  tree: ["one lantern a raid", "prettiest tree in the grove", "this one's mine, top left"],
  pole: ["glory to the grove", "we should take another", "nice banner"],
  garden: ["a gnome moved this mushroom", "smells like rain", "the ferns are loud tonight"],
  gate: ["ready?", "buffs up", "go go go", "no gg left behind"],
  fire: ["scooch over", "tell the gnome one again", "the fire's warm tonight", "one more raid? one more raid.", "meow"],
  bench: ["my feet hurt", "five more minutes", "nice evening"],
  any: ["erm", "be nice", "leafin' it up", "brb, snack", "has anyone seen crab 7?", "I should be asleep", "nice hat"],
};

export const CHEERS = [
  "gg!",
  "ggs!",
  "no gg left behind!",
  "glory to the grove!",
  "woo!",
  "let's gooo",
  "huge",
] as const;
export const GREETS = ["hi!", "oh hey!", "welcome back!", "hiya", "evening!", "you're here!"] as const;
export const DOING: Readonly<Record<Errand | "fire" | "bench" | "walk" | "raid", string>> = {
  treasury: "Eyeing the gold at the Treasury",
  quests: "Reading the quest board",
  market: "Browsing the market",
  stall: "Minding a stall",
  works: "Watching the belt at the Works",
  pond: "Counting crabs",
  tree: "Admiring the lantern tree",
  pole: "Looking up at the banner",
  garden: "Pottering in the garden",
  gate: "Mustering for a raid",
  fire: "Sitting by the fire",
  bench: "Resting on the bench",
  walk: "Out for a wander",
  raid: "Away on a raid",
};

export const RAIDS = ["the Hollow Vault", "the Sunken Orchard", "the Clockwork Canopy", "the Amber Deep"] as const;
export const LANDS = [
  "Emberfall Ridge",
  "Mossgate Crossing",
  "the Lantern Shallows",
  "Thistle Reach",
  "Old Root Hollow",
] as const;

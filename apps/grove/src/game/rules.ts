/**
 * The numbers that tune the prototype, in one place: the cone banner's price, odds and pity, care
 * and Bloom, the level cap, and Cinfy's catalogue. Prices sit in DESIGN.md's three bands (everyday
 * 300 to 1,500 Leaf, special 2,000 to 6,000, prestige 10,000 to 50,000). The functions here are pure:
 * they take a random number and return what happens, so the tests can check the maths.
 */

import { type RankName, RANKS } from "../engine/palette.ts";

/** A cone costs this much, one at a time or ten at once: no bulk discount. */
export const CONE_PRICE = 400;
/** A Treant or better is guaranteed within this many cones, and the count carries over between banners. */
export const PITY = 40;
/** The guarantee's floor. */
export const PITY_RANK: RankName = "Treant";

/** What a cone holds, as published on the rate card. Sums to 1. */
export const ODDS: Readonly<Record<RankName, number>> = {
  Leafkin: 0.4,
  Sapling: 0.27,
  Sprite: 0.16,
  Dryad: 0.09,
  Druid: 0.05,
  Treant: 0.025,
  Yggdrasil: 0.005,
};

/** Which spirits each rank can give. Within a rank every spirit is equally likely. */
export const POOLS: Readonly<Record<RankName, readonly string[]>> = {
  Leafkin: ["glarp", "glerp", "glirp", "glorp", "glurp", "glyrp", "gleep"],
  Sapling: ["mossmote", "slug", "crab"],
  Sprite: ["chickaree", "emberkit"],
  Dryad: ["fog-owl", "crab-08"],
  Druid: ["moth", "worm"],
  Treant: ["rock", "greg"],
  Yggdrasil: ["white-fox"],
};

/** The banner on now: a raid's cone season, its featured spirit the face of the raid. */
export const BANNER = {
  id: "tcc",
  title: "The Canyon Colossus",
  raid: "TCC",
  featured: "rock",
  /** A Treant from this banner is the featured spirit this often. */
  featuredShare: 0.5,
  ends: "Ends with Season 33",
} as const;

export const rankIndex = (rank: RankName): number => RANKS.findIndex((r) => r.name === rank);

/** The rank `u` (0 to 1) lands on in the published odds. */
export function rankAt(u: number): RankName {
  let acc = 0;
  for (const r of RANKS) {
    acc += ODDS[r.name];
    if (u < acc) return r.name;
  }
  return "Leafkin";
}

export interface Pull {
  rank: RankName;
  spirit: string;
  /** The pity count after this cone: cones since the last Treant or better. */
  pity: number;
  /** Whether the guarantee made this one. */
  guaranteed: boolean;
}

/**
 * One cone. `pity` is how many cones have opened since the last Treant or better; `random` gives
 * numbers in [0, 1). The fortieth cone without one is lifted to a Treant.
 */
export function openCone(pity: number, random: () => number): Pull {
  let rank = rankAt(random());
  const floor = rankIndex(PITY_RANK);
  const guaranteed = pity + 1 >= PITY && rankIndex(rank) < floor;
  if (guaranteed) rank = PITY_RANK;
  const pool = POOLS[rank];
  const featured = BANNER.featured;
  const spirit =
    rank === PITY_RANK && pool.includes(featured) && random() < BANNER.featuredShare
      ? featured
      : (pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? pool[0] ?? "glorp");
  return { rank, spirit, pity: rankIndex(rank) >= floor ? 0 : pity + 1, guaranteed };
}

/** `n` cones in a row, pity carried from one to the next. */
export function openCones(n: number, pity: number, random: () => number): Pull[] {
  const pulls: Pull[] = [];
  let p = pity;
  for (let i = 0; i < n; i++) {
    const pull = openCone(p, random);
    pulls.push(pull);
    p = pull.pity;
  }
  return pulls;
}

// ---------------------------------------------------------------------------------------------
// Care, Bloom and levels.

/** Care charges bank up to this many; nothing wilts. */
export const CHARGE_MAX = 6;
/** Seconds for a spent charge to come back, in the prototype. */
export const CHARGE_SECONDS = 9;
/** Bloom segments; a full Bloom gives a free cone. */
export const BLOOM_MAX = 10;
/** SEQ levels run 1 to 13: 13 is the Giant, and nobody is there yet. */
export const LEVEL_MAX = 13;
/** Leaf one watering of the Great Sequoia costs; each hangs your lantern in its branches. */
export const GREAT_WATER_PRICE = 100;

/** A bond's hearts from how many of a spirit you have: duplicates deepen it, to five. */
export const BOND_MAX = 5;
export const hearts = (count: number): number => Math.max(0, Math.min(BOND_MAX, count));
/** The fourth copy turns a spirit Verdant, if it was not already. */
export const VERDANT_AT = 4;
/** The chance of a Verdant coat on any cone. */
export const VERDANT_CHANCE = 0.04;

// ---------------------------------------------------------------------------------------------
// Cinfy's Treasury.

export type Tab = "decor" | "styles" | "lights" | "frames" | "badges";

export const TABS: readonly { id: Tab; name: string }[] = [
  { id: "decor", name: "Decor" },
  { id: "styles", name: "Tree styles" },
  { id: "lights", name: "Lights" },
  { id: "frames", name: "Nametag frames" },
  { id: "badges", name: "Leaf badges" },
];

export interface Item {
  id: string;
  name: string;
  /** The 16x16 icon's name in `ui/menus/icons.ts`. */
  icon: string;
  price: number;
  tab: Tab;
  /** Cinfy's line, in Sequoia Inc.'s voice. */
  blurb: string;
}

export const CATALOGUE: readonly Item[] = [
  {
    id: "swamp-stones",
    name: "Swamp stepping stones",
    icon: "stone",
    price: 650,
    tab: "decor",
    blurb: "Salvaged from the Swamp. Treasury@seqwawa accepts no liability for damp socks.",
  },
  {
    id: "fruma-fern",
    name: "Fruma fern",
    icon: "fern",
    price: 450,
    tab: "decor",
    blurb: "Imported from Fruma at no cost to the guild bank. Please stop asking about the cost.",
  },
  {
    id: "swamp-bloom",
    name: "Swamp bloom",
    icon: "bloom",
    price: 320,
    tab: "decor",
    blurb: "A flower. Leaf has no cash value, and neither, legally, does this.",
  },
  {
    id: "twig-flag",
    name: "Training Twig flag",
    icon: "flag",
    price: 720,
    tab: "decor",
    blurb: "Commemorates new members. Do not The Farm.",
  },
  {
    id: "mushroom-ring",
    name: "Mushroom ring",
    icon: "mushroom",
    price: 1400,
    tab: "decor",
    blurb: "Seven pale caps in a loose ring. The Treasury counted them twice.",
  },
  {
    id: "amber-canopy",
    name: "Amber canopy",
    icon: "glade",
    price: 4800,
    tab: "styles",
    blurb: "Your crown in early autumn amber. Your tree grows by guild play alone; this only changes its coat.",
  },
  {
    id: "dusk-cedar",
    name: "Dusk cedar bark",
    icon: "forest",
    price: 2500,
    tab: "styles",
    blurb: "A deeper cinnamon. Sequoia Inc. is not a lumber company, whatever the minutes say.",
  },
  {
    id: "cinfy-lantern",
    name: "Cinfy lantern",
    icon: "lamp",
    price: 900,
    tab: "lights",
    blurb: "Lights your glade. Borrowed lanterns must be returned to the vault by Friday.",
  },
  {
    id: "firefly-jar",
    name: "Firefly jar",
    icon: "star",
    price: 800,
    tab: "lights",
    blurb: "Fireflies, on loan from the forest. They clock out at dawn.",
  },
  {
    id: "fairy-lights",
    name: "Winter fairy lights",
    icon: "lights",
    price: 3200,
    tab: "lights",
    blurb: "Strung through your crown in winter. Electricity provided by enthusiasm.",
  },
  {
    id: "gilded-grain",
    name: "Gilded grain frame",
    icon: "frame",
    price: 1200,
    tab: "frames",
    blurb: "For your nametag in the Sequoia mod. Gilt is decorative and non-refundable.",
  },
  {
    id: "amethyst-trim",
    name: "Amethyst trim frame",
    icon: "frame-violet",
    price: 850,
    tab: "frames",
    blurb: "Sequoia purple, as approved by the Committee for Purple.",
  },
  {
    id: "great-ring",
    name: "Great Sequoia frame",
    icon: "rings",
    price: 12000,
    tab: "frames",
    blurb: "Prestige. Treasury@seqwawa regrets to inform you that this one is, in fact, expensive.",
  },
  {
    id: "fern-badge",
    name: "Fern green badge",
    icon: "leaf",
    price: 450,
    tab: "badges",
    blurb: "Your Leaf badge in fern green. The Leaf inside is the same Leaf.",
  },
  {
    id: "verdant-badge",
    name: "Verdant gold badge",
    icon: "goldleaf",
    price: 6000,
    tab: "badges",
    blurb: "Gold, the SEQ colour. Leaf has no cash value, even when it is gold.",
  },
  {
    id: "sun-pennant",
    name: "Sun pennant badge",
    icon: "pennant",
    price: 25000,
    tab: "badges",
    blurb: "The guild banner's orange sun. Reserved for members the Treasury is slightly afraid of.",
  },
];

/** Today's four trades, picked from the catalogue by the day number, so everyone sees the same four. */
export function dailyTrades(day: number): Item[] {
  const picks: Item[] = [];
  let k = day * 5;
  while (picks.length < 4) {
    const item = CATALOGUE[((k % CATALOGUE.length) + CATALOGUE.length) % CATALOGUE.length];
    if (item && !picks.includes(item)) picks.push(item);
    k += 3;
  }
  return picks;
}

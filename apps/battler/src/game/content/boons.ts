/**
 * Boons: three times a run the party is offered three and keeps one. Some change the stall and the
 * purse, some change the fight, and seven are charms that count as one more of a kin. Words and
 * numbers only; `run.ts` and `fight/` read the numbers.
 */
import type { KinId } from "./traits.ts";

export const BOON_IDS = [
  "deeppockets",
  "regular",
  "quickstudy",
  "windfall",
  "basket",
  "widestall",
  "haggler",
  "secondwind",
  "headstart",
  "extrachair",
  "blanket",
  "smallfry",
  "formation",
  "embercharm",
  "mosscharm",
  "mistcharm",
  "burrowcharm",
  "feathercharm",
  "crabcharm",
  "gnomecharm",
] as const;
export type BoonId = (typeof BOON_IDS)[number];

export interface BoonSpec {
  readonly name: string;
  readonly sort: "purse" | "party" | "charm";
  /** With `{name}` filled from `n`. */
  readonly text: string;
  readonly n: Readonly<Record<string, number>>;
  /** For a charm: the kin it counts as one more of. */
  readonly charm?: KinId;
  readonly quip: string;
}

export const BOONS: Record<BoonId, BoonSpec> = {
  deeppockets: {
    name: "Deep Pockets",
    sort: "purse",
    text: "Savings pay an acorn for every {per} held instead of every 10, and can reach {cap} a room instead of 5.",
    n: { per: 5, cap: 6 },
    quip: "There is always room for one more acorn.",
  },
  regular: {
    name: "A Regular",
    sort: "purse",
    text: "The stallholder knows you: {rustles} more free rustle every room.",
    n: { rustles: 1 },
    quip: "The usual? The usual.",
  },
  quickstudy: {
    name: "Quick Study",
    sort: "purse",
    text: "Every room teaches {xp} experience instead of 2.",
    n: { xp: 4 },
    quip: "Was paying attention after all.",
  },
  windfall: {
    name: "Windfall",
    sort: "purse",
    text: "{acorns} acorns, now.",
    n: { acorns: 10 },
    quip: "Stood under the right tree.",
  },
  basket: {
    name: "A Basket On The Stump",
    sort: "purse",
    text: "Somebody left {components} item components for you. Nobody says who.",
    n: { components: 2 },
    quip: "The note just says “for the raid”.",
  },
  widestall: {
    name: "A Wider Stall",
    sort: "purse",
    text: "The stall shows {offers} figures instead of 5.",
    n: { offers: 6 },
    quip: "They found another plank.",
  },
  haggler: {
    name: "Haggler",
    sort: "purse",
    text: "The first figure you buy each room costs {off} acorns less.",
    n: { off: 2 },
    quip: "It was a long conversation.",
  },
  secondwind: {
    name: "Second Wind",
    sort: "party",
    text: "The first of your figures to fall each fight gets back up, once, with {health}% of its health.",
    n: { health: 40 },
    quip: "Was only resting.",
  },
  headstart: {
    name: "Head Start",
    sort: "party",
    text: "Your figures start every fight with {mana} more mana.",
    n: { mana: 25 },
    quip: "Thought about it on the walk over.",
  },
  extrachair: {
    name: "An Extra Chair",
    sort: "party",
    text: "You may field {more} more figure than your level.",
    n: { more: 1 },
    quip: "Budge up.",
  },
  blanket: {
    name: "Warm Blanket",
    sort: "party",
    text: "{now} resolve back now, and every room you lose costs {less} less.",
    n: { now: 4, less: 1 },
    quip: "It is hard to be downhearted under it.",
  },
  smallfry: {
    name: "Small Fry",
    sort: "party",
    text: "Your one- and two-acorn figures have {boost}% more health and attack.",
    n: { boost: 18 },
    quip: "Little, and a lot of them.",
  },
  formation: {
    name: "Tidy Formation",
    sort: "party",
    text: "Figures that start in your front row have {armour} more armour; figures that start in your back row attack {speed}% faster.",
    n: { armour: 25, speed: 15 },
    quip: "Tall ones at the back, please.",
  },
  embercharm: {
    name: "Coal On A String",
    sort: "charm",
    charm: "ember",
    text: "Counts as one more Ember.",
    n: {},
    quip: "Still warm.",
  },
  mosscharm: {
    name: "Pocket Moss",
    sort: "charm",
    charm: "moss",
    text: "Counts as one more Moss.",
    n: {},
    quip: "It was in the pocket already.",
  },
  mistcharm: {
    name: "Jar Of Fog",
    sort: "charm",
    charm: "mist",
    text: "Counts as one more Mist.",
    n: {},
    quip: "Keep the lid on.",
  },
  burrowcharm: {
    name: "A Small Hole",
    sort: "charm",
    charm: "burrow",
    text: "Counts as one more Burrow.",
    n: {},
    quip: "Portable.",
  },
  feathercharm: {
    name: "Lucky Feather",
    sort: "charm",
    charm: "feather",
    text: "Counts as one more Feather.",
    n: {},
    quip: "Lucky for you. Less so for the bird.",
  },
  crabcharm: {
    name: "Roll Call Sheet",
    sort: "charm",
    charm: "crab",
    text: "Counts as one more Crab.",
    n: {},
    quip: "One name is smudged.",
  },
  gnomecharm: {
    name: "Spare Hat",
    sort: "charm",
    charm: "gnome",
    text: "Counts as one more Gnome.",
    n: {},
    quip: "Pointed. Red. Unclaimed.",
  },
};

export const isBoonId = (v: unknown): v is BoonId => typeof v === "string" && Object.hasOwn(BOONS, v);
/** What a boon does, in a sentence. */
export function boonText(id: BoonId): string {
  const spec = BOONS[id];
  return spec.text.replaceAll(/\{(\w+)\}/g, (whole: string, key: string) => {
    const v = spec.n[key];
    return v === undefined ? whole : String(v);
  });
}
/** One of a boon's numbers; 0 if it has no such number. */
export const boonNumber = (id: BoonId, name: string): number => BOONS[id].n[name] ?? 0;
/** Boons that change something inside a fight, and so travel with a party. */
export const FIGHT_BOONS: readonly BoonId[] = ["secondwind", "headstart", "smallfry", "formation"];

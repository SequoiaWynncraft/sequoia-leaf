/**
 * Boons: three times a run the party is offered three and keeps one. Some change the stall and the
 * purse, some change the fight, and some are charms, each of which gives an emblem (`gives`,
 * `items.ts`): an item whose holder carries a trait as well. A boon may also be made by a recipe
 * (`made`, `recipes.ts`). Words and numbers only; `run.ts` and `fight/` read the numbers.
 *
 * The boons here are those the base release brought (`releases/base.ts`); later releases bring
 * more and change these in their patches (`releases/`). A boon is read from a catalogue
 * (`catalog.ts`), as its era has it.
 */
import type { Catalog } from "./catalog.ts";
import { type ComponentId, grantOf, type ItemId } from "./items.ts";
import { opened } from "./patch.ts";
import type { TraitId } from "./traits.ts";

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
  "grootercharm",
  "choruscharm",
  "graidcharm",
  "sneakcharm",
] as const;
export type BoonId = (typeof BOON_IDS)[number];

export interface BoonSpec {
  readonly name: string;
  readonly sort: "purse" | "party" | "charm";
  /** With `{name}` filled from `n`. */
  readonly text: string;
  /** The same in a few words for a card, filled the same way. */
  readonly short: string;
  readonly n: Readonly<Record<string, number>>;
  readonly quip: string;
  /** For a charm, the item it gives, for one figure to hold. */
  readonly gives?: ItemId;
  /**
   * The two items that make it when they meet (`combine`), held or on the rack. Such a boon is only
   * held: taking it does nothing else, so making it draws nothing.
   */
  readonly made?: readonly [ComponentId, ComponentId];
}

/** The boons the base release brought: read only by its patch (`releases/base.ts`). */
export const BASE_BOONS: Readonly<Partial<Record<BoonId, BoonSpec>>> = {
  deeppockets: {
    name: "Deep Pockets",
    sort: "purse",
    text: "Savings pay an acorn for every {per} held instead of every 10, and can reach {cap} a room instead of 5.",
    short: "Savings pay per {per} acorns held, up to {cap}.",
    n: { per: 5, cap: 6 },
    quip: "There is always room for one more acorn.",
  },
  regular: {
    name: "A Regular",
    sort: "purse",
    text: "{rustles} more free reroll every room.",
    short: "+{rustles} free reroll every room.",
    n: { rustles: 1 },
    quip: "The usual? The usual.",
  },
  quickstudy: {
    name: "Quick Study",
    sort: "purse",
    text: "Every room gives {xp} XP instead of 2.",
    short: "{xp} XP a room, not 2.",
    n: { xp: 4 },
    quip: "Was paying attention after all.",
  },
  windfall: {
    name: "Windfall",
    sort: "purse",
    text: "{acorns} acorns, now.",
    short: "+{acorns} acorns now.",
    n: { acorns: 10 },
    quip: "Stood under the right tree.",
  },
  basket: {
    name: "A Basket On The Stump",
    sort: "purse",
    text: "Somebody left {components} item components for you. Nobody says who.",
    short: "+{components} item components now.",
    n: { components: 2 },
    quip: "The note just says “for the raid”.",
  },
  widestall: {
    name: "A Wider Stall",
    sort: "purse",
    text: "The stall shows {offers} figures instead of 5.",
    short: "Stall shows {offers} figures.",
    n: { offers: 6 },
    quip: "They found another plank.",
  },
  haggler: {
    name: "Haggler",
    sort: "purse",
    text: "The first figure you buy each room costs {off} acorns less.",
    short: "First buy each room costs {off} less.",
    n: { off: 2 },
    quip: "It was a long conversation.",
  },
  secondwind: {
    name: "Second Wind",
    sort: "party",
    text: "Each fight, the first of your figures to fall gets back up with {health}% of its health.",
    short: "Each fight, your first figure to fall gets up. It has {health}% of its health.",
    n: { health: 40 },
    quip: "Was only resting.",
  },
  headstart: {
    name: "Head Start",
    sort: "party",
    text: "Your figures start every fight with {mana} more mana.",
    short: "+{mana} mana at the start of fights.",
    n: { mana: 25 },
    quip: "Thought about it on the walk over.",
  },
  extrachair: {
    name: "An Extra Chair",
    sort: "party",
    text: "You may field {more} more figure than your level.",
    short: "Field {more} more figure than your level.",
    n: { more: 1 },
    quip: "Budge up.",
  },
  blanket: {
    name: "Warm Blanket",
    sort: "party",
    text: "{now} health back now, and every room you lose costs {less} less.",
    short: "+{now} health now. Lost rooms cost {less} less.",
    n: { now: 4, less: 1 },
    quip: "It is hard to be downhearted under it.",
  },
  smallfry: {
    name: "Small Fry",
    sort: "party",
    text: "Your one- and two-acorn figures have {boost}% more health and attack.",
    short: "1- and 2-acorn figures: +{boost}% health, attack.",
    n: { boost: 18 },
    quip: "Little, and a lot of them.",
  },
  formation: {
    name: "Tidy Formation",
    sort: "party",
    text: "Figures that start in your front row have {armour} more armour; figures that start in your back row attack {speed}% faster.",
    short: "Front row +{armour} armour. Back row +{speed}% speed.",
    n: { armour: 25, speed: 15 },
    quip: "Tall ones at the back, please.",
  },
  embercharm: {
    name: "Coal On A String",
    sort: "charm",
    gives: "embercharm",
    text: "An emblem for one figure to hold: it is an Ember as well, and counts as one more Ember.",
    short: "Gives an emblem. Its holder is an Ember too.",
    n: {},
    quip: "Still warm.",
  },
  mosscharm: {
    name: "Pocket Moss",
    sort: "charm",
    gives: "mosscharm",
    text: "An emblem for one figure to hold: it is a Moss as well, and counts as one more Moss.",
    short: "Gives an emblem. Its holder is a Moss too.",
    n: {},
    quip: "It was in the pocket already.",
  },
  mistcharm: {
    name: "Jar Of Fog",
    sort: "charm",
    gives: "mistcharm",
    text: "An emblem for one figure to hold: it is a Mist as well, and counts as one more Mist.",
    short: "Gives an emblem. Its holder is a Mist too.",
    n: {},
    quip: "Keep the lid on.",
  },
  burrowcharm: {
    name: "A Small Hole",
    sort: "charm",
    gives: "burrowcharm",
    text: "An emblem for one figure to hold: it is a Burrow as well, and counts as one more Burrow.",
    short: "Gives an emblem. Its holder is a Burrow too.",
    n: {},
    quip: "Portable.",
  },
  feathercharm: {
    name: "Lucky Feather",
    sort: "charm",
    gives: "feathercharm",
    text: "An emblem for one figure to hold: it is a Feather as well, and counts as one more Feather.",
    short: "Gives an emblem. Its holder is a Feather too.",
    n: {},
    quip: "Lucky for you. Less so for the bird.",
  },
  crabcharm: {
    name: "Roll Call Sheet",
    sort: "charm",
    gives: "crabcharm",
    text: "An emblem for one figure to hold: it is a Crab as well, and counts as one more Crab.",
    short: "Gives an emblem. Its holder is a Crab too.",
    n: {},
    quip: "One name is smudged.",
  },
  gnomecharm: {
    name: "Spare Hat",
    sort: "charm",
    gives: "gnomecharm",
    text: "An emblem for one figure to hold: it is a Gnome as well, and counts as one more Gnome.",
    short: "Gives an emblem. Its holder is a Gnome too.",
    n: {},
    quip: "Pointed. Red. Unclaimed.",
  },
};

export const isBoonId = (v: unknown): v is BoonId => BOON_IDS.some((id) => id === v);
/** A boon as a catalogue has it. */
export const boonIn = (cat: Catalog, id: BoonId): BoonSpec => opened(cat.boons, id, cat.era);
const filled = (spec: BoonSpec, text: string): string =>
  text.replaceAll(/\{(\w+)\}/g, (whole: string, key: string) => {
    const v = spec.n[key];
    return v === undefined ? whole : String(v);
  });
/** What a boon does, in a sentence. */
export function boonText(cat: Catalog, id: BoonId): string {
  const spec = boonIn(cat, id);
  return filled(spec, spec.text);
}
/** What a boon does, in a few words for a card. */
export function boonShort(cat: Catalog, id: BoonId): string {
  const spec = boonIn(cat, id);
  return filled(spec, spec.short);
}
/** One of a boon's numbers; 0 if it has no such number, or the catalogue has no such boon. */
export const boonNumber = (cat: Catalog, id: BoonId, name: string): number => cat.boons[id]?.n[name] ?? 0;
/** One of a boon's numbers if it is among the boons held (`has`); else what it is without. */
export const boonOr = (cat: Catalog, has: readonly BoonId[], id: BoonId, name: string, without: number): number =>
  has.includes(id) ? boonNumber(cat, id, name) : without;
/** What a boon gives to hold: a charm's emblem; nothing for any other boon. */
export function giftOf(cat: Catalog, id: BoonId): ItemId[] {
  const { gives } = boonIn(cat, id);
  return gives === undefined ? [] : [gives];
}
/** The trait what a boon gives grants its holder: a charm's; none for any other boon. */
export const giftsTrait = (cat: Catalog, id: BoonId): TraitId | undefined =>
  giftOf(cat, id).flatMap((item) => grantOf(cat, item) ?? [])[0];
/** Boons that change something inside a fight, and so travel with a party. */
export const FIGHT_BOONS: readonly BoonId[] = ["secondwind", "headstart", "smallfry", "formation"];

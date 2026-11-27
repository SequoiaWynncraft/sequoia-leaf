/**
 * Items: five plain components, one stat each, and the fifteen things any two of them make when
 * the same figure holds both. A finished item has the stats of both its halves and one effect of
 * its own. And the emblems a charm boon gives: whoever holds one carries its trait as well, an
 * origin or a class. Words and numbers only; the effects happen in `fight/`.
 *
 * Every item is one `ItemSpec`, whatever its sort: its own stats, the trait it grants its holder
 * (any origin or class), the two halves it is made of, and its words. What two items make is asked
 * of `combine` (`recipes.ts`) alone. How an item is come by (a pick, a boon, the rack) is not on it.
 *
 * The items here are those the base release brought (`releases/base.ts`); later releases bring
 * more and change these in their patches (`releases/`). An item is read from a catalogue
 * (`catalog.ts`), as its era has it.
 */
import type { Catalog } from "./catalog.ts";
import { isFigureId, traitsOf, type UnitKind } from "./figures.ts";
import { opened } from "./patch.ts";
import { type TraitId, traitIn } from "./traits.ts";

/** The five plain components, and the Carving Knife (Penguin Month), which turns up only after a boss (`turnsUp`). */
export const COMPONENT_IDS = ["thorn", "plume", "glowcap", "bark", "chestnut", "knife"] as const;
export type ComponentId = (typeof COMPONENT_IDS)[number];

/** What an item adds: percent of attack, of attack speed and of health; points of ability power, armour and ward. */
export interface ItemStats {
  readonly attack: number;
  readonly speed: number;
  readonly power: number;
  readonly armour: number;
  readonly ward: number;
  readonly health: number;
}
/** None of any stat. */
export const NO_STATS: ItemStats = { attack: 0, speed: 0, power: 0, armour: 0, ward: 0, health: 0 };

export const FINISHED_IDS = [
  "blackthorn",
  "wasptail",
  "glowthorn",
  "hedgehog",
  "conker",
  "hummingbird",
  "mothlantern",
  "quilt",
  "honeycake",
  "fairyring",
  "lichen",
  "stewpot",
  "stump",
  "hollowlog",
  "hoard",
] as const;
export type FinishedId = (typeof FINISHED_IDS)[number];
/**
 * The emblems: one a charm gives has the id of the charm boon that gives it (`BoonSpec.gives`); one
 * the Carving Knife makes with a component (`made`) is given by no charm.
 */
export const EMBLEM_IDS = [
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
  "huddlecharm",
  "woodentooth",
  "woodensling",
  "woodenspectacles",
  "woodenbuckler",
  "woodenspoon",
  "canopycharm",
] as const;
export type EmblemId = (typeof EMBLEM_IDS)[number];
export type ItemId = ComponentId | FinishedId | EmblemId;

/** An item of any sort, as a release brings it. */
export interface ItemSpec {
  /** Which list its id is in: a component, a finished item, or an emblem (an item that grants a trait). */
  readonly sort: "component" | "finished" | "emblem";
  readonly name: string;
  /** What it adds of its own. What it is made of adds its stats as well (`itemStats`). */
  readonly stats: ItemStats;
  /** Its holder carries this trait as well, and counts as one more of it: any origin or class. */
  readonly grants?: TraitId;
  /** The two items that make it when they meet (`combine`), either way round. */
  readonly made?: readonly [ComponentId, ComponentId];
  /** For a component that is never drawn as the others are: where it turns up instead (the Knife, after a boss). */
  readonly turnsUp?: "boss";
  /** What it does besides its stats and its trait, in a sentence, with `{name}` filled from `n`; empty for nothing. */
  readonly text: string;
  /** The same in a few words for a card on the table, filled the same way. */
  readonly short: string;
  readonly n: Readonly<Record<string, number>>;
  readonly quip: string;
}

const component = (name: string, stats: Partial<ItemStats>, short: string, quip: string): ItemSpec => ({
  sort: "component",
  name,
  stats: { ...NO_STATS, ...stats },
  text: "",
  short,
  n: {},
  quip,
});
const finished = (spec: Omit<ItemSpec, "sort" | "stats">): ItemSpec => ({ sort: "finished", stats: NO_STATS, ...spec });
/** An emblem a charm gives: the charm's name and quip, the trait, and (from Groot Night) its own stats. */
export const emblem = (grants: TraitId, name: string, quip: string, stats: Partial<ItemStats> = {}): ItemSpec => ({
  sort: "emblem",
  name,
  stats: { ...NO_STATS, ...stats },
  grants,
  text: "",
  short: "",
  n: {},
  quip,
});

/** The items the base release brought: read only by its patch (`releases/base.ts`). */
export const BASE_ITEMS: Readonly<Partial<Record<ItemId, ItemSpec>>> = {
  thorn: component("Thorn", { attack: 15 }, "+15% attack.", "Pointy end toward the trouble."),
  plume: component("Plume", { speed: 15 }, "+15% attack speed.", "Somebody is missing a tail feather."),
  glowcap: component("Glowcap", { power: 20 }, "+20 ability power.", "Glows. Hums a little, if you listen."),
  bark: component("Bark", { armour: 20, ward: 20 }, "+20 armour, +20 ward.", "Worse than its bite."),
  chestnut: component("Chestnut", { health: 15 }, "+15% health.", "Roasted. Still warm."),

  blackthorn: finished({
    name: "Blackthorn Sprig",
    made: ["thorn", "thorn"],
    text: "Its attacks ignore {pierce}% of the target's armour.",
    short: "Attacks ignore {pierce}% of armour.",
    n: { pierce: 40 },
    quip: "Finds the gap in anything.",
  }),
  wasptail: finished({
    name: "Wasp-Tail Dart",
    made: ["thorn", "plume"],
    text: "Every {every}rd attack lands twice.",
    short: "Every {every}rd attack hits twice.",
    n: { every: 3 },
    quip: "Borrowed from a wasp. The wasp knows.",
  }),
  glowthorn: finished({
    name: "Glowthorn",
    made: ["thorn", "glowcap"],
    text: "Each attack gives {mana} more mana.",
    short: "+{mana} mana per attack.",
    n: { mana: 5 },
    quip: "Every poke is a small idea.",
  }),
  hedgehog: finished({
    name: "Hedgehog Coat",
    made: ["thorn", "bark"],
    text: "Whenever an enemy hits it up close, that enemy takes magic damage equal to {prickle}% of the holder's max health.",
    short: "Enemies that hit it up close take damage. It is {prickle}% of the holder's max health.",
    n: { prickle: 3 },
    quip: "Warm. Hard to hug.",
  }),
  conker: finished({
    name: "Conker On A String",
    made: ["thorn", "chestnut"],
    text: "Its attacks also hit 1 enemy next to the target, for {clip}% of the damage.",
    short: "Attacks also hit 1 enemy next to the target. That hit does {clip}% damage.",
    n: { clip: 50 },
    quip: "Undefeated since autumn.",
  }),
  hummingbird: finished({
    name: "Hummingbird Charm",
    made: ["plume", "plume"],
    text: "Reaches {reach} hex further.",
    short: "+{reach} reach.",
    n: { reach: 1 },
    quip: "Never quite where you left it.",
  }),
  mothlantern: finished({
    name: "Moth Lantern",
    made: ["plume", "glowcap"],
    text: "Starts every fight with {head}% mana.",
    short: "Starts fights with {head}% mana.",
    n: { head: 50 },
    quip: "The moths were already inside.",
  }),
  quilt: finished({
    name: "Quilted Vest",
    made: ["plume", "bark"],
    text: "Dodges {slip}% of attacks made on it.",
    short: "Dodges {slip}% of attacks.",
    n: { slip: 20 },
    quip: "Stuffed with down. Whose is not known.",
  }),
  honeycake: finished({
    name: "Honey Cake",
    made: ["plume", "chestnut"],
    text: "Its attacks heal it for {leech}% of the damage they do.",
    short: "Attacks heal {leech}% of damage dealt.",
    n: { leech: 20 },
    quip: "Sticky. Nobody minds.",
  }),
  fairyring: finished({
    name: "Fairy Ring",
    made: ["glowcap", "glowcap"],
    text: "Each time it uses its ability, it gains {grow} ability power for the rest of the fight.",
    short: "+{grow} ability power after each cast.",
    n: { grow: 20 },
    quip: "Do not step in it. Step in it.",
  }),
  lichen: finished({
    name: "Lichen Locket",
    made: ["glowcap", "bark"],
    text: "When it uses its ability it shields itself for {shield}% of its health, for {lasts} seconds.",
    short: "On cast, shield {shield}% of health for {lasts}s.",
    n: { shield: 15, lasts: 4 },
    quip: "Has been growing on somebody for years.",
  }),
  stewpot: finished({
    name: "Stewpot",
    made: ["glowcap", "chestnut"],
    text: "Every {every} seconds it heals the most hurt ally for {heal}% of their max health.",
    short: "Every {every}s, heals most hurt ally {heal}% health.",
    n: { every: 3, heal: 5 },
    quip: "Mushroom stew. A bowl for everyone.",
  }),
  stump: finished({
    name: "Stump Shield",
    made: ["bark", "bark"],
    text: "Draws fire: enemies pick it as if it stood {draw} hex nearer. It cannot be crit, and stuns on it are {steady}% shorter.",
    short: "Draws fire. Cannot be crit; stuns {steady}% shorter.",
    n: { steady: 75, draw: 1 },
    quip: "A slice of something that fell over long ago.",
  }),
  hollowlog: finished({
    name: "Hollow Log",
    made: ["bark", "chestnut"],
    text: "Once a fight, when it drops under {under}% health, it gets a shield worth {shield}% of its max health for {lasts} seconds.",
    short: "Once a fight, under {under}% health: a shield. It is {shield}% of its health, for {lasts}s.",
    n: { under: 40, shield: 30, lasts: 5 },
    quip: "Somewhere to go and think about what happened.",
  }),
  hoard: finished({
    name: "Winter Hoard",
    made: ["chestnut", "chestnut"],
    text: "Heals {regrow}% of its max health every second.",
    short: "Heals {regrow}% of its health a second.",
    n: { regrow: 2 },
    quip: "Enough to see anybody through.",
  }),
  embercharm: emblem("ember", "Coal On A String", "Still warm."),
  mosscharm: emblem("moss", "Pocket Moss", "It was in the pocket already."),
  mistcharm: emblem("mist", "Jar Of Fog", "Keep the lid on."),
  burrowcharm: emblem("burrow", "A Small Hole", "Portable."),
  feathercharm: emblem("feather", "Lucky Feather", "Lucky for you. Less so for the bird."),
  crabcharm: emblem("crab", "Roll Call Sheet", "One name is smudged."),
  gnomecharm: emblem("gnome", "Spare Hat", "Pointed. Red. Unclaimed."),
};

export const ITEM_IDS: readonly ItemId[] = [...COMPONENT_IDS, ...FINISHED_IDS, ...EMBLEM_IDS];
/** How many items one figure can hold. */
export const HOLDS = 3;

const isOne = <K extends string>(ids: readonly K[], v: unknown): v is K => ids.some((id) => id === v);
export const isComponentId = (v: unknown): v is ComponentId => isOne(COMPONENT_IDS, v);
export const isFinishedId = (v: unknown): v is FinishedId => isOne(FINISHED_IDS, v);
export const isEmblemId = (v: unknown): v is EmblemId => isOne(EMBLEM_IDS, v);
export const isItemId = (v: unknown): v is ItemId => isComponentId(v) || isFinishedId(v) || isEmblemId(v);
/** The sort an id's list gives it: what its spec must say. */
export const sortOf = (id: ItemId): ItemSpec["sort"] =>
  isComponentId(id) ? "component" : isFinishedId(id) ? "finished" : "emblem";

/** The components a pick, a basket or the carousel draws from: all a catalogue has open but those that turn up elsewhere. */
export const drawnComponents = (cat: Catalog): readonly ComponentId[] =>
  cat.ids.components.filter((id) => itemIn(cat, id).turnsUp === undefined);

/** An item as a catalogue has it. */
export const itemIn = (cat: Catalog, id: ItemId): ItemSpec => opened(cat.items, id, cat.era);
/** One of an item's numbers; 0 if it has no such number. */
export const itemNumber = (cat: Catalog, id: ItemId, name: string): number => itemIn(cat, id).n[name] ?? 0;
/** The two halves a finished item is made of, as a catalogue has its recipe. */
export function halvesOf(cat: Catalog, id: FinishedId): readonly [ComponentId, ComponentId] {
  const { made } = itemIn(cat, id);
  if (!made) throw new Error(`${id} is made of nothing at era ${cat.era}`);
  return made;
}
/** The trait an item grants its holder, if it grants one. */
export const grantOf = (cat: Catalog, id: ItemId): TraitId | undefined => itemIn(cat, id).grants;
/** The trait an emblem grants: every emblem grants one. */
export function emblemTrait(cat: Catalog, id: EmblemId): TraitId {
  const trait = grantOf(cat, id);
  if (trait === undefined) throw new Error(`${id} grants nothing at era ${cat.era}`);
  return trait;
}

/** A trait's name with "a" or "an" before it: "a Crab", "an Ember". */
function aTrait(cat: Catalog, trait: TraitId): string {
  const { name } = traitIn(cat, trait);
  return `${/^[AEIOU]/.test(name) ? "an" : "a"} ${name}`;
}

/** The traits a figure carries: its own, then the trait each item it holds grants. Nobody else carries any. */
export function carriedTraits(cat: Catalog, kind: UnitKind, items: readonly ItemId[]): TraitId[] {
  if (!isFigureId(kind)) return [];
  const out: TraitId[] = [...traitsOf(cat, kind)];
  for (const item of items) {
    const trait = grantOf(cat, item);
    if (trait !== undefined && !out.includes(trait)) out.push(trait);
  }
  return out;
}
/** Whether a figure carries a trait, as its own or by an item it holds. */
export const carries = (cat: Catalog, kind: UnitKind, items: readonly ItemId[], trait: TraitId): boolean =>
  carriedTraits(cat, kind, items).includes(trait);

/** What an item adds: its own stats, and those of the two halves it is made of. */
export function itemStats(cat: Catalog, id: ItemId): ItemStats {
  const spec = itemIn(cat, id);
  const parts = [spec.stats, ...(spec.made ?? []).map((half) => itemIn(cat, half).stats)];
  const sum = (stat: keyof ItemStats): number => parts.reduce((n, s) => n + s[stat], 0);
  return {
    attack: sum("attack"),
    speed: sum("speed"),
    power: sum("power"),
    armour: sum("armour"),
    ward: sum("ward"),
    health: sum("health"),
  };
}
export const itemName = (cat: Catalog, id: ItemId): string => itemIn(cat, id).name;
export const itemQuip = (cat: Catalog, id: ItemId): string => itemIn(cat, id).quip;
/** What an item adds, in numbers, as short parts: `+15% attack`, `+20 armour`. */
export function itemAdds(cat: Catalog, id: ItemId): string[] {
  const s = itemStats(cat, id);
  return [
    s.attack ? `+${s.attack}% attack` : "",
    s.speed ? `+${s.speed}% attack speed` : "",
    s.power ? `+${s.power} ability power` : "",
    s.armour ? `+${s.armour} armour` : "",
    s.ward ? `+${s.ward} ward` : "",
    s.health ? `+${s.health}% health` : "",
  ].filter((part) => part !== "");
}
/** An item's own words, `{name}` filled from its numbers. */
const filled = (spec: ItemSpec, words: string): string =>
  words.replaceAll(/\{(\w+)\}/g, (whole: string, key: string) => {
    const v = spec.n[key];
    return v === undefined ? whole : String(v);
  });
/** What an item does in a few words for a card: the trait it grants, then its own short words. */
export function itemShort(cat: Catalog, id: ItemId): string {
  const spec = itemIn(cat, id);
  const grants = spec.grants === undefined ? "" : `Its holder is ${aTrait(cat, spec.grants)} too.`;
  return [grants, filled(spec, spec.short)].filter((part) => part !== "").join(" ");
}
/** What an item does, in a sentence or two: its stats, the trait it grants, then what else it does. */
export function itemText(cat: Catalog, id: ItemId): string {
  const spec = itemIn(cat, id);
  const s = itemStats(cat, id);
  const stats = [
    s.attack ? `+${s.attack}% attack` : "",
    s.speed ? `+${s.speed}% attack speed` : "",
    s.power ? `+${s.power} ability power` : "",
    s.armour ? `+${s.armour} armour and +${s.ward} ward` : "",
    s.health ? `+${s.health}% health` : "",
  ].filter((part) => part !== "");
  const { grants } = spec;
  return [
    stats.length > 0 ? `${stats.join(", ")}.` : "",
    grants === undefined
      ? ""
      : `Whoever holds it is ${aTrait(cat, grants)} as well, and counts as one more ${traitIn(cat, grants).name}.`,
    filled(spec, spec.text),
  ]
    .filter((part) => part !== "")
    .join(" ");
}

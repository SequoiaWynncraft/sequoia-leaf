/**
 * Items: five plain components, one stat each, and the fifteen things any two of them make when
 * the same figure holds both. A finished item has the stats of both its halves and one effect of
 * its own. And seven emblems, one for each kin, which a charm boon gives: whoever holds one is of
 * that kin as well. Words and numbers only; the effects happen in `fight/`.
 *
 * The items here are those the base release brought (`releases/base.ts`); later releases bring
 * more and change these in their patches (`releases/`). An item is read from a catalogue
 * (`catalog.ts`), as its era has it.
 */
import { boonIn } from "./boons.ts";
import type { Catalog } from "./catalog.ts";
import { isFigureId, traitsOf, type UnitKind } from "./figures.ts";
import { opened } from "./patch.ts";
import { type KinId, type TraitId, traitIn } from "./traits.ts";

export const COMPONENT_IDS = ["thorn", "plume", "glowcap", "bark", "chestnut"] as const;
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
export interface ComponentSpec {
  readonly name: string;
  readonly stats: ItemStats;
  readonly text: string;
  /** The same for a card on the table. */
  readonly short: string;
  readonly quip: string;
}
const none: ItemStats = { attack: 0, speed: 0, power: 0, armour: 0, ward: 0, health: 0 };

/** The components the base release brought: read only by its patch (`releases/base.ts`). */
export const BASE_COMPONENTS: Readonly<Partial<Record<ComponentId, ComponentSpec>>> = {
  thorn: {
    name: "Thorn",
    stats: { ...none, attack: 15 },
    text: "+15% attack.",
    short: "+15% attack.",
    quip: "Pointy end toward the trouble.",
  },
  plume: {
    name: "Plume",
    stats: { ...none, speed: 15 },
    text: "+15% attack speed.",
    short: "+15% attack speed.",
    quip: "Somebody is missing a tail feather.",
  },
  glowcap: {
    name: "Glowcap",
    stats: { ...none, power: 20 },
    text: "+20 ability power.",
    short: "+20 ability power.",
    quip: "Glows. Hums a little, if you listen.",
  },
  bark: {
    name: "Bark",
    stats: { ...none, armour: 20, ward: 20 },
    text: "+20 armour and +20 ward.",
    short: "+20 armour, +20 ward.",
    quip: "Worse than its bite.",
  },
  chestnut: {
    name: "Chestnut",
    stats: { ...none, health: 15 },
    text: "+15% health.",
    short: "+15% health.",
    quip: "Roasted. Still warm.",
  },
};

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
/** The emblems have the ids of the charm boons that give them, and their names and quips. */
export const EMBLEM_IDS = [
  "embercharm",
  "mosscharm",
  "mistcharm",
  "burrowcharm",
  "feathercharm",
  "crabcharm",
  "gnomecharm",
] as const;
export type EmblemId = (typeof EMBLEM_IDS)[number];
export type ItemId = ComponentId | FinishedId | EmblemId;

export interface FinishedSpec {
  readonly name: string;
  readonly made: readonly [ComponentId, ComponentId];
  /** The effect, in a sentence, with `{name}` filled from `n`. */
  readonly text: string;
  /** The effect in a few words for a card on the table, filled the same way. */
  readonly short: string;
  readonly n: Readonly<Record<string, number>>;
  readonly quip: string;
}

/** The finished items the base release brought: read only by its patch (`releases/base.ts`). */
export const BASE_FINISHED: Readonly<Partial<Record<FinishedId, FinishedSpec>>> = {
  blackthorn: {
    name: "Blackthorn Sprig",
    made: ["thorn", "thorn"],
    text: "Its attacks ignore {pierce}% of the target's armour.",
    short: "Attacks ignore {pierce}% of armour.",
    n: { pierce: 40 },
    quip: "Finds the gap in anything.",
  },
  wasptail: {
    name: "Wasp-Tail Dart",
    made: ["thorn", "plume"],
    text: "Every {every}rd attack lands twice.",
    short: "Every {every}rd attack hits twice.",
    n: { every: 3 },
    quip: "Borrowed from a wasp. The wasp knows.",
  },
  glowthorn: {
    name: "Glowthorn",
    made: ["thorn", "glowcap"],
    text: "Each attack gives {mana} more mana.",
    short: "+{mana} mana per attack.",
    n: { mana: 5 },
    quip: "Every poke is a small idea.",
  },
  hedgehog: {
    name: "Hedgehog Coat",
    made: ["thorn", "bark"],
    text: "Whenever an enemy hits it up close, that enemy takes magic damage equal to {prickle}% of the holder's max health.",
    short: "Enemies that hit it up close take damage. It is {prickle}% of the holder's max health.",
    n: { prickle: 3 },
    quip: "Warm. Hard to hug.",
  },
  conker: {
    name: "Conker On A String",
    made: ["thorn", "chestnut"],
    text: "Its attacks also hit 1 enemy next to the target, for {clip}% of the damage.",
    short: "Attacks also hit 1 enemy next to the target. That hit does {clip}% damage.",
    n: { clip: 50 },
    quip: "Undefeated since autumn.",
  },
  hummingbird: {
    name: "Hummingbird Charm",
    made: ["plume", "plume"],
    text: "Reaches {reach} hex further.",
    short: "+{reach} reach.",
    n: { reach: 1 },
    quip: "Never quite where you left it.",
  },
  mothlantern: {
    name: "Moth Lantern",
    made: ["plume", "glowcap"],
    text: "Starts every fight with {head}% mana.",
    short: "Starts fights with {head}% mana.",
    n: { head: 50 },
    quip: "The moths were already inside.",
  },
  quilt: {
    name: "Quilted Vest",
    made: ["plume", "bark"],
    text: "Dodges {slip}% of attacks made on it.",
    short: "Dodges {slip}% of attacks.",
    n: { slip: 20 },
    quip: "Stuffed with down. Whose is not known.",
  },
  honeycake: {
    name: "Honey Cake",
    made: ["plume", "chestnut"],
    text: "Its attacks heal it for {leech}% of the damage they do.",
    short: "Attacks heal {leech}% of damage dealt.",
    n: { leech: 20 },
    quip: "Sticky. Nobody minds.",
  },
  fairyring: {
    name: "Fairy Ring",
    made: ["glowcap", "glowcap"],
    text: "Each time it uses its ability, it gains {grow} ability power for the rest of the fight.",
    short: "+{grow} ability power after each cast.",
    n: { grow: 20 },
    quip: "Do not step in it. Step in it.",
  },
  lichen: {
    name: "Lichen Locket",
    made: ["glowcap", "bark"],
    text: "When it uses its ability it shields itself for {shield}% of its health, for {lasts} seconds.",
    short: "On cast, shield {shield}% of health for {lasts}s.",
    n: { shield: 15, lasts: 4 },
    quip: "Has been growing on somebody for years.",
  },
  stewpot: {
    name: "Stewpot",
    made: ["glowcap", "chestnut"],
    text: "Every {every} seconds it heals the most hurt ally for {heal}% of their max health.",
    short: "Every {every}s, heals most hurt ally {heal}% health.",
    n: { every: 3, heal: 5 },
    quip: "Mushroom stew. A bowl for everyone.",
  },
  stump: {
    name: "Stump Shield",
    made: ["bark", "bark"],
    text: "Draws fire: enemies pick it as if it stood {draw} hex nearer. It cannot be crit, and stuns on it are {steady}% shorter.",
    short: "Draws fire. Cannot be crit; stuns {steady}% shorter.",
    n: { steady: 75, draw: 1 },
    quip: "A slice of something that fell over long ago.",
  },
  hollowlog: {
    name: "Hollow Log",
    made: ["bark", "chestnut"],
    text: "Once a fight, when it drops under {under}% health, it gets a shield worth {shield}% of its max health for {lasts} seconds.",
    short: "Once a fight, under {under}% health: a shield. It is {shield}% of its health, for {lasts}s.",
    n: { under: 40, shield: 30, lasts: 5 },
    quip: "Somewhere to go and think about what happened.",
  },
  hoard: {
    name: "Winter Hoard",
    made: ["chestnut", "chestnut"],
    text: "Heals {regrow}% of its max health every second.",
    short: "Heals {regrow}% of its health a second.",
    n: { regrow: 2 },
    quip: "Enough to see anybody through.",
  },
};

/**
 * The kin each emblem the base release brought makes whoever holds it: read only by its patch
 * (`releases/base.ts`). An emblem has no stats and does nothing else.
 */
export const BASE_EMBLEMS: Readonly<Partial<Record<EmblemId, KinId>>> = {
  embercharm: "ember",
  mosscharm: "moss",
  mistcharm: "mist",
  burrowcharm: "burrow",
  feathercharm: "feather",
  crabcharm: "crab",
  gnomecharm: "gnome",
};

export const ITEM_IDS: readonly ItemId[] = [...COMPONENT_IDS, ...FINISHED_IDS, ...EMBLEM_IDS];
/** How many items one figure can hold. */
export const HOLDS = 3;

const isOne = <K extends string>(ids: readonly K[], v: unknown): v is K => ids.some((id) => id === v);
export const isComponentId = (v: unknown): v is ComponentId => isOne(COMPONENT_IDS, v);
export const isFinishedId = (v: unknown): v is FinishedId => isOne(FINISHED_IDS, v);
export const isEmblemId = (v: unknown): v is EmblemId => isOne(EMBLEM_IDS, v);
export const isItemId = (v: unknown): v is ItemId => isComponentId(v) || isFinishedId(v) || isEmblemId(v);

/** A component as a catalogue has it. */
export const componentIn = (cat: Catalog, id: ComponentId): ComponentSpec => opened(cat.components, id, cat.era);
/** A finished item as a catalogue has it. */
export const finishedIn = (cat: Catalog, id: FinishedId): FinishedSpec => opened(cat.finished, id, cat.era);
/** One of a finished item's numbers; 0 if it has no such number. */
export const finishedNumber = (cat: Catalog, id: FinishedId, name: string): number => finishedIn(cat, id).n[name] ?? 0;
/** The kin an emblem makes its holder, as a catalogue has it. */
export const emblemKin = (cat: Catalog, id: EmblemId): KinId => opened(cat.emblems, id, cat.era);

/** A kin's name with "a" or "an" before it: "a Crab", "an Ember". */
function aKin(cat: Catalog, kin: KinId): string {
  const { name } = traitIn(cat, kin);
  return `${/^[AEIOU]/.test(name) ? "an" : "a"} ${name}`;
}

/** The traits a figure carries: its own, then the kin of each emblem it holds. Nobody else carries any. */
export function carriedTraits(cat: Catalog, kind: UnitKind, items: readonly ItemId[]): TraitId[] {
  if (!isFigureId(kind)) return [];
  const out: TraitId[] = [...traitsOf(cat, kind)];
  for (const item of items) {
    if (!isEmblemId(item)) continue;
    const kin = emblemKin(cat, item);
    if (!out.includes(kin)) out.push(kin);
  }
  return out;
}
/** Whether a figure carries a trait, as its own or by an emblem it holds. */
export const carries = (cat: Catalog, kind: UnitKind, items: readonly ItemId[], trait: TraitId): boolean =>
  carriedTraits(cat, kind, items).includes(trait);

/** What two components make, as a catalogue has its recipes. */
export function forge(cat: Catalog, a: ComponentId, b: ComponentId): FinishedId {
  for (const id of FINISHED_IDS) {
    const made = cat.finished[id]?.made;
    if (made && ((made[0] === a && made[1] === b) || (made[0] === b && made[1] === a))) return id;
  }
  throw new Error(`nothing is made of ${a} and ${b}`);
}
/** What an item adds: a component's own stat, both halves of a finished one, or nothing for an emblem. */
export function itemStats(cat: Catalog, id: ItemId): ItemStats {
  if (isComponentId(id)) return componentIn(cat, id).stats;
  if (isEmblemId(id)) return none;
  const [a, b] = finishedIn(cat, id).made;
  const x = componentIn(cat, a).stats;
  const y = componentIn(cat, b).stats;
  return {
    attack: x.attack + y.attack,
    speed: x.speed + y.speed,
    power: x.power + y.power,
    armour: x.armour + y.armour,
    ward: x.ward + y.ward,
    health: x.health + y.health,
  };
}
export const itemName = (cat: Catalog, id: ItemId): string =>
  isComponentId(id) ? componentIn(cat, id).name : isEmblemId(id) ? boonIn(cat, id).name : finishedIn(cat, id).name;
export const itemQuip = (cat: Catalog, id: ItemId): string =>
  isComponentId(id) ? componentIn(cat, id).quip : isEmblemId(id) ? boonIn(cat, id).quip : finishedIn(cat, id).quip;
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
/** A finished item's effect words, `{name}` filled from its numbers. */
const effect = (spec: FinishedSpec, words: string): string =>
  words.replaceAll(/\{(\w+)\}/g, (whole: string, key: string) => {
    const v = spec.n[key];
    return v === undefined ? whole : String(v);
  });
/** What an item does in a few words for a card: a component's stat, a finished item's effect, an emblem's kin. */
export function itemShort(cat: Catalog, id: ItemId): string {
  if (isComponentId(id)) return componentIn(cat, id).short;
  if (isEmblemId(id)) return `Its holder is ${aKin(cat, emblemKin(cat, id))} too.`;
  const spec = finishedIn(cat, id);
  return effect(spec, spec.short);
}
/** What an item does, in a sentence or two: its stats, then its effect if it is a finished one. */
export function itemText(cat: Catalog, id: ItemId): string {
  if (isComponentId(id)) return componentIn(cat, id).text;
  if (isEmblemId(id)) {
    const kin = emblemKin(cat, id);
    return `Whoever holds it is ${aKin(cat, kin)} as well, and counts as one more ${traitIn(cat, kin).name}.`;
  }
  const spec = finishedIn(cat, id);
  const s = itemStats(cat, id);
  const stats = [
    s.attack ? `+${s.attack}% attack` : "",
    s.speed ? `+${s.speed}% attack speed` : "",
    s.power ? `+${s.power} ability power` : "",
    s.armour ? `+${s.armour} armour and +${s.ward} ward` : "",
    s.health ? `+${s.health}% health` : "",
  ].filter((part) => part !== "");
  return `${stats.join(", ")}. ${effect(spec, spec.text)}`;
}

/** Why an item cannot be held: no place for it, or an emblem of a kin its holder already carries. */
export type NotHeld = "hands_full" | "already_kin";
/**
 * Puts one more item into what a figure holds, the way handing it over does: a component meets the
 * first loose component already held and the two become a finished item; otherwise it takes a free
 * place. An emblem only ever takes a place, and is not held by a figure that carries its kin
 * already. Gives the new holding and what was forged, or why it cannot be held.
 */
export function holdItem(
  cat: Catalog,
  holder: { readonly kind: UnitKind; readonly items: readonly ItemId[] },
  item: ItemId,
): { held: ItemId[]; forged: FinishedId | null; with: ComponentId | null } | { refused: NotHeld } {
  const held = holder.items;
  if (isEmblemId(item) && carries(cat, holder.kind, held, emblemKin(cat, item))) return { refused: "already_kin" };
  if (isComponentId(item)) {
    const at = held.findIndex(isComponentId);
    const loose = held[at];
    if (loose !== undefined && isComponentId(loose)) {
      const forged = forge(cat, loose, item);
      return { held: held.with(at, forged), forged, with: loose };
    }
  }
  if (held.length >= HOLDS) return { refused: "hands_full" };
  return { held: [...held, item], forged: null, with: null };
}

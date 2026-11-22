/**
 * Items: five plain components, one stat each, and the fifteen things any two of them make when
 * the same figure holds both. A finished item has the stats of both its halves and one effect of
 * its own. Words and numbers only; the effects happen in `fight/`.
 */
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

export const COMPONENTS: Record<ComponentId, ComponentSpec> = {
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
export type ItemId = ComponentId | FinishedId;

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

export const FINISHED: Record<FinishedId, FinishedSpec> = {
  blackthorn: {
    name: "Blackthorn Sprig",
    made: ["thorn", "thorn"],
    text: "Its attacks go through {pierce}% of the target's armour.",
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
    text: "Whoever attacks it up close takes magic damage worth {prickle}% of the wearer's health.",
    short: "Melee attackers take {prickle}% health as magic.",
    n: { prickle: 3 },
    quip: "Warm. Hard to hug.",
  },
  conker: {
    name: "Conker On A String",
    made: ["thorn", "chestnut"],
    text: "Its attacks swing on into one more enemy beside the target, for {clip}% as much.",
    short: "Attacks also hit a neighbour for {clip}%.",
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
    text: "Starts every fight with its mana bar {head}% full.",
    short: "Starts fights with {head}% mana.",
    n: { head: 50 },
    quip: "The moths were already inside.",
  },
  quilt: {
    name: "Quilted Vest",
    made: ["plume", "bark"],
    text: "{slip} attacks in every hundred slip past it.",
    short: "Slips {slip}% of attacks.",
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
    text: "Every time it uses its ability, the ones after are {grow} ability power stronger.",
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
    text: "Every {every} seconds it serves whoever in the party is most hurt: {heal}% of their health back.",
    short: "Every {every}s, heals most hurt ally {heal}% health.",
    n: { every: 3, heal: 5 },
    quip: "Mushroom stew. A bowl for everyone.",
  },
  stump: {
    name: "Stump Shield",
    made: ["bark", "bark"],
    text: "+{draw} draw: enemies pick it as if it stood a hex nearer. No attack lands hard on it, and stuns on it last a quarter as long.",
    short: "+{draw} draw. Never hit hard; stuns a quarter as long.",
    n: { steady: 75, draw: 1 },
    quip: "A slice of something that fell over long ago.",
  },
  hollowlog: {
    name: "Hollow Log",
    made: ["bark", "chestnut"],
    text: "Once a fight, when it drops under {under}% health, it climbs inside: a shield worth {shield}% of its health for {lasts} seconds.",
    short: "Once, at {under}% health: shield {shield}% for {lasts}s.",
    n: { under: 40, shield: 30, lasts: 5 },
    quip: "Somewhere to go and think about what happened.",
  },
  hoard: {
    name: "Winter Hoard",
    made: ["chestnut", "chestnut"],
    text: "Regrows {regrow}% of its health every second.",
    short: "Regrows {regrow}% health/s.",
    n: { regrow: 2 },
    quip: "Enough to see anybody through.",
  },
};

export const ITEM_IDS: readonly ItemId[] = [...COMPONENT_IDS, ...FINISHED_IDS];
/** How many items one figure can hold. */
export const HOLDS = 3;

export const isComponentId = (v: unknown): v is ComponentId => typeof v === "string" && Object.hasOwn(COMPONENTS, v);
export const isFinishedId = (v: unknown): v is FinishedId => typeof v === "string" && Object.hasOwn(FINISHED, v);
export const isItemId = (v: unknown): v is ItemId => isComponentId(v) || isFinishedId(v);

const recipes = new Map<string, FinishedId>();
for (const id of FINISHED_IDS) {
  const [a, b] = FINISHED[id].made;
  recipes.set(`${a}+${b}`, id);
  recipes.set(`${b}+${a}`, id);
}
/** What two components make. */
export function forge(a: ComponentId, b: ComponentId): FinishedId {
  const made = recipes.get(`${a}+${b}`);
  if (made === undefined) throw new Error(`nothing is made of ${a} and ${b}`);
  return made;
}
/** What an item adds: a component's own stat, or both halves of a finished one. */
export function itemStats(id: ItemId): ItemStats {
  if (isComponentId(id)) return COMPONENTS[id].stats;
  const [a, b] = FINISHED[id].made;
  const x = COMPONENTS[a].stats;
  const y = COMPONENTS[b].stats;
  return {
    attack: x.attack + y.attack,
    speed: x.speed + y.speed,
    power: x.power + y.power,
    armour: x.armour + y.armour,
    ward: x.ward + y.ward,
    health: x.health + y.health,
  };
}
export const itemName = (id: ItemId): string => (isComponentId(id) ? COMPONENTS[id].name : FINISHED[id].name);
/** What an item adds, in numbers, as short parts: `+15% attack`, `+20 armour`. */
export function itemAdds(id: ItemId): string[] {
  const s = itemStats(id);
  return [
    s.attack ? `+${s.attack}% attack` : "",
    s.speed ? `+${s.speed}% attack speed` : "",
    s.power ? `+${s.power} ability power` : "",
    s.armour ? `+${s.armour} armour` : "",
    s.ward ? `+${s.ward} ward` : "",
    s.health ? `+${s.health}% health` : "",
  ].filter((part) => part !== "");
}
/** What an item does in a few words for a card: a component's stat, or a finished item's effect. */
export function itemShort(id: ItemId): string {
  if (isComponentId(id)) return COMPONENTS[id].short;
  const spec = FINISHED[id];
  return spec.short.replaceAll(/\{(\w+)\}/g, (whole: string, key: string) => {
    const v = spec.n[key];
    return v === undefined ? whole : String(v);
  });
}
/** What an item does, in a sentence or two: its stats, then its effect if it is a finished one. */
export function itemText(id: ItemId): string {
  if (isComponentId(id)) return COMPONENTS[id].text;
  const spec = FINISHED[id];
  const s = itemStats(id);
  const stats = [
    s.attack ? `+${s.attack}% attack` : "",
    s.speed ? `+${s.speed}% attack speed` : "",
    s.power ? `+${s.power} ability power` : "",
    s.armour ? `+${s.armour} armour and +${s.ward} ward` : "",
    s.health ? `+${s.health}% health` : "",
  ].filter((part) => part !== "");
  const effect = spec.text.replaceAll(/\{(\w+)\}/g, (whole: string, key: string) => {
    const v = spec.n[key];
    return v === undefined ? whole : String(v);
  });
  return `${stats.join(", ")}. ${effect}`;
}

/**
 * Puts one more item into what a figure holds, the way handing it over does: a component meets the
 * first loose component already held and the two become a finished item; otherwise it takes a free
 * place. Gives the new holding and what was forged, or null if there is no room for it.
 */
export function holdItem(
  held: readonly ItemId[],
  item: ItemId,
): { held: ItemId[]; forged: FinishedId | null; with: ComponentId | null } | null {
  if (isComponentId(item)) {
    const at = held.findIndex(isComponentId);
    const loose = held[at];
    if (loose !== undefined && isComponentId(loose)) {
      const forged = forge(loose, item);
      return { held: held.with(at, forged), forged, with: loose };
    }
  }
  if (held.length >= HOLDS) return null;
  return { held: [...held, item], forged: null, with: null };
}

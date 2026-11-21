/**
 * What the table keeps in the browser besides the run and the almanac (which the rules save
 * themselves): how the member likes the table to look, how fast they watch a fight, and which of
 * the first-time nudges they have already had. It is text with a version on it; text that is not
 * this version's starts over, and inside it each part that makes no sense is put back to how a new
 * member has it.
 *
 * The looks are the one thing here bought with Leaf, and they change nothing but the picture.
 *
 * Everything is written through the kit's `keepText`, so a page that has let go of the browser's
 * game (`stopped()`) writes none of it.
 */

import { keepText, keptText } from "@sequoia-leaf/kit/keep.ts";

export const PREFS_VERSION = 1;
export const KEYS = {
  run: "raid.run.v1",
  almanac: "raid.almanac.v1",
  prefs: "raid.prefs.v1",
} as const;

export interface LookSpec<Id extends string> {
  readonly id: Id;
  readonly name: string;
  readonly text: string;
  /** What it costs in Leaf; 0 for the one everybody has. */
  readonly leaf: number;
}

export const CLOTHS = [
  { id: "bare", name: "Bare rings", text: "The stump as it was cut.", leaf: 0 },
  { id: "baize", name: "Green baize", text: "A proper games cloth, moss green.", leaf: 12 },
  { id: "plum", name: "Dusk velvet", text: "Plum velvet with a gold edge. Shows every crumb.", leaf: 18 },
  {
    id: "gingham",
    name: "Picnic gingham",
    text: "Somebody's picnic blanket. They have not asked for it back.",
    leaf: 15,
  },
] as const satisfies readonly LookSpec<string>[];
export const LANTERNS = [
  { id: "iron", name: "Iron lantern", text: "The same as on every post in town.", leaf: 0 },
  { id: "paper", name: "Paper lantern", text: "A rose paper lantern from the tree.", leaf: 10 },
  { id: "jar", name: "Jar of fireflies", text: "They come and go as they please. Mostly they stay.", leaf: 20 },
] as const satisfies readonly LookSpec<string>[];
export const BASES = [
  { id: "plain", name: "Plain bases", text: "Painted the colour of what the figure costs.", leaf: 0 },
  { id: "moss", name: "Mossy bases", text: "Left out on the stump over winter.", leaf: 12 },
  { id: "gilt", name: "Gilt rims", text: "A line of gold round every base.", leaf: 25 },
] as const satisfies readonly LookSpec<string>[];

export type ClothId = (typeof CLOTHS)[number]["id"];
export type LanternId = (typeof LANTERNS)[number]["id"];
export type BaseId = (typeof BASES)[number]["id"];
export type LookId = ClothId | LanternId | BaseId;
export type LookKind = "cloth" | "lantern" | "bases";

export const LOOKS: Readonly<Record<LookKind, readonly LookSpec<LookId>[]>> = {
  cloth: CLOTHS,
  lantern: LANTERNS,
  bases: BASES,
};
export const LOOK_KINDS: readonly LookKind[] = ["cloth", "lantern", "bases"];
export const LOOK_TITLES: Readonly<Record<LookKind, string>> = {
  cloth: "Under the board",
  lantern: "Over the table",
  bases: "Under the figures",
};

export type Speed = 1 | 2 | 4;

export interface Prefs {
  cloth: ClothId;
  lantern: LanternId;
  bases: BaseId;
  /** Looks bought with Leaf. The free ones are never listed. */
  owned: LookId[];
  speed: Speed;
  /** The trail last set out on. */
  trail: number;
  /** Nudges already given, by name. */
  taught: string[];
}

export const newPrefs = (): Prefs => ({
  cloth: "bare",
  lantern: "iron",
  bases: "plain",
  owned: [],
  speed: 1,
  trail: 0,
  taught: [],
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const idOf = <Id extends string>(list: readonly LookSpec<Id>[], v: unknown): Id | null =>
  list.find((l) => l.id === v)?.id ?? null;
/** A look's name as one of its kind, or null if it is not one. */
export const clothOf = (v: unknown): ClothId | null => idOf(CLOTHS, v);
export const lanternOf = (v: unknown): LanternId | null => idOf(LANTERNS, v);
export const baseOf = (v: unknown): BaseId | null => idOf(BASES, v);
const isLookId = (v: unknown): v is LookId =>
  LOOK_KINDS.some((kind) => LOOKS[kind].some((l) => l.id === v && l.leaf > 0));

/** Whether the member may use a look: it is free, or they have bought it. */
export const owns = (prefs: Prefs, kind: LookKind, id: LookId): boolean => {
  const spec = LOOKS[kind].find((l) => l.id === id);
  return spec !== undefined && (spec.leaf === 0 || prefs.owned.includes(id));
};

export const savePrefs = (prefs: Prefs): string =>
  JSON.stringify({ game: "little-raid-prefs", v: PREFS_VERSION, prefs });

/** Prefs from text. Anything that is not this version's gives a new member's prefs. */
export function loadPrefs(text: string | null): Prefs {
  const fresh = newPrefs();
  let raw: unknown;
  try {
    raw = JSON.parse(text ?? "null");
  } catch {
    return fresh;
  }
  if (!isRecord(raw) || raw.game !== "little-raid-prefs" || raw.v !== PREFS_VERSION || !isRecord(raw.prefs)) {
    return fresh;
  }
  const p = raw.prefs;
  const owned: LookId[] = [];
  if (Array.isArray(p.owned)) {
    for (const id of p.owned) if (isLookId(id) && !owned.includes(id)) owned.push(id);
  }
  const prefs: Prefs = { ...fresh, owned };
  const cloth = clothOf(p.cloth);
  const lantern = lanternOf(p.lantern);
  const bases = baseOf(p.bases);
  // A look that was never bought is not worn, whatever the text says.
  if (cloth && owns(prefs, "cloth", cloth)) prefs.cloth = cloth;
  if (lantern && owns(prefs, "lantern", lantern)) prefs.lantern = lantern;
  if (bases && owns(prefs, "bases", bases)) prefs.bases = bases;
  if (p.speed === 1 || p.speed === 2 || p.speed === 4) prefs.speed = p.speed;
  if (typeof p.trail === "number" && Number.isInteger(p.trail) && p.trail >= 0 && p.trail < 3) prefs.trail = p.trail;
  if (Array.isArray(p.taught)) {
    for (const name of p.taught) {
      if (typeof name === "string" && name.length < 40 && !prefs.taught.includes(name) && prefs.taught.length < 64)
        prefs.taught.push(name);
    }
  }
  return prefs;
}

/** Reads a kept text, or null where there is none or no storage. */
export const read = keptText;
/** Keeps a text; `null` forgets it. Without storage, or once the page has stopped, it simply does not last. */
export function keep(key: string, text: string | null): void {
  keepText(key, text);
}

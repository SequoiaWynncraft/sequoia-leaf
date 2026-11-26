/**
 * How the table may look: the place it stands, a cloth under the board, a lantern over it, and the
 * figures' bases. They change nothing but the picture. The plain one of each kind is everybody's;
 * the rest are bought with Leaf (the table's `buyLook`).
 */

import type { LeafFor } from "@sequoia-leaf/core";

export interface LookSpec<Id extends string> {
  readonly id: Id;
  readonly name: string;
  readonly text: string;
  /** What it costs in Leaf; 0 for the one everybody has. */
  readonly leaf: number;
  /** Who may buy it. */
  readonly for: LeafFor;
}

export const PLACES = [
  { id: "clearing", name: "The clearing", text: "The great stump, at dusk.", leaf: 0, for: "everyone" },
  {
    id: "hall",
    name: "The guild hall",
    text: "The long oak table, late, with the hearth still lit.",
    leaf: 40_000,
    for: "everyone",
  },
] as const satisfies readonly LookSpec<string>[];
export const CLOTHS = [
  { id: "bare", name: "Bare wood", text: "The table as it was cut.", leaf: 0, for: "everyone" },
  { id: "baize", name: "Green baize", text: "A proper games cloth, moss green.", leaf: 12_000, for: "everyone" },
  {
    id: "plum",
    name: "Dusk velvet",
    text: "Plum velvet with a gold edge. Shows every crumb.",
    leaf: 28_000,
    for: "everyone",
  },
  {
    id: "gingham",
    name: "Picnic gingham",
    text: "Somebody's picnic blanket. They have not asked for it back.",
    leaf: 12_000,
    for: "everyone",
  },
] as const satisfies readonly LookSpec<string>[];
export const LANTERNS = [
  { id: "iron", name: "Iron lantern", text: "The same as on every post in town.", leaf: 0, for: "everyone" },
  { id: "paper", name: "Paper lantern", text: "A rose paper lantern from the tree.", leaf: 12_000, for: "everyone" },
  {
    id: "jar",
    name: "Jar of fireflies",
    text: "They come and go as they please. Mostly they stay.",
    leaf: 28_000,
    for: "everyone",
  },
] as const satisfies readonly LookSpec<string>[];
export const BASES = [
  { id: "plain", name: "Plain bases", text: "Painted the colour of what the figure costs.", leaf: 0, for: "everyone" },
  { id: "moss", name: "Mossy bases", text: "Left out on the stump over winter.", leaf: 12_000, for: "everyone" },
  { id: "gilt", name: "Gilt rims", text: "A line of gold round every base.", leaf: 28_000, for: "everyone" },
] as const satisfies readonly LookSpec<string>[];

export type PlaceId = (typeof PLACES)[number]["id"];
export type ClothId = (typeof CLOTHS)[number]["id"];
export type LanternId = (typeof LANTERNS)[number]["id"];
export type BaseId = (typeof BASES)[number]["id"];
export type LookId = PlaceId | ClothId | LanternId | BaseId;
export type LookKind = "place" | "cloth" | "lantern" | "bases";

export const LOOKS: Readonly<Record<LookKind, readonly LookSpec<LookId>[]>> = {
  place: PLACES,
  cloth: CLOTHS,
  lantern: LANTERNS,
  bases: BASES,
};
export const LOOK_KINDS: readonly LookKind[] = ["place", "cloth", "lantern", "bases"];
export const LOOK_TITLES: Readonly<Record<LookKind, string>> = {
  place: "Around the table",
  cloth: "Under the board",
  lantern: "Over the table",
  bases: "Under the figures",
};

/** The looks a member has: what is on the table now, and those bought (the free ones are never listed). */
export interface Looks {
  place: PlaceId;
  cloth: ClothId;
  lantern: LanternId;
  bases: BaseId;
  owned: LookId[];
}
export const newLooks = (): Looks => ({
  place: "clearing",
  cloth: "bare",
  lantern: "iron",
  bases: "plain",
  owned: [],
});

const idOf = <Id extends string>(list: readonly LookSpec<Id>[], v: unknown): Id | null =>
  list.find((l) => l.id === v)?.id ?? null;
/** A look's name as one of its kind, or null if it is not one. */
export const lookOf = (kind: LookKind, v: unknown): LookId | null => idOf(LOOKS[kind], v);
export const isLookKind = (v: unknown): v is LookKind => LOOK_KINDS.some((kind) => kind === v);
/** A look that is bought: one of any kind, other than the free one. */
export const isBoughtLook = (v: unknown): v is LookId =>
  LOOK_KINDS.some((kind) => LOOKS[kind].some((l) => l.id === v && l.leaf > 0));

/** Whether the member may use a look: it is free, or they have bought it. */
export function owns(looks: Pick<Looks, "owned">, kind: LookKind, id: string): boolean {
  const spec = LOOKS[kind].find((l) => l.id === id);
  return spec !== undefined && (spec.leaf === 0 || looks.owned.includes(spec.id));
}

/** What is worn of a kind. */
export const wornOf = (looks: Looks, kind: LookKind): LookId => looks[kind];

/** The looks with one more put on, owned or not (trying it on); as they were if it is not one of that kind. */
export function tryOn(looks: Looks, kind: LookKind, id: string): Looks {
  return {
    ...looks,
    place: (kind === "place" ? idOf(PLACES, id) : null) ?? looks.place,
    cloth: (kind === "cloth" ? idOf(CLOTHS, id) : null) ?? looks.cloth,
    lantern: (kind === "lantern" ? idOf(LANTERNS, id) : null) ?? looks.lantern,
    bases: (kind === "bases" ? idOf(BASES, id) : null) ?? looks.bases,
  };
}

/** Puts a look on the table, if it is one of that kind the member may use; says whether it did. */
export function wear(looks: Looks, kind: LookKind, id: string): boolean {
  if (!owns(looks, kind, id)) return false;
  Object.assign(looks, tryOn(looks, kind, id));
  return true;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isLookId = (v: unknown): v is LookId => LOOK_KINDS.some((kind) => LOOKS[kind].some((l) => l.id === v));
/**
 * Looks from plain data, or null if they are not a member's looks. A look bought that is free now
 * is no longer listed as bought, and one worn that is not the member's now is put away for the
 * plain one of its kind. Looks kept before the table had a place are in the clearing.
 */
export function readLooks(v: unknown): Looks | null {
  if (!isRecord(v) || !Array.isArray(v.owned) || v.owned.length > 64) return null;
  const owned: LookId[] = [];
  for (const id of v.owned) {
    if (!isLookId(id) || owned.includes(id)) return null;
    if (isBoughtLook(id)) owned.push(id);
  }
  const looks = newLooks();
  looks.owned = owned;
  for (const kind of LOOK_KINDS) {
    const id = lookOf(kind, kind === "place" ? (v.place ?? looks.place) : v[kind]);
    if (!id) return null;
    wear(looks, kind, id);
  }
  return looks;
}

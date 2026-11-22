/**
 * How the table may look: a cloth under the board, a lantern over it, and the figures' bases. They
 * change nothing but the picture. The plain one of each kind is everybody's; the rest are bought
 * with Leaf, which the game cannot spend yet, so for now nobody owns any of them.
 */

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

/** The looks a member has: what is on the table now, and those bought (the free ones are never listed). */
export interface Looks {
  cloth: ClothId;
  lantern: LanternId;
  bases: BaseId;
  owned: LookId[];
}
export const newLooks = (): Looks => ({ cloth: "bare", lantern: "iron", bases: "plain", owned: [] });

const idOf = <Id extends string>(list: readonly LookSpec<Id>[], v: unknown): Id | null =>
  list.find((l) => l.id === v)?.id ?? null;
/** A look's name as one of its kind, or null if it is not one. */
export const clothOf = (v: unknown): ClothId | null => idOf(CLOTHS, v);
export const lanternOf = (v: unknown): LanternId | null => idOf(LANTERNS, v);
export const baseOf = (v: unknown): BaseId | null => idOf(BASES, v);
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
export const wornOf = (looks: Looks, kind: LookKind): LookId =>
  kind === "cloth" ? looks.cloth : kind === "lantern" ? looks.lantern : looks.bases;

/** Puts a look on the table, if it is one of that kind the member may use; says whether it did. */
export function wear(looks: Looks, kind: LookKind, id: string): boolean {
  if (!owns(looks, kind, id)) return false;
  const cloth = kind === "cloth" ? clothOf(id) : null;
  const lantern = kind === "lantern" ? lanternOf(id) : null;
  const bases = kind === "bases" ? baseOf(id) : null;
  if (cloth) looks.cloth = cloth;
  else if (lantern) looks.lantern = lantern;
  else if (bases) looks.bases = bases;
  else return false;
  return true;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Looks from plain data, or null if they are not a member's looks: nothing is worn that was not bought. */
export function readLooks(v: unknown): Looks | null {
  if (!isRecord(v) || !Array.isArray(v.owned) || v.owned.length > 16) return null;
  const owned: LookId[] = [];
  for (const id of v.owned) {
    if (!isBoughtLook(id) || owned.includes(id)) return null;
    owned.push(id);
  }
  const cloth = clothOf(v.cloth);
  const lantern = lanternOf(v.lantern);
  const bases = baseOf(v.bases);
  if (!cloth || !lantern || !bases) return null;
  const looks: Looks = { cloth, lantern, bases, owned };
  return owns(looks, "cloth", cloth) && owns(looks, "lantern", lantern) && owns(looks, "bases", bases) ? looks : null;
}

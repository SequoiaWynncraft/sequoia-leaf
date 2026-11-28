/**
 * The planner: what pieces make, burn, carry and need a minute, worked out from the tables alone, for
 * a card to show, for the yard's books (`status.ts`'s `machineRate` and `flow`, which scale it by the yard's
 * power) and for balancing. Every piece is taken as working every tick, with power enough and nothing
 * held up; nothing that moves the yard reads it.
 */
import { TICKS } from "./content/machines.ts";
import {
  ALL_ITEMS,
  GATHERING,
  GROW_OF,
  grownIn,
  type Item,
  ITEM_INFO,
  type Kind,
  MIX_OF,
  PACE,
  type Recipe,
  recipeFor,
  timesOf,
  WORK_OF,
} from "./tables.ts";

/** Ticks in a minute. */
export const MINUTE = 600;
/** How far across its tile a thing on a belt is counted in: eighths (`tick.ts`). */
const ACROSS = 8;

/**
 * How many times a minute a piece of a kind and grade finishes: a gatherer's thing, a machine's
 * recipe, a Study's folio. The work in one is the kind's own (`KindDef.work`), or else the recipe's,
 * done as many times as fast as the recipe's own machine as the kind is that many of it (`timesOf`).
 */
export function makes(k: Kind, grade: number, r: Recipe | null): number {
  const own = WORK_OF[k] ?? 0;
  const work = own > 0 ? own : (r?.work ?? 0);
  const times = own > 0 || !r ? 1 : timesOf(k, r);
  return work > 0 ? (MINUTE * (PACE[grade] ?? 0) * times) / work : 0;
}

/**
 * The work in gathering one of each thing, in half-ticks: its own time where its table says
 * (`ItemInfo.gather`: star crystal, 1,500 ticks), else a gatherer's (`TICKS.gather`).
 */
export const GATHER_WORK = Uint16Array.from(ALL_ITEMS, (n) => (ITEM_INFO[n]?.gather ?? TICKS.gather) * 2);

/** How many of a thing from the ground a gatherer of a grade gathers a minute, at the thing's own pace (`GATHER_WORK`). */
export function gathers(n: number, grade: number): number {
  const work = GATHER_WORK[n] ?? WORK_OF[GATHERING] ?? 0;
  return work > 0 ? (MINUTE * (PACE[grade] ?? 0)) / work : 0;
}

/** How many runs a minute a kind that grows a thing (`GROW_OF`) makes at a grade, flat out: each takes 1 of each of what it takes. */
export function growPerMinute(k: Kind, grade: number): number {
  const g = GROW_OF[k];
  return g ? (MINUTE * (PACE[grade] ?? 0)) / g.work : 0;
}

/** How many of what it grows a kind gives a minute for each run, on the whole: 3 for every 2 runs of a grower. */
export function grownPerRun(k: Kind): number {
  const g = GROW_OF[k];
  return g ? grownIn(g) / g.extraEvery : 0;
}

/** How many pieces of deadfall a minute a boiler burns while it makes power, at any grade. */
export const burned = (): number => MINUTE / TICKS.burn;

/** The share of what a kind that breaks a mix gives that is a thing: 8 in 20 of a breaker's are copper; 0 for a thing it never gives. */
export function mixShare(k: Kind, n: Item): number {
  const gives = MIX_OF[k]?.gives ?? [];
  return gives.length === 0 ? 0 : gives.filter((g) => g === n).length / gives.length;
}

/** How many things a kind that breaks a mix gives a minute at a grade, flat out: one for each of what it breaks (`MIXES`). */
export function mixPerMinute(k: Kind, grade: number): number {
  const first = MIX_OF[k]?.gives[0];
  const r = first === undefined ? null : recipeFor(first);
  return r ? makes(k, grade, r) * (r.need[0] ?? 0) : 0;
}

/**
 * How many things a minute a line of belt of a grade carries, fed flat out, and a tunnel, splitter,
 * joiner or sorter of that grade in it: each crosses its tile at a belt's pace. A tile
 * holds one thing, and a thing set on a line starts at its tile's edge and crosses it in whole ticks:
 * 4, 3 and 2 at the three grades' paces, so 150, 200 and 300 a minute. Not 225 at grade 2: what a
 * thing has over at the end of a tile it keeps on the next, so the tiles after the first never hold a
 * line back, but the first lets the next thing on only every third tick, whatever feeds it.
 */
export function carried(grade: number): number {
  const pace = PACE[grade] ?? 0;
  return pace > 0 ? MINUTE / Math.ceil(ACROSS / pace) : 0;
}

/**
 * What a machine of a grade (the recipe's own, unless it says) needs of each part a minute to make a
 * recipe flat out, or to make `made` of it a minute (where the belt it hands to carries less).
 */
export function needs(
  grade: number,
  r: Recipe,
  by: Kind = r.by,
  made = makes(by, grade, r),
): { item: Item; perMinute: number }[] {
  return r.from.map((item, p) => ({ item, perMinute: made * (r.need[p] ?? 0) }));
}

/**
 * What makes a thing, and by which recipe (`recipeFor`): a gatherer, by none, for a thing from the
 * ground; else the machine of the recipe that makes it, its own thing or beside it. A recipe makes one
 * of its by-product with each of its own (`Recipe.also`), so the machines a pace of either takes are the same.
 */
export const makerOf = (n: Item): { kind: Kind; recipe: Recipe | null } => {
  const r = recipeFor(n);
  return { kind: r ? r.by : GATHERING, recipe: r };
};

/**
 * For each part a machine of a grade (the recipe's own, unless it says) needs to make a recipe flat
 * out (or `made` of it a minute), how many of the piece before it that is, each at `before`.
 */
export function feeders(
  grade: number,
  r: Recipe,
  before = grade,
  by: Kind = r.by,
  made = makes(by, grade, r),
): { item: Item; kind: Kind; count: number }[] {
  return needs(grade, r, by, made).map(({ item, perMinute }) => {
    const { kind, recipe } = makerOf(item);
    return { item, kind, count: perMinute / makes(kind, before, recipe) };
  });
}

/** One step of a tree: how many of a piece make a thing at a pace, and what feeds them. */
export interface Branch {
  readonly item: Item;
  readonly kind: Kind;
  readonly count: number;
  readonly perMinute: number;
  readonly from: readonly Branch[];
}

/** The whole tree of machines and gatherers that makes `perMinute` of a thing, every piece at `grade`. */
export function tree(n: Item, perMinute: number, grade = 1): Branch {
  const { kind, recipe } = makerOf(n);
  const count = perMinute / makes(kind, grade, recipe);
  const from = !recipe ? [] : recipe.from.map((part, p) => tree(part, perMinute * (recipe.need[p] ?? 0), grade));
  return { item: n, kind, count, perMinute, from };
}

/** Every piece a tree takes below its root, summed by kind and thing, in the order the tree first names each. */
export function bill(b: Branch): { item: Item; kind: Kind; count: number }[] {
  const out: { item: Item; kind: Kind; count: number }[] = [];
  const add = (f: Branch): void => {
    const same = out.find((o) => o.item === f.item && o.kind === f.kind);
    if (same) same.count += f.count;
    else out.push({ item: f.item, kind: f.kind, count: f.count });
    f.from.forEach(add);
  };
  b.from.forEach(add);
  return out;
}

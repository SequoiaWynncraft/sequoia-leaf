/**
 * The planner: what pieces make and need a minute, worked out from the tables alone, for a card to
 * show and for balancing. Every piece is taken as working every tick, with power enough and nothing
 * held up; nothing in the rules reads it.
 */
import { GATHERER, isRaw, type Item, type Kind, PACE, RECIPE, type Recipe, STUDY, WORK } from "./tables.ts";

/** Ticks in a minute. */
export const MINUTE = 600;

/** How many times a minute a piece of a kind and grade finishes: a gatherer's thing, a machine's recipe, a Study's folio. */
export function makes(k: Kind, grade: number, r: Recipe | null): number {
  const work = k === GATHERER ? WORK.gather : k === STUDY ? WORK.study : (r?.work ?? 0);
  return work > 0 ? (MINUTE * (PACE[grade] ?? 0)) / work : 0;
}

/** What a machine of a grade needs of each part a minute to make a recipe flat out. */
export function needs(grade: number, r: Recipe): { item: Item; perMinute: number }[] {
  const often = makes(r.by, grade, r);
  return r.from.map((item, p) => ({ item, perMinute: often * (r.need[p] ?? 0) }));
}

/** What makes a thing: a gatherer for a thing from the ground, else its recipe's machine. */
export const makerOf = (n: Item): { kind: Kind; recipe: Recipe | null } => {
  const r = RECIPE[n] ?? null;
  return { kind: isRaw(n) || !r ? GATHERER : r.by, recipe: r };
};

/** For each part a machine of a grade needs to make a recipe flat out, how many of the piece before it that is, each at `before`. */
export function feeders(grade: number, r: Recipe, before = grade): { item: Item; kind: Kind; count: number }[] {
  return needs(grade, r).map(({ item, perMinute }) => {
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
  const from =
    kind === GATHERER || !recipe
      ? []
      : recipe.from.map((part, p) => tree(part, perMinute * (recipe.need[p] ?? 0), grade));
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

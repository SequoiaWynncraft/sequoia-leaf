/**
 * Which lines a goal needs beyond what stands, sized with the planner. A line is a unit: so many
 * of one piece making one thing, and for each of them the units that feed it. Counts are the
 * planner's, rounded up at every step: a player builds whole machines, and gives each its own
 * feeders. Nothing here touches a yard; it reads the tables through the planner.
 */
import * as F from "../src/index.ts";

/** The grade a player builds a kind at just now. */
export type Grades = (k: F.Kind) => number;

/** So many of one piece making one thing at a pace, each fed by its own `parts`, one unit for each part of its recipe. */
export interface Unit {
  readonly item: F.Item;
  readonly kind: F.Kind;
  readonly grade: number;
  readonly count: number;
  /** The pace it was sized for, a minute: less than it can make, as a whole machine makes more than a share. */
  readonly perMinute: number;
  readonly parts: readonly Unit[];
}

/** What a standing line delivers: a thing, a minute, as the planner says it makes it. */
export interface Delivers {
  readonly item: F.Item;
  readonly rate: number;
}

/** What one piece of a kind makes a minute at a grade, for a thing. */
export const one = (u: Pick<Unit, "item" | "kind" | "grade">): number =>
  F.makes(u.kind, u.grade, u.kind === F.GATHERER ? null : (F.RECIPE[u.item] ?? null));

/** The fewest of a piece that make a pace, never none: a rate of 0.1 is still one machine. */
const enough = (perMinute: number, each: number): number => Math.max(1, Math.ceil(perMinute / each - 1e-9));

/** The line that makes a thing at a pace: the planner's count of its maker rounded up, and each one's feeders sized for its share. */
export function size(item: F.Item, perMinute: number, grades: Grades): Unit {
  const { kind, recipe } = F.makerOf(item);
  const grade = grades(kind);
  const count = enough(perMinute, F.makes(kind, grade, recipe));
  const share = perMinute / count;
  const parts =
    kind === F.GATHERER || !recipe ? [] : recipe.from.map((p, k) => size(p, share * (recipe.need[k] ?? 1), grades));
  return { item, kind, grade, count, perMinute, parts };
}

/** What a unit makes a minute, flat out: each piece at its own pace or at what its feeders bring, whichever is less. */
export function capacity(u: Unit): number {
  const each = one(u);
  const recipe = F.RECIPE[u.item];
  if (u.kind === F.GATHERER || !recipe) return u.count * each;
  const fed = Math.min(...u.parts.map((p, k) => capacity(p) / (recipe.need[k] ?? 1)));
  return u.count * Math.min(each, fed);
}

/** The power a unit draws, every piece in it. */
export function drawOf(u: Unit): number {
  const own = ((F.DRAW[u.kind] ?? 0) * (F.DRAWN[u.grade] ?? F.HALF)) / F.HALF;
  return u.count * (own + u.parts.reduce((sum, p) => sum + drawOf(p), 0));
}

/** Every piece a unit stands, by kind. */
export function piecesOf(u: Unit, into: Map<F.Kind, number> = new Map()): Map<F.Kind, number> {
  const each = new Map<F.Kind, number>([[u.kind, 1]]);
  for (const p of u.parts) piecesOf(p, each);
  for (const [k, n] of each) into.set(k, (into.get(k) ?? 0) + n * u.count);
  return into;
}

/** How many gatherers of each thing from the ground a unit stands. */
export function gatherersOf(u: Unit, into: Map<F.Item, number> = new Map()): Map<F.Item, number> {
  if (u.kind === F.GATHERER) into.set(u.item, (into.get(u.item) ?? 0) + u.count);
  else for (let c = 0; c < u.count; c++) for (const p of u.parts) gatherersOf(p, into);
  return into;
}

/**
 * The lines a goal needs beyond what stands: for each thing it still wants, the pace that would
 * fill it in `minutes`, less what standing lines already bring the depot; a unit for each shortfall.
 */
export function shortfall(
  want: F.Counts,
  got: F.Counts | null,
  minutes: number,
  standing: readonly Delivers[],
  grades: Grades,
): Unit[] {
  const out: Unit[] = [];
  for (const k of F.ALL_ITEMS) {
    const left = (want[k] ?? 0) - (got?.[k] ?? 0);
    if (left <= 0) continue;
    const pace = left / minutes;
    const have = standing.reduce((sum, d) => sum + (d.item === k ? d.rate : 0), 0);
    if (have < pace) out.push(size(k, pace - have, grades));
  }
  return out;
}

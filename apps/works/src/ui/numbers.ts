/**
 * What a piece's card says in numbers, from the rules' planner: what it makes a minute, what it
 * needs of each part a minute and how many of the piece before it that is, what a gatherer gathers,
 * a Study studies and a belt carries. Sentences, each with its numbers as numbers.
 *
 * A card says these only from the moment the yard may make a recipe that takes more than 1 of a
 * part (`saysNumbers`): until then every recipe is one of each, and no card changes. They are part
 * of what a card prints (`prints.ts`), worked out from the yard it is handed.
 */
import {
  aim,
  BELT,
  carried,
  feeders,
  GATHERER,
  highest,
  isItem,
  isMaker,
  ITEM_INFO,
  type Kind,
  KIND_INFO,
  litOf,
  locked,
  makes,
  needs,
  NONE,
  numeral,
  power,
  RECIPES_N,
  STUDY,
  TUNNEL,
  type Yard,
} from "@sequoia-leaf/factory";

import { plural } from "./parts.ts";

let known: { open: Yard["open"]; yes: boolean } | null = null;
/** Whether the yard may make a recipe that takes more than 1 of a part: from then on its cards say numbers. */
export function saysNumbers(w: Yard): boolean {
  if (known?.open !== w.open)
    known = {
      open: w.open,
      yes: RECIPES_N.some((r) => r.need.some((n) => n > 1) && locked(w.open, { make: r.out }) === null),
    };
  return known.yes;
}

/** A number as a card says it: whole, or to one place. */
const n = (v: number): string => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
/** So many of a thing: "1 plank", "60 planks". */
const things = (v: number, k: number): string =>
  `${n(v)} ${v === 1 ? (ITEM_INFO[k]?.name ?? "").toLowerCase() : (ITEM_INFO[k]?.many ?? "")}`;
/** So many of a kind of piece: "1 mill", "1.2 mills". */
const pieces = (v: number, k: Kind): string => {
  const name = (KIND_INFO[k]?.name ?? "").toLowerCase();
  return `${n(v)} ${n(v) === "1" ? name : plural(name)}`;
};

/** What a kind of piece does a minute at a grade, where that needs no recipe: a belt or a tunnel carries. */
export function kindNumbers(k: Kind, grade: number): string[] {
  if (k === BELT || k === TUNNEL) return [`Carries up to ${n(carried(grade))} items a minute.`];
  return [];
}

/**
 * What the piece standing on a tile makes and needs a minute. Short of power, a lit piece says what
 * it makes now, and that power is short; what it needs is of the same moment. How many of the piece
 * before it each part takes is counted at the first grade, and once the yard may build that kind
 * higher, at the highest it may as well.
 */
export function numbersOf(w: Yard, i: number): string[] {
  const k = w.kind[i] ?? NONE;
  const grade = w.grade[i] ?? 0;
  const share = litOf(w)[i] === 1 ? power(w).pace : 1;
  const short = share < 1 ? ": power is short" : "";
  if (k === GATHERER) {
    const raw = w.land.deposit[i] ?? NONE;
    return isItem(raw) ? [`Gathers ${things(makes(GATHERER, grade, null) * share, raw)} a minute${short}.`] : [];
  }
  if (k === STUDY) return [`Studies ${n(makes(STUDY, grade, null) * share)} folios a minute${short}.`];
  if (k === BELT || k === TUNNEL) return kindNumbers(k === BELT ? BELT : TUNNEL, grade);
  const recipe = isMaker(k) ? aim(w, i) : null;
  if (!recipe) return [];
  const out = [`Makes ${things(makes(recipe.by, grade, recipe) * share, recipe.out)} a minute${short}.`];
  const first = feeders(grade, recipe, 1);
  needs(grade, recipe).forEach(({ item, perMinute }, part) => {
    const by = first[part];
    if (!by) return;
    const top = highest(w.open, by.kind);
    const higher = top > 1 ? `, or ${n(feeders(grade, recipe, top)[part]?.count ?? 0)} at ${numeral(top)}` : "";
    out.push(`Needs ${things(perMinute * share, item)} a minute: ${pieces(by.count, by.kind)}${higher}.`);
  });
  return out;
}

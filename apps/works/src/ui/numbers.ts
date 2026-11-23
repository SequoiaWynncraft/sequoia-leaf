/**
 * What a piece's card says in numbers, from the rules' planner: for a machine, its recipe with what it
 * makes and needs of each part a minute and how many of the piece before it that is (`flowOf`); and
 * in sentences, what a gatherer gathers, a Study studies and a belt carries.
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
  held,
  highest,
  holderOf,
  isItem,
  type Item,
  ITEM_INFO,
  type Kind,
  litOf,
  locked,
  makes,
  needs,
  NONE,
  power,
  RECIPES_N,
  status,
  STUDY,
  TUNNEL,
  type Yard,
} from "@sequoia-leaf/factory";

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

/** What a kind of piece does a minute at a grade, where that needs no recipe: a belt or a tunnel carries. */
export function kindNumbers(k: Kind, grade: number): string[] {
  if (k === BELT || k === TUNNEL) return [`Carries up to ${n(carried(grade))} items a minute.`];
  return [];
}

/**
 * What the piece standing on a tile does a minute, in a sentence, where that is not a recipe: what a
 * gatherer gathers, a Study studies, a belt carries. A machine's recipe is drawn instead (`flowOf`).
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
  return [];
}

/** The machines that make so many of a part a minute: of the first grade, and of the highest the yard may build. */
export interface Feeders {
  readonly kind: Kind;
  readonly count: number;
  readonly top: { readonly grade: number; readonly count: number } | null;
}

/** One part of a machine's recipe: how many one takes and how many it holds; and once the yard counts, how many a minute and what makes them. */
export interface FlowPart {
  readonly item: Item;
  readonly need: number;
  readonly have: number;
  readonly perMinute: number | null;
  readonly by: Feeders | null;
}

/**
 * A machine's recipe as its card draws it: each part going in, the thing coming out and how many a
 * minute. Short of power, a lit machine makes what it makes now (`slow`), and its parts are of the
 * same moment. While it waits for its parts (`waiting`), those it holds too few of are short. Until
 * the yard counts (`counts`), its parts have no numbers a minute, as every recipe is one of each.
 */
export interface Flow {
  readonly out: Item;
  readonly perMinute: number;
  readonly slow: boolean;
  readonly waiting: boolean;
  readonly parts: readonly FlowPart[];
}

/** The recipe of the machine standing on a tile, or null for a piece with none in mind. */
export function flowOf(w: Yard, i: number, counts: boolean): Flow | null {
  const recipe = aim(w, i);
  if (!recipe) return null;
  const grade = w.grade[i] ?? 0;
  const share = litOf(w)[i] === 1 ? power(w).pace : 1;
  const h = w.holders;
  const r = holderOf(w, i);
  const state = status(w, i)?.state;
  const first = feeders(grade, recipe, 1);
  const rates = needs(grade, recipe);
  return {
    out: recipe.out,
    perMinute: makes(recipe.by, grade, recipe) * share,
    slow: share < 1,
    waiting: state === "waiting" || state === "starved",
    parts: recipe.from.map((item, part) => {
      const by = first[part];
      const top = by ? highest(w.open, by.kind) : 1;
      return {
        item,
        need: recipe.need[part] ?? 1,
        have: r < 0 ? 0 : held(h, r, item),
        perMinute: counts ? (rates[part]?.perMinute ?? 0) * share : null,
        by:
          counts && by
            ? {
                kind: by.kind,
                count: by.count,
                top: top > 1 ? { grade: top, count: feeders(grade, recipe, top)[part]?.count ?? 0 } : null,
              }
            : null,
      };
    }),
  };
}

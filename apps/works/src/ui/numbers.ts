/**
 * What a piece's card says in numbers, from the rules' planner: for a machine, its recipe with what it
 * makes and needs of each part a minute and how many of the piece before it that is (`flowOf`); and
 * in sentences, what a gatherer gathers and a Study studies while power is short (the rest is a piece's pace).
 *
 * A card says these only from the moment the yard may make a recipe that takes more than 1 of a
 * part (`saysNumbers`): until then every recipe is one of each, and no card changes. They are part
 * of what a card prints (`prints.ts`), worked out from the yard it is handed.
 */
import {
  aim,
  DOES,
  feeders,
  GATHERING,
  held,
  highest,
  holderOf,
  isItem,
  isKind,
  type Item,
  ITEM_INFO,
  type Kind,
  lastRecipe,
  locked,
  machineRate,
  needs,
  NONE,
  RECIPES_N,
  status,
  type Yard,
} from "@sequoia-leaf/factory";
import { num, perMinute } from "@sequoia-leaf/kit/say.ts";

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

/** What so many of a thing are called: "plank" for 1, "planks" for 60. */
const called = (v: number, k: number): string =>
  num(v) === "1" ? (ITEM_INFO[k]?.name ?? "").toLowerCase() : (ITEM_INFO[k]?.many ?? "");

/**
 * What the piece standing on a tile does a minute, in a sentence, where its card's pace (`paceOf` in
 * `cards.ts`, flat out) does not say it already: what a gatherer gathers or a Study studies while
 * power reaches it and is short (where it does not reach, the piece's line says so). A machine's
 * recipe is drawn instead (`flowOf`).
 */
export function numbersOf(w: Yard, i: number): string[] {
  const k = w.kind[i] ?? NONE;
  const { share, effective } = machineRate(w, i);
  if (share >= 1 || share <= 0) return [];
  // What it does a minute, as its kind says it (`KindDef.does`): what a gatherer gathers is its deposit's thing.
  const does = DOES[k];
  if (!does) return [];
  if (k !== GATHERING) return [`${does[0]} ${perMinute(effective, does[1])}: power is short.`];
  const raw = w.land.deposit[i] ?? NONE;
  return isItem(raw) ? [`${does[0]} ${perMinute(effective, called(effective, raw))}: power is short.`] : [];
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
 * minute, as the rules' `machineRate` says it now. Short of power (`slow`), it makes what it makes
 * now, and its parts are of the same moment; where power does not reach it (`dark`), that is nothing.
 * While it waits for its parts (`waiting`), those it holds too few of are short. Until the yard
 * counts (`counts`), its parts have no numbers a minute, as every recipe is one of each. Where the belt
 * it hands to carries less than it would make, `most` is what that belt carries (`machineRate`), and
 * what it makes, its parts and the machines before them are all of that; else null.
 */
export interface Flow {
  readonly out: Item;
  readonly perMinute: number;
  readonly most: number | null;
  readonly slow: boolean;
  readonly dark: boolean;
  readonly waiting: boolean;
  readonly parts: readonly FlowPart[];
}

/** The recipe of the machine standing on a tile, or null for a piece with none in mind. */
export function flowOf(w: Yard, i: number, counts: boolean): Flow | null {
  // Between batches it holds nothing to aim at: it is counted for what it last began, as the yard's
  // Items are (`flow`), so its card says the same between batches as during them.
  const recipe = aim(w, i) ?? lastRecipe(w, i);
  if (!recipe) return null;
  const grade = w.grade[i] ?? 0;
  const here = w.kind[i] ?? recipe.by;
  const maker = isKind(here) ? here : recipe.by;
  const { nominal, share, effective, most } = machineRate(w, i, recipe);
  const h = w.holders;
  const r = holderOf(w, i);
  const state = status(w, i)?.state;
  // What it makes now, the power's share first and then the belt it hands to (`machineRate`): its parts
  // a minute are of that, and the machines before them are counted for it at the same share of power,
  // as what they make flat out over the share (where no power reaches it, flat out, to its belt).
  const made = share > 0 ? effective / share : Math.min(nominal, most ?? Infinity);
  const first = feeders(grade, recipe, 1, maker, made);
  const rates = needs(grade, recipe, maker, effective);
  return {
    out: recipe.out,
    perMinute: effective,
    most,
    slow: share < 1,
    dark: state === "unpowered",
    waiting: state === "waiting" || state === "starved",
    parts: recipe.from.map((item, part) => {
      const by = first[part];
      const top = by ? highest(w.open, by.kind) : 1;
      return {
        item,
        need: recipe.need[part] ?? 1,
        have: r < 0 ? 0 : held(h, r, item),
        perMinute: counts ? (rates[part]?.perMinute ?? 0) : null,
        by:
          counts && by
            ? {
                kind: by.kind,
                count: by.count,
                top: top > 1 ? { grade: top, count: feeders(grade, recipe, top, maker, made)[part]?.count ?? 0 } : null,
              }
            : null,
      };
    }),
  };
}

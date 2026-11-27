/**
 * A release is a patch: the figures, traits, items and boons it brings (`add`), and the changes it
 * makes to those that came before (`change`, field by field). Words and numbers only. The
 * catalogue of an era is the base and every patch open by then, folded in order (`catalog.ts`), so
 * a number that changes on a date is a `change` in that date's patch and nothing else. Who a figure
 * is for is not a patch's: a banner's headliner is one of everyone's while its banner is open.
 */
import type { BoonId, BoonSpec } from "./boons.ts";
import type { Rarity } from "./catalog.ts";
import type { FigureId, FigureSpec } from "./figures.ts";
import type { ItemId, ItemSpec } from "./items.ts";
import type { ReleaseId } from "./releases.ts";
import type { TraitId, TraitSpec } from "./traits.ts";

/** What a release brings of one kind of thing, and what it changes of those already out. */
export interface Part<K extends string, V> {
  readonly add?: Readonly<Partial<Record<K, V>>>;
  /** Fields that replace what an earlier release had; an array or a sentence list is replaced whole. */
  readonly change?: Readonly<Partial<Record<K, Partial<V>>>>;
}

/** A figure as a release brings it: its words and numbers, and what the pulls give it as. */
export interface Arrival extends FigureSpec {
  readonly prize: Rarity;
  /**
   * The chairs it takes on a board: 1, or 0 for one that takes none of the party's places (a
   * Stowaway). Only the first copy of it on a board takes none (`chairsUsed`).
   */
  readonly chairs?: 0 | 1;
}

export interface Patch {
  readonly release: ReleaseId;
  readonly figures?: Part<FigureId, Arrival>;
  readonly traits?: Part<TraitId, TraitSpec>;
  /** Items of every sort: components, finished items, emblems. */
  readonly items?: Part<ItemId, ItemSpec>;
  readonly boons?: Part<BoonId, BoonSpec>;
}

/** A change to a thing made of fields: the fields it names replace the thing's own. */
export const fields = <V extends object>(was: V, change: Partial<V>): V => ({ ...was, ...change });

/**
 * One kind of thing as an era has it: what the era before had, with a patch's part folded in by
 * `merge`, in the order of `ids` (every id of the kind, in its list's order). Bringing what is out
 * already, or changing what is not, is a mistake in the content and stops the catalogue being made.
 */
export function fold<K extends string, V>(
  ids: readonly K[],
  was: Readonly<Partial<Record<K, V>>>,
  part: Part<K, V> | undefined,
  merge: (was: V, change: Partial<V>) => V,
): Partial<Record<K, V>> {
  const out: Partial<Record<K, V>> = {};
  for (const id of ids) {
    const [before, added, change] = [was[id], part?.add?.[id], part?.change?.[id]];
    if (added !== undefined && before !== undefined) throw new Error(`${id} is brought twice`);
    const now = added ?? before;
    if (change !== undefined && now === undefined) throw new Error(`${id} is changed before anything brings it`);
    if (now !== undefined) out[id] = change === undefined ? now : merge(now, change);
  }
  return out;
}

/**
 * What a catalogue has of an id. Nothing can hold a thing before its release opens, so asking for
 * one is a mistake: it says so rather than answer as if it were open.
 */
export function opened<K extends string, V>(table: Readonly<Partial<Record<K, V>>>, id: K, era: number): V {
  const v = table[id];
  if (v === undefined) throw new RangeError(`${id} is not open at era ${era}`);
  return v;
}

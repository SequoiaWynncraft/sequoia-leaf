/**
 * How far normal mode reaches a trait in an era, and what a view shows of its steps: the one place
 * that says so. Every chip, card and almanac page (`traitShown`), every regular's and bot's
 * favourite trait (`favourites`) reads it, from the era's set and emblems as they are: no list is
 * kept by hand. The rules keep every step, and a raid with the member's own figures shows them all.
 */
import type { Catalog, Figure } from "./catalog.ts";
import { stepFor, type TraitId } from "./traits.ts";

/** Whether a figure carries a trait: as its kin, its calling, or a third trait. */
const carries = (f: Figure, trait: TraitId): boolean =>
  f.kin === trait || f.calling === trait || f.extra.includes(trait);

/**
 * Whether the era can make an emblem of a trait more than once: one a recipe makes (the Carving
 * Knife's, from Penguin Month), not only a charm, which a run takes once.
 */
export const madeAgain = (cat: Catalog, trait: TraitId): boolean =>
  cat.ids.emblems.some((e) => cat.items[e]?.grants === trait && cat.items[e]?.made !== undefined);

/**
 * How many of a trait normal mode reaches: the set's figures that carry it, and one more for an
 * emblem the era has of it; all its steps where the era can make that emblem again and again
 * (`madeAgain`). With `emblems` false, the set's figures alone.
 */
export function traitReach(cat: Catalog, trait: TraitId, emblems = true): number {
  const members = cat.order.filter((id) => {
    const f = cat.figures[id];
    return f?.everyones === true && carries(f, trait);
  }).length;
  if (!emblems) return members;
  if (madeAgain(cat, trait)) return Number.POSITIVE_INFINITY;
  return members + (cat.ids.emblems.some((e) => cat.items[e]?.grants === trait) ? 1 : 0);
}
/** Whether the set's figures alone reach a trait's first step. */
export const reachedByFigures = (cat: Catalog, trait: TraitId): boolean =>
  traitReach(cat, trait, false) >= (cat.traits[trait]?.steps[0] ?? Number.POSITIVE_INFINITY);
/**
 * The traits of some that a regular or a bot may be fond of: those the era's set reaches a step of
 * by figures alone, so that none is fond of a trait nobody else in the set carries.
 */
export const favourites = (cat: Catalog, traits: readonly TraitId[]): TraitId[] =>
  traits.filter((t) => reachedByFigures(cat, t));

/** A trait as a view shows it, for a party with `count` of it. */
export interface TraitShown {
  readonly count: number;
  /** The step it is on: 0 while it is off. */
  readonly step: number;
  /** The steps shown, in order. */
  readonly steps: readonly number[];
  /** The next step shown it counts to, or the top one shown once that is on; null with none shown. */
  readonly next: number | null;
}
/**
 * What a view shows of a trait for a party counting `count` of it: with the member's own figures
 * (`own`) every step; in normal mode the steps its reach gets to (`traitReach`), and any further one
 * the party has lit. A trait the set cannot light, even with an emblem, shows no step in normal mode.
 */
export function traitShown(cat: Catalog, trait: TraitId, count: number, own: boolean): TraitShown {
  const all = cat.traits[trait]?.steps ?? [];
  const step = stepFor(cat, trait, count);
  const reach = traitReach(cat, trait);
  const steps = own ? all : all.slice(0, Math.max(step, all.filter((need) => need <= reach).length));
  return { count, step, steps, next: steps.find((need) => need > count) ?? steps.at(-1) ?? null };
}
/** Whether normal mode shows a trait at all, in the almanac: one the set can light, by figures or with an emblem. */
export const shownInNormal = (cat: Catalog, trait: TraitId): boolean =>
  traitShown(cat, trait, 0, false).steps.length > 0;

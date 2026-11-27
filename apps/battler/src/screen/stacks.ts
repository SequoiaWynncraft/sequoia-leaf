/**
 * The rack as the page shows it: one tile per kind, with how many of it there are, read straight from
 * the run's counts (`Run.rack`). The components come first, in the catalogue's order, each always in
 * its own place (one there is none of is an empty tile, so the row never moves); then the finished
 * items, the emblems and the tools there are, each kind once, in the rack's order.
 *
 * A tile is its kind: picking it up picks up one of it, and letting one go on a tile meets one of
 * that kind (two of it, for a tile's own kind).
 */
import { catalogOf, countOn, isComponentId, kindsOn, type RackItem, type RunView } from "@sequoia-leaf/raid";

/** One tile of the rack: a kind, and how many of it lie there. */
export interface Stack {
  readonly item: RackItem;
  readonly count: number;
}

/** The rack's tiles: every component of the catalogue, there or not, then each other kind there is. */
export function stacksOf(run: Pick<RunView, "rack" | "era">): { parts: Stack[]; rest: Stack[] } {
  const tile = (item: RackItem): Stack => ({ item, count: countOn(run.rack, item) });
  return {
    parts: catalogOf(run).ids.components.map(tile),
    rest: kindsOn(run.rack)
      .filter((item) => !isComponentId(item))
      .map(tile),
  };
}

/** Every tile of the rack, components first. */
export function tilesOf(run: Pick<RunView, "rack" | "era">): Stack[] {
  const { parts, rest } = stacksOf(run);
  return [...parts, ...rest];
}

/** How many there are, as the tile says it: nothing for one, else "×14". */
export const countWord = (count: number): string => (count > 1 ? `×${count}` : "");

/**
 * What a run draws from the catalogue of its era (`catalogOf`): the three it may set out with, and
 * each offer the stall makes. Every draw is from the run's own stream.
 */
import { pick, shuffled, type Stream, weighted } from "@sequoia-leaf/core";

import { available, catalogOf } from "./content/catalog.ts";
import { type FigureId, TIERS } from "./content/figures.ts";
import type { Era } from "./content/releases.ts";
import { ECONOMY } from "./content/rooms.ts";
import { type Roster, stallOdds, stallPool } from "./own.ts";

/** What of a run its draws read: its stream, its era, its roster and its level. */
type Drawing = Stream & { readonly era: Era; readonly own: Roster | null; readonly level: number };

/** A run's first pick: three of the one-acorn figures open in its era. */
export const starters = (run: Stream & { readonly era: Era }): FigureId[] =>
  shuffled(run, available(catalogOf(run), { for: "starter" })).slice(0, ECONOMY.starters);

/** One offer of the stall: a cost by the odds at the run's level, then a figure of that cost; none when there is nobody to offer. */
export function drawOffer(run: Drawing): FigureId | null {
  const tier = TIERS[weighted(run, stallOdds(run))];
  const pool = tier === undefined ? [] : stallPool(run, tier);
  return pool.length > 0 ? pick(run, pool) : null;
}

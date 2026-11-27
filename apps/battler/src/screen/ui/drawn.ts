/**
 * What the table's panels are drawn from, as a word for each: a panel is drawn again only when its
 * word changes. Each word has the run's era in it, since what a run's traits, items and figures say
 * and count is that era's (`catalogOf(run)`): a run picked up in a new era is drawn anew even where
 * nothing else changed.
 */
import { shownAs } from "@sequoia-leaf/figures/sprites.ts";
import { type FigureId, pieces, priceOf, type RunView, type TraitState } from "@sequoia-leaf/raid";

import { canBuy } from "../logic.ts";
import { tilesOf } from "../stacks.ts";

/** How many of a figure the party owns at one star: two means the next one makes three. */
export const twins = (run: RunView, kind: FigureId): number =>
  pieces(run).filter((p) => p.kind === kind && p.stars === 1).length;

/** The trait chips: each trait the party has, with its count. */
export const traitsDrawn = (run: RunView, states: readonly TraitState[]): string =>
  `${run.era}|${states.map((t) => `${t.trait}${t.count}`).join()}`;

/** The rack: each tile and how many of it there are, and the boons held. */
export const rackDrawn = (run: RunView): string =>
  `${run.era}|${tilesOf(run)
    .map((t) => `${t.item}${t.count}`)
    .join()}|${run.boons.join()}`;

/** The stall: each offer as it is shown, its price, whether it can be bought, and how many of it the party has. */
export const stallDrawn = (run: RunView): string =>
  `${run.era}|${run.stall
    .map((kind, i) => `${shownAs(kind)}:${priceOf(run, i)}:${canBuy(run, i) ? 1 : 0}:${kind ? twins(run, kind) : 0}`)
    .join(run.way.figures.pool === "own" ? ";" : ",")}`;

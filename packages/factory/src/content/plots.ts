/**
 * The land, plot by plot. Nine plots of sixteen tiles by twelve make a map three plots wide and
 * three tall, with the yard in the middle. Each plot is drawn here as rows of letters, one letter
 * a tile, so the map can be read off the page and drawn from the same data.
 *
 * Every plot is placed from the yard, which is at column 0 and row 0: a ring is the plots as many
 * plots away (the eight round the yard are the first). The map is as large as the plots it has, so
 * more land is more plots here, each with a new id at the end of `PLOT_IDS`; nothing kept moves,
 * since a yard keeps its tiles measured from the yard plot's corner (`codec.ts`).
 *
 * The plots themselves are data, a module for each ring out from the yard (`rings/`): the first is
 * the yard and the eight round it; the second (16) and the third (24, in two modules by its south and
 * west sides and its north and east), put up for sale by tier 4's commission. A ring of plots is added
 * as a module of its own there, its plots put on the end of `PLOTS` and their ids on the end of
 * `PLOT_IDS`.
 *
 *   .  clear ground          d  deadfall        s  stone        o  ore
 *   c  clay                  a  sand            r  resin       v  salvage
 *   t  tar                   q  star crystal
 *   ~  the stream            T  a redwood (nothing is built on one)        D  the depot
 *
 * A letter of a thing the tables do not have yet is clear ground until they do (`land.ts`).
 */
import { FIRST } from "./rings/first.ts";
import { SECOND, SECOND_IDS } from "./rings/second.ts";
import { THIRD_NORTH_EAST, THIRD_NORTH_EAST_IDS } from "./rings/third-north-east.ts";
import { THIRD_SOUTH_WEST, THIRD_SOUTH_WEST_IDS } from "./rings/third-south-west.ts";

/**
 * Coins to fell a redwood that stands on a plot the yard owns, once felling is studied: the first
 * costs `first`, and each after half as much again as the one before, rounded down to a whole
 * `round` (`fellPrice`). Its tiles are then ground like any other.
 */
export const FELLING = { first: 1000, round: 100 } as const;

export const PLOT_W = 16;
export const PLOT_H = 12;

const FIRST_IDS = ["yard", "meadow", "bank", "stream", "grove", "seam", "quarry", "hollow", "pond"] as const;
/** The plots put up for sale by tier 4's commission: the second ring and the third. */
export const OUTER_IDS = [...SECOND_IDS, ...THIRD_SOUTH_WEST_IDS, ...THIRD_NORTH_EAST_IDS] as const;
export const PLOT_IDS = [...FIRST_IDS, ...OUTER_IDS] as const;
export type PlotName = (typeof PLOT_IDS)[number];

/**
 * Land past the first ring is dear, and dearer with each plot of it bought: every plot of ring `from`
 * or further a yard owns makes every such plot it has yet to buy `percent` per cent dearer, in whole
 * thousands of Coins (`plotPrice`, in `build.ts`). Plots nearer keep their own price and count for
 * nothing.
 */
export const RISE = { from: 2, percent: 15 } as const;

export interface PlotInfo<Id extends string = PlotName> {
  readonly id: Id;
  readonly name: string;
  /** Where it sits, in plots from the yard: column (east) and row (south), below 0 west and north. */
  readonly col: number;
  readonly row: number;
  /** Coins to open it: its base price, from which a plot that rises rises (`RISE`). The yard itself is free. */
  readonly price: number;
  /** Why anyone would want it. */
  readonly why: string;
  readonly rows: readonly string[];
}

/** Every plot, ring by ring out from the yard. */
export const PLOTS: readonly PlotInfo[] = [...FIRST, ...SECOND, ...THIRD_SOUTH_WEST, ...THIRD_NORTH_EAST];

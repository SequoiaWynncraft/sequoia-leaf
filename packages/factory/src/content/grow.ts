/**
 * What a piece that grows a thing from itself does (`GROW`, tier 7's grower): a run takes 1 of each of
 * `takes` and gives `gives`, after `ticks` of work at grade 1; every `extraEvery`th run gives 2. So a
 * grower gives 3 star crystals from every 2 it takes, with 2 crystal feed: 2 of every 3 must go back
 * into it, and only the third is the yard's. A new one's first run gives 1.
 */
import type { KindName } from "../kinds/list.ts";
import type { ItemName } from "./items.ts";

export interface GrowInfo {
  readonly by: KindName;
  /** What one run takes, 1 of each: what it grows among them. */
  readonly takes: readonly ItemName[];
  readonly ticks: number;
  readonly gives: ItemName;
  /** Every so many runs, one gives 2. */
  readonly extraEvery: number;
  /** How many of each of `takes` it holds at most. */
  readonly holds: number;
}

export const GROW: GrowInfo = {
  by: "grower",
  takes: ["crystal", "feed"],
  ticks: 60,
  gives: "crystal",
  extraEvery: 2,
  holds: 4,
};

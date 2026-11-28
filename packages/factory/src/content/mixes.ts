/**
 * What a piece that breaks one thing into several makes (`MIXES`): it takes 1 of `from` at a time and
 * gives the next of `gives`, in order, round and round, each after `ticks` of work at grade 1. A thing
 * a mix gives has no recipe of its own unless it already had one (ingots, glass, gears).
 */
import type { KindName } from "../kinds/list.ts";
import type { ItemName } from "./items.ts";

export interface MixInfo {
  readonly by: KindName;
  readonly from: ItemName;
  readonly ticks: number;
  /** How many of `from` it holds at most. */
  readonly holds: number;
  /** What it is doing while it works, as its status begins: "Breaking" (salvage). */
  readonly doing: string;
  /** What a thing it gives says it was made from, on the thing's card: "Broken from" (salvage). */
  readonly madeFrom: string;
  readonly gives: readonly ItemName[];
}

export const MIXES: readonly MixInfo[] = [
  {
    by: "breaker",
    from: "salvage",
    ticks: 6,
    holds: 8,
    doing: "Breaking",
    madeFrom: "Broken from",
    // 8 copper, 5 ingots, 3 glass, 3 slag and 1 gear of every 20.
    gives: [
      "copper",
      "ingot",
      "copper",
      "glass",
      "copper",
      "slag",
      "ingot",
      "copper",
      "glass",
      "copper",
      "ingot",
      "slag",
      "copper",
      "ingot",
      "copper",
      "glass",
      "copper",
      "slag",
      "ingot",
      "gear",
    ],
  },
  {
    by: "still",
    from: "tar",
    ticks: 5,
    holds: 8,
    doing: "Distilling",
    madeFrom: "Distilled from",
    // 3 pitch, 2 creosote and 1 spirit of every 6, each out of its own part of the still's front.
    gives: ["pitch", "creosote", "pitch", "spirit", "pitch", "creosote"],
  },
];

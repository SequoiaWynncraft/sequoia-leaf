/**
 * What the yard makes and needs, as the sheet's third view prints it (`ui/views.ts`): the rules'
 * `flow` for the yard as it stands, kept for a second of the yard's clock; the rows in their order;
 * and a number a minute as it is printed. Nothing here touches the page.
 */

import { ALL_ITEMS, counts, flow, type Item, NONE, type Yard } from "@sequoia-leaf/factory";

import type { Cell } from "./ui/table.ts";

/** What the yard can make and needs of each thing a minute, worked out once for each second of the yard's clock and each change. */
const kept: { yard: Yard | null; rev: number; second: number; made: Float64Array; needed: Float64Array } = {
  yard: null,
  rev: -1,
  second: -1,
  made: counts(),
  needed: counts(),
};
/**
 * The thing each machine was last counted for, by tile, which the rules' `flow` reads and writes: a
 * machine told nothing that holds nothing for a moment is still counted for what it was making.
 */
let aimed = new Uint8Array(0);

/**
 * What the pieces standing in the yard can make of each thing a minute, and need of each (the rules'
 * `flow`), as of this second of the yard's clock and the rules' count of its changes (`y.rev`).
 */
export function yardFlows(y: Yard): { readonly made: Float64Array; readonly needed: Float64Array } {
  const second = Math.floor(y.tick / 10);
  if (kept.yard === y && kept.rev === y.rev && kept.second === second) return kept;
  kept.yard = y;
  kept.rev = y.rev;
  kept.second = second;
  if (aimed.length !== y.kind.length) aimed = new Uint8Array(y.kind.length).fill(NONE);
  kept.made.fill(0);
  kept.needed.fill(0);
  flow(y, kept.made, kept.needed, aimed);
  return kept;
}

/** A thing's row: what the yard can make of it, needs of it, and what reached the depot, a minute. */
export interface Flow {
  readonly item: Item;
  readonly made: number;
  readonly needed: number;
  readonly reached: number;
}

/**
 * The rows: every thing the yard can make, needs, or has had reach the depot in the last minute;
 * those it needs more of than it can make first, the largest shortfall first, and the rest in the
 * order of the tables.
 */
export function flowRows(made: ArrayLike<number>, needed: ArrayLike<number>, came: (item: number) => number): Flow[] {
  const rows = ALL_ITEMS.flatMap((item): Flow[] => {
    const row = { item, made: made[item] ?? 0, needed: needed[item] ?? 0, reached: came(item) };
    return row.made > 0 || row.needed > 0 || row.reached > 0 ? [row] : [];
  });
  const short = (f: Flow): number => Math.max(0, f.needed - f.made);
  return rows.toSorted((a, b) => short(b) - short(a) || a.item - b.item);
}

/** A shortfall worth saying: under a twentieth of a thing a minute is two numbers that print the same. */
export const SHORT = 0.05;

/**
 * A number a minute as it is printed: whole from ten up; under ten to one decimal, unless it is
 * whole; and none at all faint, so that the numbers there are stand out.
 */
export function aMinute(v: number): Cell {
  const tenth = Math.round(v * 10) / 10;
  if (tenth <= 0) return ["0", "faint"];
  if (tenth >= 10 || Number.isInteger(tenth)) return Math.round(tenth).toLocaleString("en-US");
  return tenth.toFixed(1);
}

/** The words of a number as it is printed. */
export const said = (cell: Cell): string => (typeof cell === "string" ? cell : cell[0]);

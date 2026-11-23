/**
 * What reached the depot in the yard's last minute, counted. The depot's books (`y.depot`) are a
 * running total for each thing. The page keeps a small ring of those totals, one row for each second
 * of the yard's own clock, and what arrived in the last minute is the newest row less the row 600
 * ticks before it: a count, not an estimate. It does not begin again when the yard is changed (a
 * change shows as it takes effect), and needs no warm-up.
 *
 * A row is taken by the yard's tick, not by the page's clock, so a copy catching up with Leaf does
 * not bend it; each row keeps the tick it was taken at, and where the two rows are not 600 ticks
 * apart (a row a frame late, or the first minute after the page opens) what came between them is
 * given as a minute's worth, with how many seconds it was counted over (`countedOver`).
 */

import { ITEM_COUNT, type Yard } from "@sequoia-leaf/factory";

/** Ticks between two rows: a second of the yard's clock. */
const EVERY = 10;
/** Ticks counted over: a minute. */
const WINDOW = 600;
/** Rows kept: one for now and one for each second of the minute before. */
const ROWS = WINDOW / EVERY + 1;

/** The tick each row was taken at, and the depot's totals then, `ITEM_COUNT` to a row. */
const ticks = new Float64Array(ROWS);
const totals = new Float64Array(ROWS * ITEM_COUNT);
/** The newest row's place, and how many rows are kept. */
let head = 0;
let kept = 0;

/** Whether the depot's books hold less of anything than the newest row does: they are another yard's. */
function another(y: Yard): boolean {
  for (let k = 0; k < ITEM_COUNT; k++) if ((y.depot[k] ?? 0) < (totals[head * ITEM_COUNT + k] ?? 0)) return true;
  return false;
}

/**
 * Looks at the depot's books: a row is taken when the yard's clock has reached another second since
 * the last. Asked every frame, it costs a comparison but once a second. A yard that is another yard
 * (its clock earlier, its books holding less) or that ran on more than a minute unseen begins the
 * ring again.
 */
export function noteArrivals(y: Yard): void {
  if (kept > 0) {
    const last = ticks[head] ?? 0;
    if (Math.floor(y.tick / EVERY) === Math.floor(last / EVERY)) return;
    if (y.tick < last || y.tick - last > WINDOW || another(y)) kept = 0;
  }
  head = kept === 0 ? 0 : (head + 1) % ROWS;
  kept = Math.min(kept + 1, ROWS);
  ticks[head] = y.tick;
  totals.set(y.depot.subarray(0, ITEM_COUNT), head * ITEM_COUNT);
}

/** The oldest row kept: the one a minute before the newest, once a minute has been seen. */
const oldest = (): number => (head - (kept - 1) + ROWS) % ROWS;

/** Ticks between the oldest row and the newest. */
const span = (): number => (kept > 0 ? (ticks[head] ?? 0) - (ticks[oldest()] ?? 0) : 0);

/**
 * How many of a thing reached the depot in the last minute: counted, where a minute has been seen
 * (rows 600 ticks apart); a minute's worth of what was counted, where the rows are nearer or further.
 */
export function reached(thing: number): number {
  const ticksOver = span();
  if (ticksOver <= 0) return 0;
  const came = (totals[head * ITEM_COUNT + thing] ?? 0) - (totals[oldest() * ITEM_COUNT + thing] ?? 0);
  return ticksOver === WINDOW ? came : (came * WINDOW) / ticksOver;
}

/** How many seconds of the yard's clock the count is over: 60 once a minute has been seen. */
export const countedOver = (): number => Math.min(WINDOW, span()) / EVERY;

/** Forgets every row (for tests). */
export function forgetArrivals(): void {
  head = 0;
  kept = 0;
}

/**
 * The page's own counts, a tick at a time, of what the rules keep nothing of: each grower's last
 * minute (`grown.ts`) and each launch pad's (`pads.ts`). The copy is run on a tick at a time only
 * while some count wants it (`counting`); each is begun before a tick, noted after it, read again
 * after a command, and carried over to Leaf's yard read afresh, in the same order.
 */
import type { Yard } from "@sequoia-leaf/factory";

import * as grown from "./grown.ts";
import * as pads from "./pads.ts";

/** Whether the page counts a tick at a time for a yard: while it has a grower or a pad. */
export const counting = (y: Yard): boolean => grown.counting(y) || pads.counting(y);

/** Begins each count that has none, as the yard stands now, before the next tick. */
export function beginCounts(y: Yard): void {
  grown.beginCounts(y);
  pads.beginCounts(y);
}

/** Notes what the tick the yard has just run did. */
export function noteTick(y: Yard): void {
  if (grown.counting(y)) grown.noteGrowers(y);
  if (pads.counting(y)) pads.notePads(y);
}

/** A command was played on the copy: each count reads what it counts again as it now stands. */
export function commanded(y: Yard): void {
  grown.commanded(y);
  pads.commanded(y);
}

/** Leaf's yard read afresh (`into`) in place of the page's copy (`from`): each count keeps what stands in both. */
export function keepCounts(from: Yard, into: Yard): void {
  grown.keepCounts(from, into);
  pads.keepCounts(from, into);
}

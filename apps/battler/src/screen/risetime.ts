/**
 * When a Groot figure's true form rises, with nothing of the page in it, so that it can be tested.
 *
 * The rules say it at the fall: `fall.back` is the steps until it gets back up. Everything is
 * counted on the fight's clock from that step, as `hung.ts` times gaz's cast, so it plays the same
 * at 1x and 4x, and five beats fit in the second the rules give it:
 *
 * 1. Wind-up: the fallen figure lies there.
 * 2. The catch: the table dims to its hex.
 * 3. Dread: its raid's ring draws round it one gold stud at a time; friends lean away.
 * 4. Release (the step it gets back up): it stands in its new shape, the ring snaps shut, a bump.
 * 5. Aftermath: the ring stays, faint, under it until it falls again.
 *
 * It stands only when the rules stand it up (their `rise`). A fight that ends before then, or a step
 * that passes without it (nowhere free to stand), leaves it down, and its ring goes out.
 */

/** A true form on its way back up: the step it fell, and the step it gets back up. */
export interface Rising {
  readonly fell: number;
  readonly up: number;
}

export const risingAt = (fell: number, back: number): Rising => ({ fell, up: fell + Math.max(1, back) });

/** Where in its second each beat begins, as a share of it: it lies, then the table dims, then the ring draws. */
const DIMS = 0.4;
const DRAWS = 0.5;
/** Studs on a ring: one at the top, then each quarter round. */
export const STUDS = 4;

export type Beat = "lies" | "dims" | "draws" | "stands";

/** The beat at the fight's clock `c`, up to the step it stands; from then it stands (and its ring stays). */
export function beatOf(r: Rising, c: number): Beat {
  if (c >= r.up) return "stands";
  const k = (c - r.fell) / (r.up - r.fell);
  return k < DIMS ? "lies" : k < DRAWS ? "dims" : "draws";
}

/** How dark the table is round its hex at `c`, from 0 to 1: falling in through the catch, held through the dread, gone in one frame as it stands. */
export function dimAt(r: Rising, c: number): number {
  if (c >= r.up) return 0;
  const k = (c - r.fell) / (r.up - r.fell);
  return k < DIMS ? 0 : Math.min(1, (k - DIMS) / (DRAWS - DIMS));
}

/** How many of the ring's four quarters are drawn at `c`: none before the dread, one more each stud, all four once it stands. */
export function quartersAt(r: Rising, c: number): number {
  if (c >= r.up) return STUDS;
  const k = (c - r.fell) / (r.up - r.fell);
  if (k < DRAWS) return 0;
  return Math.min(STUDS - 1, Math.floor(((k - DRAWS) / (1 - DRAWS)) * STUDS));
}

/**
 * What becomes of it: still waiting; it stands (the rules got it up); or it stays down (the fight
 * ended before its step, or its step was played without it getting up: nowhere was free).
 */
export function fateOf(
  r: Rising,
  fight: { readonly over: boolean; readonly tick: number },
  risen: boolean,
): "waits" | "stands" | "stays down" {
  if (risen) return "stands";
  if (fight.over || fight.tick >= r.up) return "stays down";
  return "waits";
}

/** Steps a ring takes to go out once its figure stays down. */
export const GOES_OUT = 10;

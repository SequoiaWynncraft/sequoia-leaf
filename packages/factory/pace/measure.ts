/**
 * What the standing lines really bring the depot, a minute, of each thing: a copy of the yard run on
 * by the rules, as a player reads the pace off the page once a new line has filled. Whatever holds a
 * line back (a split above another taking more than its share, a belt joined past what it carries,
 * power short, a machine waiting on its slowest part) is in it, because nothing is worked out: it is
 * what arrives.
 */
import * as F from "../src/index.ts";

/** Minutes a new line is given to fill before it is read, and the minutes it is read over. */
export const FILL = 3;
export const READ = 5;

/** Each thing a minute that reaches the depot of a copy of the yard, read over `over` minutes once `fill` have gone by. */
export function measure(real: F.Yard, fill = FILL, over = READ): Float64Array {
  const y = structuredClone(real);
  y.wire = null;
  for (let k = 0; k < fill * F.MINUTE; k++) F.step(y);
  const before = Float64Array.from(y.depot);
  for (let k = 0; k < over * F.MINUTE; k++) F.step(y);
  return Float64Array.from(y.depot, (n, k) => (n - (before[k] ?? 0)) / over);
}

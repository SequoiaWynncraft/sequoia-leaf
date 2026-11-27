/**
 * When an ability that lands later lands, with nothing of the page in it, so that it can be tested.
 *
 * Everything is counted from the step the rules say it went off, never from the clock of the frame
 * that showed it: a frame at 4x is more than one step long, so the clock is already past that step
 * when it is shown, and counting from the clock would land the look after the damage. And whoever
 * it is for falling early takes only what was theirs: the rules still land it where they stood, on
 * everyone beside that hex.
 */

/** An ability hung over the table: the step it went off, and the step it lands. */
export interface Hung {
  readonly at: number;
  readonly lands: number;
}

/** Hangs an ability that went off at step `at` and lands `ticks` steps on. */
export const hangs = (at: number, ticks: number): Hung => ({ at, lands: at + ticks });

/** What becomes of it at the fight's clock `c`: it still hangs, it lands, or (the fight ended before its step) it never will. */
export function fateOf(
  h: Hung,
  c: number,
  fight: { readonly over: boolean; readonly tick: number },
): "hangs" | "lands" | "never" {
  if (fight.over && fight.tick < h.lands) return "never";
  return c >= h.lands ? "lands" : "hangs";
}

/**
 * Whether whoever it is for is still under it at the clock `c`, having fallen at step `fellAt`
 * (`Infinity` standing): one who falls as it lands was struck by it, and only one who fell before
 * that is out from under it.
 */
export const stillCaught = (h: Hung, fellAt: number, c: number): boolean => fellAt >= h.lands || fellAt > c;

/** Steps between one of Yule's bubbles closing and the next, when one bath shuts several friends in (0.15 seconds). */
export const APART = 3;
/**
 * How the `i`th friend of a bath hung at `h` is drawn at the fight's clock `c`: as itself until its
 * own bubble closes, though the rules have hidden it since the bath began; in its bubble until the
 * bath lands; and as itself again from then.
 */
export function bathOf(h: Hung, i: number, c: number): "itself" | "bubble" {
  return c >= h.at + i * APART && c < h.lands ? "bubble" : "itself";
}

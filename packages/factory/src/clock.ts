/**
 * The yard's time, and its owner's. The yard moves in ticks, ten to a second of Leaf's clock, for up
 * to eight hours after its owner's last command; then it stands still until they come back. What it
 * did meanwhile is counted, not guessed: the difference from the moment it was last seen (`seen`).
 */
import { ALL_ITEMS } from "./tables.ts";
import { type Away, counts, type Seen, type Yard } from "./yard.ts";

/** One tick of the yard in Leaf's time. */
export const TICK_MS = 100;
/** The shortest time away the yard tells its owner about, and the longest it works unwatched. */
export const AWAY_LEAST_MS = 5 * 60 * 1000;
export const AWAY_MOST_MS = 8 * 3600 * 1000;

/** The yard as its owner leaves it: now, what its till holds, and what its depot has taken in. */
export const here = (y: Yard): Seen => ({ tick: y.tick, till: y.till, depot: Float64Array.from(y.depot) });

/** The tick the yard stands still at: eight hours after its owner was last there. */
export const stillAt = (y: Yard): number => y.seen.tick + AWAY_MOST_MS / TICK_MS;

/** What the yard did since its owner was last there, if that was five minutes ago or more. */
export function awayOf(y: Yard): Away | null {
  const ticks = y.tick - y.seen.tick;
  if (ticks * TICK_MS < AWAY_LEAST_MS) return null;
  const made = counts();
  for (const n of ALL_ITEMS) {
    const got = Math.floor((y.depot[n] ?? 0) - (y.seen.depot[n] ?? 0));
    if (got > 0) made[n] = got;
  }
  return { seconds: (ticks * TICK_MS) / 1000, coins: Math.floor(y.till) - Math.floor(y.seen.till), made };
}

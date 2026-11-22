/**
 * The yard's time, and its owner's. The yard moves in ticks, ten to a second of Leaf's clock. Leaf
 * runs every yard tick for tick, whether or not anyone is looking, for up to eight hours after its
 * owner was last there; then it stands still until they come back.
 *
 * What the yard did meanwhile is counted, not guessed: at each of its owner's commands the yard
 * remembers the moment (`seen`), what its till held and what its depot had taken in, and what it
 * did since is the difference (`awayOf`). Only a command takes from the till, so while nobody acts
 * both only grow.
 */
import { ITEMS, type Tally } from "./content/items.ts";
import type { Away, Seen, World } from "./world.ts";

/** One tick of the yard in Leaf's time. */
export const TICK_MS = 100;
/** The shortest time away the yard tells its owner about, and the longest it works unwatched. */
export const AWAY_LEAST_MS = 5 * 60 * 1000;
export const AWAY_MOST_MS = 8 * 3600 * 1000;

/** The yard as its owner leaves it: now, what its till holds, and what its depot has taken in. */
export const here = (w: World): Seen => ({ tick: w.tick, till: w.till, depot: { ...w.depot } });

/** The tick the yard stands still at: eight hours after its owner was last there. */
export const stillAt = (w: World): number => w.seen.tick + AWAY_MOST_MS / TICK_MS;

/**
 * What the yard did since its owner was last there, if that was five minutes ago or more: how long
 * it worked, the whole Coins its till gained (what collecting pays now, past what it would have
 * paid then), and what its depot took in.
 */
export function awayOf(w: World): Away | null {
  const ticks = w.tick - w.seen.tick;
  if (ticks * TICK_MS < AWAY_LEAST_MS) return null;
  const made: Tally = {};
  for (const item of ITEMS) {
    const n = Math.floor((w.depot[item] ?? 0) - (w.seen.depot[item] ?? 0));
    if (n > 0) made[item] = n;
  }
  return { seconds: (ticks * TICK_MS) / 1000, coins: Math.floor(w.till) - Math.floor(w.seen.till), made };
}

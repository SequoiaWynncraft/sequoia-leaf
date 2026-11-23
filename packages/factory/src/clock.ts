/**
 * The yard's time, and its owner's. The yard moves in ticks, ten to a second of Leaf's clock, for as
 * long after its owner's last command as it has unlocked (8 hours at first); then it stands still
 * until they come back. What it did meanwhile is counted, not guessed: the difference from the moment
 * it was last seen (`seen`).
 */
import { ALL_ITEMS, type Goal, isNode, MILLI } from "./tables.ts";
import { type Away, counts, type Seen, type Yard } from "./yard.ts";

/** One tick of the yard in Leaf's time. */
export const TICK_MS = 100;
/** The shortest time away the yard tells its owner about. */
export const AWAY_LEAST_MS = 5 * 60 * 1000;

/** The yard as its owner leaves it: now, what its till holds, and what its depot has taken in. */
export const here = (y: Yard): Seen => ({ tick: y.tick, till: y.till, depot: Float64Array.from(y.depot) });

/** The tick the yard stands still at: as long after its owner was last there as it runs unwatched. */
export const stillAt = (y: Yard): number => y.seen.tick + y.open.away;

/** What the yard did since its owner was last there, if that was five minutes ago or more. */
export function awayOf(y: Yard): Away | null {
  const ticks = y.tick - y.seen.tick;
  if (ticks * TICK_MS < AWAY_LEAST_MS) return null;
  const made = counts();
  for (const n of ALL_ITEMS) {
    const got = Math.floor((y.depot[n] ?? 0) - (y.seen.depot[n] ?? 0));
    if (got > 0) made[n] = got;
  }
  const coins = Math.floor(y.till / MILLI) - Math.floor(y.seen.till / MILLI);
  return { seconds: Math.floor((ticks * TICK_MS) / 1000), coins, made };
}

/**
 * The research that became known since the yard's owner was last there, in the order it did: of the
 * goals done since the yard last logged one (`told`). Leaf logs with every command done, which is
 * also when it notes where the owner last saw the yard (`seen`), so the two are of one moment.
 */
export const knownSince = (y: Yard): Goal[] => y.done.slice(y.told).filter((g) => !isNode(g));

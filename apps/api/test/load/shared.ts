/** Who the load test's players are, as both of its processes know them, and how it sums up times. */
import { type PlayerId, playerId } from "@sequoia-leaf/core";

/** How many walkers and lookers the stand-in backend has sessions for. */
export const WALKERS = 1000;
export const LOOKERS = 200;

const id = (prefix: string, i: number): PlayerId => playerId(`${prefix}-0000-4000-8000-${String(i).padStart(12, "0")}`);
/** A walker, session `w<n>`: they walk about the town. Every fourth is not in the guild. */
export const walkerId = (i: number) => id("10000000", i);
/** A yard's owner, session `o<n>`: their page sends commands to it. */
export const ownerId = (i: number) => id("20000000", i);
/** A looker, session `v<n>`: they only visit. */
export const lookerId = (i: number) => id("30000000", i);
/** The owner of a cold yard, left eight hours ago, with no session. */
export const coldId = (i: number) => id("40000000", i);

/** The median, 95th and 99th percentiles and the most of some milliseconds, and how many. */
export function spread(values: readonly number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const at = (p: number) =>
    Number((sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN).toFixed(2));
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.length === 0 ? NaN : at(1) };
}

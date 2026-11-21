/**
 * Small happenings on the table that more than one part of the screen cares about: an acorn
 * landing in the purse, a star popping, a trait switching on. Whoever makes one happen says so
 * here, and whoever wants to answer listens, so the parts need not know each other.
 */
export type Signal =
  /** An acorn has landed in the purse. */
  | "acorn"
  /** Three became one; the number is the stars it now has. */
  | "merged"
  /** The fight on the table has finished playing. */
  | "fought"
  /** The takings have been counted out. */
  | "counted";

const heard = new Map<Signal, ((n: number) => void)[]>();

export function onSignal(name: Signal, fn: (n: number) => void): void {
  const list = heard.get(name) ?? [];
  list.push(fn);
  heard.set(name, list);
}
export function signal(name: Signal, n = 0): void {
  for (const fn of heard.get(name) ?? []) fn(n);
}

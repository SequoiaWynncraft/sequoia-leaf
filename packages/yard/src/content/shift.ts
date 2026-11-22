/**
 * The second shift: the one thing Leaf buys in the yard. For as long as it runs the yard works at
 * double pace; it opens nothing that cannot be had without it.
 */
export const SHIFT = {
  /** What it costs, in Leaf. */
  leaf: 100,
  /** How long it runs, in minutes on the clock, whether or not the member stays to watch. */
  minutes: 60,
} as const;

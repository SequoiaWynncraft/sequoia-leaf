/**
 * What lasts between runs, as a table: what a run pays in Coins. Nothing here is daily, timed or
 * ranked, and nothing a member has done elsewhere changes a fight: every figure is at the stall for
 * everyone from the first run.
 */

/** Coins for a run, before the trail's share: for every room won, for every boss beaten, and for winning. */
export const PAYOUT = {
  room: 16,
  boss: 50,
  win: 120,
} as const;

import type { Activity } from "./activity.ts";
import { type EarningRules, leafForActivity, levelForXp, type LevelRules } from "./rules.ts";

/** What correcting one raid payment does, given the player's share as the corrected credit feed reports it. */
export type RaidPaymentCorrection =
  /** It paid the share or less, and stands. */
  | { readonly action: "keep" }
  /** It paid more than the share: it is reversed in full, and the share, when it pays anything, is paid instead. */
  | { readonly action: "replace"; readonly shareLeaf: number };

/**
 * Decides one raid payment. Until 2026-11-19 the credit feed gave every party
 * member the whole party's season rating; it now gives each member their
 * share, and a payment above what the share pays is replaced by the share.
 */
export function correctRaidPayment(paidLeaf: number, share: Activity, rules: EarningRules): RaidPaymentCorrection {
  const shareLeaf = leafForActivity(share, rules);
  return paidLeaf > shareLeaf ? { action: "replace", shareLeaf } : { action: "keep" };
}

/**
 * The levels among `paidLevels` that `xp` no longer reaches, lowest first.
 * Their payouts are taken back when XP is, so that reaching them again pays
 * them again.
 */
export function levelsNoLongerReached(xp: number, paidLevels: Iterable<number>, rules: LevelRules): number[] {
  const reached = levelForXp(xp, rules).level;
  return [...new Set(paidLevels)].filter((level) => level > reached).toSorted((a, b) => a - b);
}

import { utcWeekStart, WEEK_MS } from "./quests.ts";

// The Great Sequoia at the heart of the Forest: three guild goals a week, met
// together. Everyone who helps hangs a lantern in it. The rewards are cosmetic
// and go to the whole guild; there is no ranking of who helped most.

/** What a goal counts over the week: the guild's raids, its wars, or the Leaf offered to the tree. */
export const GREAT_GOAL_KINDS = ["raids", "wars", "offered_leaf"] as const;
export type GreatGoalKind = (typeof GREAT_GOAL_KINDS)[number];

export interface GreatGoal {
  /** Stable, so a client can remember which goals it has celebrated. */
  readonly id: string;
  readonly kind: GreatGoalKind;
  readonly target: number;
  readonly title: string;
  /** The cosmetic the whole guild gets when the goal is met. */
  readonly reward: { readonly id: string; readonly title: string };
}

export interface GreatRules {
  /** The week's goals. The same three every week, so a week compares with the last. */
  readonly goals: readonly GreatGoal[];
  /** The least and the most Leaf one offering can be. */
  readonly offering: { readonly min: number; readonly max: number };
  /** Leaf offered that counts as one contribution, as one raid or one war does. */
  readonly leafPerContribution: number;
  /**
   * A helper's lantern glows one step brighter at each of these numbers of
   * contributions in the week: a cosmetic extra for helping more. It is a step,
   * not a place, so nobody is ranked.
   */
  readonly glowAt: readonly number[];
}

/** What a week added up to, for the guild or for one member. */
export interface GreatTotals {
  /** Raids finished: for the guild each party's run once, for a member each run they were in. */
  readonly raids: number;
  /** Wars: for the guild each war once, for a member each war they took part in. */
  readonly wars: number;
  /** Leaf offered to the Great Sequoia, net of any refunded. */
  readonly offeredLeaf: number;
}

/** The week a moment falls in, Monday to Monday in UTC, as the weekly quests run. */
export function greatWeek(at: number): { readonly start: number; readonly end: number } {
  const start = utcWeekStart(at);
  return { start, end: start + WEEK_MS };
}

/** How far the guild is toward a goal, never past its target, and whether it is met. */
export function goalProgress(
  goal: GreatGoal,
  totals: GreatTotals,
): { readonly progress: number; readonly met: boolean } {
  const counted = goal.kind === "raids" ? totals.raids : goal.kind === "wars" ? totals.wars : totals.offeredLeaf;
  const progress = Math.max(0, Math.min(goal.target, Math.floor(counted)));
  return { progress, met: progress >= goal.target };
}

/** How many times a member helped in a week: each raid, each war, and each `leafPerContribution` Leaf offered. */
export function contributionsOf(mine: GreatTotals, rules: GreatRules): number {
  const offered = Math.max(0, Math.floor(mine.offeredLeaf / rules.leafPerContribution));
  return Math.max(0, mine.raids) + Math.max(0, mine.wars) + offered;
}

/** A lantern's glow from the member's contributions: 0 for none, so no lantern, then 1 and up. */
export function lanternGlow(contributions: number, rules: GreatRules): number {
  return rules.glowAt.filter((threshold) => contributions >= threshold).length;
}

/** Whether an offering of this much Leaf is allowed. */
export function offeringAllowed(leaf: number, rules: GreatRules): boolean {
  return Number.isInteger(leaf) && leaf >= rules.offering.min && leaf <= rules.offering.max;
}

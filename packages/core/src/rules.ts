import type { Activity } from "./activity.ts";

/**
 * The numbers that tune the game. They live here, together, so they can be
 * read and changed in one place.
 */
export interface Rules {
  readonly earning: EarningRules;
}

export interface EarningRules {
  /** Leaf paid to each party member per point of season rating a raid earns. */
  readonly leafPerRaidSeasonRating: number;
  /** Leaf paid to a participant per war point they scored. */
  readonly leafPerWarPoint: number;
}

export const DEFAULT_RULES: Rules = {
  earning: {
    leafPerRaidSeasonRating: 1,
    leafPerWarPoint: 1,
  },
};

/**
 * The Leaf an activity pays, as a whole number that is never negative. A war
 * scored at zero or below pays nothing but still counts as an activity.
 */
export function leafForActivity(activity: Activity, rules: EarningRules): number {
  const raw =
    activity.kind === "raid"
      ? activity.seasonRating * rules.leafPerRaidSeasonRating
      : activity.warPoints * rules.leafPerWarPoint;
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

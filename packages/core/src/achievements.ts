import type { PlayerId } from "./player.ts";

/** An achievement milestone a player reached, as Sierra reports it. */
export interface AchievementAward {
  /** Sierra's id for the award, `<player>:<ladder>:<level>`. It never changes and never repeats. */
  readonly awardId: string;
  readonly playerId: PlayerId;
  /** The ladder, such as `raid:TNA`, `raid:all raids`, `war:completed` or `profession:mining`. */
  readonly ladder: string;
  /**
   * The milestone's id within its ladder, or null for awards that have none.
   * The milestones Sierra started with are named after their tier, `bronze`
   * to `mythril`, and keep that id when staff change their threshold or label.
   */
  readonly milestoneId: string | null;
  /** The milestone's tier, such as `diamond`, when Sierra reports one. */
  readonly tier: string | null;
  /** How many raids or wars the milestone stands for, when Sierra reports it. */
  readonly count: number | null;
  /** When it was reached, in milliseconds since the Unix epoch. */
  readonly earnedAt: number;
}

export interface AchievementRules {
  /**
   * Ladders whose milestones pay Leaf, by the start of their key. Only what
   * members do for the guild pays: its raids and its wars. Profession, role
   * and badge ladders pay nothing.
   */
  readonly payingLadders: readonly string[];
  /**
   * Leaf for each milestone, by milestone id. A milestone staff add later has
   * an id of its own and pays nothing until it is listed here.
   */
  readonly leafByMilestone: ReadonlyMap<string, number>;
}

/** The Leaf a milestone pays: 0 when its ladder or its milestone does not pay. */
export function leafForAward(award: AchievementAward, rules: AchievementRules): number {
  if (award.milestoneId === null || !rules.payingLadders.some((prefix) => award.ladder.startsWith(prefix))) {
    return 0;
  }
  return rules.leafByMilestone.get(award.milestoneId) ?? 0;
}

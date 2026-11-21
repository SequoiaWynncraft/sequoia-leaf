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
  /** How many raids or wars the milestone stands for, such as 1000, as it was when reached. */
  readonly threshold: number | null;
  /** The milestone's name, such as `Diamond`, as it was when reached. */
  readonly label: string | null;
  /** When it was reached, in milliseconds since the Unix epoch. */
  readonly earnedAt: number;
}

export interface AchievementRules {
  /**
   * Ladders whose milestones pay Leaf, by the start of their key, each with its
   * own amounts; the first that matches decides. Only what members do for the
   * guild pays: its raids and its wars. Profession, role and badge ladders pay
   * nothing.
   */
  readonly ladders: readonly PayingLadder[];
  /**
   * Whether a milestone's Leaf also counts as XP. Levels measure play, and the
   * raids or wars on the way to a milestone already gave their XP.
   */
  readonly grantsXp: boolean;
}

export interface PayingLadder {
  /** The start of the ladder keys this applies to, such as `raid:`. */
  readonly prefix: string;
  /**
   * Leaf for each milestone, by milestone id. A milestone staff add later has
   * an id of its own and pays nothing until it is listed here.
   */
  readonly leafByMilestone: ReadonlyMap<string, number>;
}

/** The Leaf a milestone pays: 0 when its ladder or its milestone does not pay. */
export function leafForAward(award: AchievementAward, rules: AchievementRules): number {
  if (award.milestoneId === null) {
    return 0;
  }
  const ladder = rules.ladders.find(({ prefix }) => award.ladder.startsWith(prefix));
  return ladder?.leafByMilestone.get(award.milestoneId) ?? 0;
}

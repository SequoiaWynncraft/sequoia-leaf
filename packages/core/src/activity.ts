import type { MinecraftId, PlayerId } from "./player.ts";

/** The guild raids, by the short names the guild uses for them. */
export const RAIDS = {
  notg: "Nest of the Grootslangs",
  nol: "Orphion's Nexus of Light",
  tcc: "The Canyon Colossus",
  tna: "The Nameless Anomaly",
  wtp: "The Wartorn Palace",
} as const;

export type RaidKey = keyof typeof RAIDS;

export const RAID_KEYS: readonly RaidKey[] = ["notg", "nol", "tcc", "tna", "wtp"];

/** The short name of a raid from its full name, or undefined for a raid this list does not know yet. */
export function raidKeyForName(name: string): RaidKey | undefined {
  return RAID_KEYS.find((key) => RAIDS[key] === name);
}

interface ActivityBase {
  /**
   * Identifies this account's part in this event, such as `raid:4812:<Minecraft UUID>`: the
   * account's, not its player's, so that it names the same fact whichever player the account is.
   * Recording the same key twice records the activity once.
   */
  readonly sourceKey: string;
  /** When the event happened, in milliseconds since the Unix epoch. */
  readonly occurredAt: number;
  /**
   * The season rating the event earned the guild. For a raid it is this
   * member's share of the party's rating; until 2026-11-19 the backend
   * reported the whole party's rating to every member.
   */
  readonly seasonRating: number;
}

/** One thing someone (`Who`: a player, or a Minecraft account) did that the game can reward or count. */
type ActivityOf<Who> =
  | (ActivityBase &
      Who & {
        readonly kind: "raid";
        /** The raid's short name, or undefined when it is not in `RAIDS`. */
        readonly raid: RaidKey | undefined;
        /** The raid's full name as the backend reports it. */
        readonly raidName: string;
      })
  | (ActivityBase &
      Who & {
        readonly kind: "war";
        readonly territory: string;
        /** The participant's share of the war, as scored by the backend. */
        readonly warPoints: number;
        /**
         * Whether the territory was in Sequoia's claim when the war was won: the
         * guild taking back its own ground, which members call defending. Left out
         * when the backend does not know.
         */
        readonly inClaim?: boolean;
      });

/** One thing a player did that the game can reward or count toward a quest. */
export type Activity = ActivityOf<{ readonly playerId: PlayerId }>;

/** One thing a Minecraft account did, as the guild's feed reports it, before Leaf knows its player. */
export type ReportedActivity = ActivityOf<{ readonly account: MinecraftId }>;

/** What a reported activity is as the doing of `playerId`, the player its account signs in as. */
export function activityOf(reported: ReportedActivity, playerId: PlayerId): Activity {
  const { account: _account, ...done } = reported;
  return { ...done, playerId };
}

export type ActivityKind = Activity["kind"];

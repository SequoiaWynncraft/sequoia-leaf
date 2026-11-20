import type { PlayerId } from "./player.ts";

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
   * Identifies this player's part in this event, such as `raid:4812:<player id>`.
   * Recording the same key twice records the activity once.
   */
  readonly sourceKey: string;
  /**
   * Identifies the event itself, the same for everyone who took part, such as
   * `raid:4812` for one party's run of a raid or `war:977` for one war.
   */
  readonly eventKey: string;
  readonly playerId: PlayerId;
  /** When the event happened, in milliseconds since the Unix epoch. */
  readonly occurredAt: number;
  /**
   * The season rating the event earned the guild. For a raid it is this
   * member's share of the party's rating; until 2026-11-19 the backend
   * reported the whole party's rating to every member.
   */
  readonly seasonRating: number;
}

/** One thing a player did that the game can reward or count toward a quest. */
export type Activity =
  | (ActivityBase & {
      readonly kind: "raid";
      /** The raid's short name, or undefined when it is not in `RAIDS`. */
      readonly raid: RaidKey | undefined;
      /** The raid's full name as the backend reports it. */
      readonly raidName: string;
    })
  | (ActivityBase & {
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

export type ActivityKind = Activity["kind"];

import type { GroveRank, PlayerId } from "@sequoia-leaf/core";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import type { questJson } from "../quests/json.ts";

/** Something that happened to a player, with its details in the shape the API sends. */
export type PlayerEvent =
  /** A raid or war paid Leaf. `detail` is the raid's name or the territory; `occurred_at` is when it was played. */
  | {
      readonly type: "leaf_earned";
      readonly data: {
        source: "raid" | "war";
        leaf: number;
        xp: number;
        detail: string;
        occurred_at: string;
        /** For a war: whether it was over Sequoia's claim, a defence. Left out when not known. */
        in_claim?: boolean;
      };
    }
  /** A quest was finished and its reward paid. */
  | { readonly type: "quest_completed"; readonly data: { quest: ReturnType<typeof questJson> } }
  /** The player swapped a quest for another. `leaf` is what it cost, 0 for a free reroll. */
  | {
      readonly type: "quest_rerolled";
      readonly data: { replaced: ReturnType<typeof questJson>; quest: ReturnType<typeof questJson>; leaf: number };
    }
  /**
   * The player's XP reached a new level. `leaf` is what the levels reached
   * paid, every level from the one before up to `level`.
   */
  | { readonly type: "level_up"; readonly data: { level: number; leaf: number } }
  /**
   * An achievement milestone paid Leaf. `ladder` is Sierra's key, such as
   * `raid:TNA`; `threshold` is how many raids or wars the milestone stands
   * for and `label` its name, such as `Diamond`.
   */
  | {
      readonly type: "achievement_paid";
      readonly data: {
        award_id: string;
        ladder: string;
        milestone: string;
        tier: string | null;
        threshold: number | null;
        label: string | null;
        leaf: number;
        xp: number;
        earned_at: string;
      };
    }
  /**
   * The player opened a Grove cone of a rank the Forest announces, Dryad or
   * better. `copy` is which copy of the spirit it was, 1 for a new one.
   */
  | {
      readonly type: "grove.cone_opened";
      readonly data: { banner: string; spirit: string; rank: GroveRank; verdant: boolean; copy: number };
    }
  /** The player's Bloom filled, from a raid or from care, and gave them a cone. `cycle` counts their Blooms. */
  | { readonly type: "grove.bloomed"; readonly data: { source: "raid" | "care"; cycle: number } }
  /**
   * A raid the player was in hung a lantern in the Forest. `party` is everyone
   * Leaf credited for it, the player included, in the order of their ids.
   */
  | {
      readonly type: "grove.raid_lantern";
      readonly data: { raid: string; raid_name: string; party: string[]; occurred_at: string };
    }
  /**
   * The guild won a war the player fought in. `players` is everyone Leaf
   * credited for it, in the order of their ids; `in_claim` is left out when not known.
   */
  | {
      readonly type: "guild.war_win";
      readonly data: { war: string; territory: string; players: string[]; occurred_at: string; in_claim?: boolean };
    };

/** An event as stored: its place in the player's history, and its details as the JSON text that was written. */
const StoredEvent = Schema.Struct({ id: Schema.Int, type: Schema.String, data: Schema.String, createdAt: Schema.Int });
export type StoredEvent = typeof StoredEvent.Type;

/**
 * What happened to each player, in order. Streams find new events by reading
 * the table, so an event needs no notification: writing it is enough. A
 * database failure is a defect.
 */
export class Events extends Context.Service<
  Events,
  {
    /** Records an event. Call it in the same transaction as the change it reports. */
    readonly insert: (playerId: PlayerId, event: PlayerEvent, now: number) => Effect.Effect<void>;
    /** A player's events after an event id, oldest first. */
    readonly after: (playerId: PlayerId, afterId: number, limit: number) => Effect.Effect<readonly StoredEvent[]>;
    /** A player's newest events, oldest first. */
    readonly latest: (playerId: PlayerId, limit: number) => Effect.Effect<readonly StoredEvent[]>;
    /** The id of the newest event of any player, or 0 when there are none. Events written from now on have a larger id. */
    readonly latestId: Effect.Effect<number>;
  }
>()("leaf/Events") {
  static readonly layer = Layer.effect(
    Events,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const after = SqlSchema.findAll({
        Request: Schema.Struct({ playerId: Schema.String, afterId: Schema.Int, limit: Schema.Int }),
        Result: StoredEvent,
        execute: ({ playerId, afterId, limit }) => sql`
          SELECT id, type, data, created_at AS createdAt FROM events
          WHERE player_id = ${playerId} AND id > ${afterId}
          ORDER BY id LIMIT ${limit}
        `,
      });
      const latest = SqlSchema.findAll({
        Request: Schema.Struct({ playerId: Schema.String, limit: Schema.Int }),
        Result: StoredEvent,
        execute: ({ playerId, limit }) => sql`
          SELECT id, type, data, created_at AS createdAt FROM events
          WHERE player_id = ${playerId}
          ORDER BY id DESC LIMIT ${limit}
        `,
      });
      const latestId = SqlSchema.findOne({
        Request: Schema.Void,
        Result: Schema.Struct({ id: Schema.Int }),
        execute: () => sql`SELECT COALESCE(MAX(id), 0) AS id FROM events`,
      });
      return Events.of({
        insert: (playerId, event, now) =>
          sql`INSERT INTO events ${sql.insert({ playerId, type: event.type, data: JSON.stringify(event.data), createdAt: now })}`.pipe(
            Effect.asVoid,
            Effect.orDie,
          ),
        after: (playerId, afterId, limit) => after({ playerId, afterId, limit }).pipe(Effect.orDie),
        latest: (playerId, limit) =>
          latest({ playerId, limit }).pipe(
            Effect.map((events) => events.toReversed()),
            Effect.orDie,
          ),
        latestId: latestId(undefined).pipe(
          Effect.map(({ id }) => id),
          Effect.orDie,
        ),
      });
    }),
  );
}

/** An event as the API sends it, as JSON text. The stored details are already JSON, so they are spliced in as they are. */
export function eventJsonText(event: StoredEvent): string {
  const head = JSON.stringify({ id: event.id, type: event.type, created_at: new Date(event.createdAt).toISOString() });
  return `${head.slice(0, -1)},"data":${event.data}}`;
}

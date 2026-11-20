import type { GreatGoalKind, GroveRank, PlayerId } from "@sequoia-leaf/core";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import type { StoredEvent } from "../events/store.ts";
import { PlayerUuid } from "../wire.ts";

/**
 * A member as the guild feed names them: by the name the Forest shows, which a
 * member has only once they opened the Grove, and null before.
 */
export interface FeedMember {
  player_id: string;
  name: string | null;
}

/**
 * Something that happened in the guild, for anyone to see. It carries no more
 * than the Forest already shows: members' ids and their Forest names.
 */
export type GuildEvent =
  /** A raid hung a lantern in the Forest. `party` is everyone Leaf credited for it when it was first recorded. */
  | {
      readonly type: "grove.raid_lantern";
      readonly data: { raid: string; raid_name: string; party: FeedMember[]; occurred_at: string };
    }
  /** The guild won a war. `players` is everyone Leaf credited for it when it was first recorded. */
  | {
      readonly type: "guild.war_win";
      readonly data: {
        war: string;
        territory: string;
        players: FeedMember[];
        occurred_at: string;
        in_claim?: boolean;
      };
    }
  /** A member opened a cone of Dryad or better. */
  | {
      readonly type: "grove.cone_opened";
      readonly data: { member: FeedMember; banner: string; spirit: string; rank: GroveRank; verdant: boolean };
    }
  /** A member's tree grew: their SEQ level reached `level`, for the first time. Only members with a tree. */
  | { readonly type: "grove.level_up"; readonly data: { member: FeedMember; level: number } }
  /** The guild met one of the Great Sequoia's goals for the week. */
  | {
      readonly type: "great.goal_met";
      readonly data: {
        goal: string;
        kind: GreatGoalKind;
        title: string;
        target: number;
        reward: { id: string; title: string };
        week_starts_at: string;
      };
    }
  /** Members listed `count` new things in the marketplace between `from` and `to`. Never what they are. */
  | { readonly type: "market.listings_added"; readonly data: { count: number; from: string; to: string } };

const StoredGuildEvent = Schema.Struct({
  id: Schema.Int,
  type: Schema.String,
  data: Schema.String,
  createdAt: Schema.Int,
});

/**
 * The guild feed: what happened in the guild, in order. Each event is written
 * once by the fact it reports, so writing it again changes nothing. A database
 * failure is a defect.
 */
export class GuildEvents extends Context.Service<
  GuildEvents,
  {
    /** Records an event once by `key`. Call it in the same transaction as the change it reports. */
    readonly insert: (key: string, event: GuildEvent, now: number) => Effect.Effect<void>;
    /** Which of these keys have an event. */
    readonly recorded: (keys: readonly string[]) => Effect.Effect<ReadonlySet<string>>;
    /** Events after an event id, oldest first. */
    readonly after: (afterId: number, limit: number) => Effect.Effect<readonly StoredEvent[]>;
    /** The newest events, oldest first. */
    readonly latest: (limit: number) => Effect.Effect<readonly StoredEvent[]>;
    /** The id of the newest event, or 0 when there are none. */
    readonly latestId: Effect.Effect<number>;
    /** Members by the name the Forest shows, in the order given; null for those who never opened the Grove. */
    readonly members: (playerIds: readonly PlayerId[]) => Effect.Effect<FeedMember[]>;
  }
>()("leaf/GuildEvents") {
  static readonly layer = Layer.effect(
    GuildEvents,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const after = SqlSchema.findAll({
        Request: Schema.Struct({ afterId: Schema.Int, limit: Schema.Int }),
        Result: StoredGuildEvent,
        execute: ({ afterId, limit }) => sql`
          SELECT id, type, data, created_at AS createdAt FROM guild_events WHERE id > ${afterId} ORDER BY id LIMIT ${limit}
        `,
      });
      const latest = SqlSchema.findAll({
        Request: Schema.Int,
        Result: StoredGuildEvent,
        execute: (limit) => sql`
          SELECT id, type, data, created_at AS createdAt FROM guild_events ORDER BY id DESC LIMIT ${limit}
        `,
      });
      const latestId = SqlSchema.findOne({
        Request: Schema.Void,
        Result: Schema.Struct({ id: Schema.Int }),
        execute: () => sql`SELECT COALESCE(MAX(id), 0) AS id FROM guild_events`,
      });
      const recorded = SqlSchema.findAll({
        Request: Schema.Array(Schema.String),
        Result: Schema.Struct({ key: Schema.String }),
        execute: (keys) => sql`SELECT key FROM guild_events WHERE ${sql.in("key", keys)}`,
      });
      const names = SqlSchema.findAll({
        Request: Schema.Array(Schema.String),
        Result: Schema.Struct({ playerId: PlayerUuid, username: Schema.String }),
        execute: (ids) =>
          sql`SELECT player_id AS playerId, username FROM grove_members WHERE ${sql.in("player_id", ids)}`,
      });
      return GuildEvents.of({
        insert: (key, event, now) =>
          sql`
            INSERT INTO guild_events ${sql.insert({ key, type: event.type, data: JSON.stringify(event.data), createdAt: now })}
            ON CONFLICT (key) DO NOTHING
          `.pipe(Effect.asVoid, Effect.orDie),
        recorded: (keys) =>
          keys.length === 0
            ? Effect.succeed(new Set<string>())
            : recorded(keys).pipe(
                Effect.map((rows) => new Set(rows.map((row) => row.key))),
                Effect.orDie,
              ),
        after: (afterId, limit) => after({ afterId, limit }).pipe(Effect.orDie),
        latest: (limit) =>
          latest(limit).pipe(
            Effect.map((events) => events.toReversed()),
            Effect.orDie,
          ),
        latestId: latestId(undefined).pipe(
          Effect.map(({ id }) => id),
          Effect.orDie,
        ),
        members: (playerIds) =>
          playerIds.length === 0
            ? Effect.succeed([])
            : names(playerIds).pipe(
                Effect.map((rows) => {
                  const named = new Map(rows.map((row) => [row.playerId, row.username]));
                  return playerIds.map((id) => ({ player_id: id, name: named.get(id) ?? null }));
                }),
                Effect.orDie,
              ),
      });
    }),
  );
}

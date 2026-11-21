import { DAY_MS, type PlayerId } from "@sequoia-leaf/core";
import { Cache, Clock, Context, Duration, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";

import { knownAmong, UNASKED_KEPT_MS } from "./known.ts";
import { Mojang } from "./mojang.ts";

/** How many players' names are asked of Mojang at once. */
const CONCURRENT_LOOKUPS = 4;
/** A name Mojang was just asked for, found or not, is not asked for again this soon. */
const ASKED_FOR = Duration.minutes(1);
/** When a name was last asked for is written down at most this often, so showing it rarely writes. */
const ASKED_AT_STEP_MS = DAY_MS;

const Named = Schema.Struct({ playerId: Schema.String, username: Schema.String, askedAt: Schema.Int });

/**
 * Players' Minecraft names, for showing members by name. Leaf learns a name
 * when its owner opens the game, which the backend vouches for, and asks
 * Mojang for the rest, but only of players it knows (`knownAmong`). It keeps
 * the names it learns, and removes those nobody asked for in 30 days when it
 * writes a new one. A database failure is a defect.
 */
export class PlayerNames extends Context.Service<
  PlayerNames,
  {
    /** Records a player's name. */
    readonly remember: (playerId: PlayerId, username: string, now: number) => Effect.Effect<void>;
    /**
     * The names of these players, asking Mojang for those Leaf does not have
     * but knows. One Mojang can't name now, or Leaf does not know, is left out.
     */
    readonly of: (playerIds: readonly PlayerId[]) => Effect.Effect<ReadonlyMap<string, string>>;
  }
>()("leaf/PlayerNames") {
  static readonly layer = Layer.effect(
    PlayerNames,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const mojang = yield* Mojang;
      const remember = (playerId: PlayerId, username: string, now: number) =>
        Effect.gen(function* () {
          // Returns the row only when it was written: a new name, or a changed one.
          const written = yield* sql`
            INSERT INTO player_names (player_id, username, updated_at, asked_at)
            VALUES (${playerId}, ${username}, ${now}, ${now})
            ON CONFLICT (player_id) DO UPDATE
            SET username = excluded.username, updated_at = excluded.updated_at, asked_at = excluded.asked_at
            WHERE username IS NOT excluded.username
            RETURNING player_id
          `;
          if (written.length > 0) {
            yield* sql`DELETE FROM player_names WHERE asked_at < ${now - UNASKED_KEPT_MS}`;
          }
        }).pipe(Effect.orDie);
      // Several streams that see the same new player at once ask Mojang once.
      const asked = yield* Cache.makeWith(
        (playerId: PlayerId) =>
          mojang.profile(playerId).pipe(
            Effect.tap((profile) =>
              Option.match(profile, {
                onNone: () => Effect.void,
                onSome: ({ name }) => Effect.flatMap(Clock.currentTimeMillis, (now) => remember(playerId, name, now)),
              }),
            ),
            Effect.map(Option.map(({ name }) => name)),
            Effect.catchTag("MojangError", (error) =>
              Effect.logWarning("Could not ask Mojang for a player's name", error).pipe(Effect.as(Option.none())),
            ),
          ),
        { capacity: 1000, timeToLive: () => ASKED_FOR },
      );
      return PlayerNames.of({
        remember,
        of: (playerIds) =>
          Effect.gen(function* () {
            const wanted = [...new Set(playerIds)];
            if (wanted.length === 0) {
              return new Map();
            }
            const now = yield* Clock.currentTimeMillis;
            const kept = yield* sql`
              SELECT player_id AS playerId, username, asked_at AS askedAt FROM player_names
              WHERE ${sql.in("player_id", wanted)}
            `.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Named))), Effect.orDie);
            const stale = kept
              .filter(({ askedAt }) => now - askedAt >= ASKED_AT_STEP_MS)
              .map(({ playerId }) => playerId);
            if (stale.length > 0) {
              yield* sql`UPDATE player_names SET asked_at = ${now} WHERE ${sql.in("player_id", stale)}`.pipe(
                Effect.orDie,
              );
            }
            const names = new Map(kept.map(({ playerId, username }) => [playerId, username]));
            const known = yield* knownAmong(
              sql,
              wanted.filter((playerId) => !names.has(playerId)),
              now,
            );
            const looked = yield* Effect.forEach(
              [...known],
              (playerId) => Cache.get(asked, playerId).pipe(Effect.map((name) => [playerId, name] as const)),
              { concurrency: CONCURRENT_LOOKUPS },
            );
            for (const [playerId, name] of looked) {
              if (Option.isSome(name)) {
                names.set(playerId, name.value);
              }
            }
            return names;
          }),
      });
    }),
  );
}

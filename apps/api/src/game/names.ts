import type { PlayerId } from "@sequoia-leaf/core";
import { Cache, Clock, Context, Duration, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";

import { Mojang } from "./mojang.ts";

/** How many players' names are asked of Mojang at once. */
const CONCURRENT_LOOKUPS = 4;
/** A name Mojang was just asked for, found or not, is not asked for again this soon. */
const ASKED_FOR = Duration.minutes(1);

const Named = Schema.Struct({ playerId: Schema.String, username: Schema.String });

/**
 * Players' Minecraft names, for showing members by name. Leaf learns a name
 * when its owner opens the game, which the backend vouches for, and asks
 * Mojang for the rest; it keeps every name it learns. A database failure is a
 * defect.
 */
export class PlayerNames extends Context.Service<
  PlayerNames,
  {
    /** Records a player's name. */
    readonly remember: (playerId: PlayerId, username: string, now: number) => Effect.Effect<void>;
    /** The names of these players, asking Mojang for those Leaf does not know. One Mojang can't name now is left out. */
    readonly of: (playerIds: readonly PlayerId[]) => Effect.Effect<ReadonlyMap<string, string>>;
  }
>()("leaf/PlayerNames") {
  static readonly layer = Layer.effect(
    PlayerNames,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const mojang = yield* Mojang;
      const remember = (playerId: PlayerId, username: string, now: number) =>
        sql`
          INSERT INTO player_names (player_id, username, updated_at) VALUES (${playerId}, ${username}, ${now})
          ON CONFLICT (player_id) DO UPDATE SET username = excluded.username, updated_at = excluded.updated_at
          WHERE username IS NOT excluded.username
        `.pipe(Effect.asVoid, Effect.orDie);
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
            const known = yield* sql`
              SELECT player_id AS playerId, username FROM player_names WHERE ${sql.in("player_id", wanted)}
            `.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Named))), Effect.orDie);
            const names = new Map(known.map(({ playerId, username }) => [playerId, username]));
            const looked = yield* Effect.forEach(
              wanted.filter((playerId) => !names.has(playerId)),
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

import { DAY_MS, type PlayerId } from "@sequoia-leaf/core";
import { Effect, Schema } from "effect";
import type { SqlClient } from "effect/sql";

import { PlayerUuid } from "../wire.ts";

/** A player whose game said where they were this recently counts as known. */
export const KNOWN_FROM_PRESENCE_MS = DAY_MS;

/** A kept skin or name that nobody asked for in this long is removed when a new one is written. */
export const UNASKED_KEPT_MS = 30 * DAY_MS;

const Known = Schema.Struct({ playerId: PlayerUuid });

/**
 * Of these players, the ones Leaf knows: those the ledger has an account for,
 * those whose game said where they were in the last day, and those listed on
 * a game's board (a guest's yard stays on it long after they were last here,
 * and everybody sees their name and face there). Only they are asked of
 * Mojang, so no one can make Leaf fetch and keep just any player's skin or
 * name. A database failure is a defect.
 */
export const knownAmong = (
  sql: SqlClient.SqlClient,
  playerIds: readonly PlayerId[],
  now: number,
): Effect.Effect<ReadonlySet<PlayerId>> =>
  playerIds.length === 0
    ? Effect.succeed(new Set())
    : sql`
        SELECT player_id AS playerId FROM accounts WHERE ${sql.in("player_id", playerIds)}
        UNION
        SELECT player_id AS playerId FROM presence
        WHERE ${sql.in("player_id", playerIds)} AND seen_at > ${now - KNOWN_FROM_PRESENCE_MS}
        UNION
        SELECT player_id AS playerId FROM standings WHERE ${sql.in("player_id", playerIds)}
      `.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Known))),
        Effect.map((rows) => new Set(rows.map((row) => row.playerId))),
        Effect.orDie,
      );

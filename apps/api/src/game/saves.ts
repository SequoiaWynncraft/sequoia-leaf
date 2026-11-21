import type { PlayerId, SaveSlot } from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

/** A save as listed: which slot, how many times it was written, and when last. */
const SaveRow = Schema.Struct({ slot: Schema.String, version: Schema.Int, updatedAt: Schema.Int });
export type SaveRow = typeof SaveRow.Type;

/** A save with what it holds, as the JSON text that was written. */
const StoredSave = Schema.Struct({ ...SaveRow.fields, data: Schema.String });
export type StoredSave = typeof StoredSave.Type;

export type SaveWrite =
  | { readonly status: "saved"; readonly version: number; readonly updatedAt: number }
  /** The stored version is not the one the write was made over. Nothing was written. */
  | { readonly status: "conflict" };

const Written = Schema.Struct({ version: Schema.Int, updatedAt: Schema.Int });

/**
 * What each member's games keep, one save per slot, overwritten in place. A
 * write names the version it was made over, so a game that read an older save
 * can never overwrite a newer one. A database failure is a defect.
 */
export class Saves extends Context.Service<
  Saves,
  {
    /** A member's saves, by slot, without what they hold. */
    readonly list: (playerId: PlayerId) => Effect.Effect<readonly SaveRow[]>;
    /** A member's save in one slot, or none when they never saved there. */
    readonly get: (playerId: PlayerId, slot: SaveSlot) => Effect.Effect<Option.Option<StoredSave>>;
    /**
     * Stores `data`, JSON text, over the save at version `over` (0 for none),
     * as the next version, but only while that is still the stored version.
     */
    readonly put: (
      playerId: PlayerId,
      slot: SaveSlot,
      over: number,
      data: string,
      now: number,
    ) => Effect.Effect<SaveWrite>;
  }
>()("leaf/Saves") {
  static readonly layer = Layer.effect(
    Saves,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const list = SqlSchema.findAll({
        Request: Schema.String,
        Result: SaveRow,
        execute: (playerId) => sql`
          SELECT slot, version, updated_at AS updatedAt FROM saves WHERE player_id = ${playerId} ORDER BY slot
        `,
      });
      const get = SqlSchema.findOneOption({
        Request: Schema.Struct({ playerId: Schema.String, slot: Schema.String }),
        Result: StoredSave,
        execute: ({ playerId, slot }) => sql`
          SELECT slot, version, updated_at AS updatedAt, data FROM saves WHERE player_id = ${playerId} AND slot = ${slot}
        `,
      });
      const write = SqlSchema.findOneOption({
        Request: Schema.Struct({
          playerId: Schema.String,
          slot: Schema.String,
          over: Schema.Int,
          data: Schema.String,
          now: Schema.Int,
        }),
        Result: Written,
        // The first write inserts version 1, and finds a row already there if
        // another write came first; every later one updates only the version it read.
        execute: ({ playerId, slot, over, data, now }) =>
          over === 0
            ? sql`
                INSERT INTO saves (player_id, slot, version, data, updated_at)
                VALUES (${playerId}, ${slot}, 1, ${data}, ${now})
                ON CONFLICT (player_id, slot) DO NOTHING
                RETURNING version, updated_at AS updatedAt
              `
            : sql`
                UPDATE saves SET version = version + 1, data = ${data}, updated_at = ${now}
                WHERE player_id = ${playerId} AND slot = ${slot} AND version = ${over}
                RETURNING version, updated_at AS updatedAt
              `,
      });
      return Saves.of({
        list: (playerId) => list(playerId).pipe(Effect.orDie),
        get: (playerId, slot) => get({ playerId, slot }).pipe(Effect.orDie),
        put: (playerId, slot, over, data, now) =>
          write({ playerId, slot, over, data, now }).pipe(
            Effect.map(
              Option.match({
                onNone: (): SaveWrite => ({ status: "conflict" }),
                onSome: ({ version, updatedAt }): SaveWrite => ({ status: "saved", version, updatedAt }),
              }),
            ),
            Effect.orDie,
          ),
      });
    }),
  );
}

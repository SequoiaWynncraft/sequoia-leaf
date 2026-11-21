import { DAY_MS, type PlayerId, type SaveSlot } from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

/** A save as listed: which slot, how many times it was written, and when last. */
const SaveRow = Schema.Struct({ slot: Schema.String, version: Schema.Int, updatedAt: Schema.Int });
export type SaveRow = typeof SaveRow.Type;

/** A save with what it holds, as the JSON text that was written. */
const StoredSave = Schema.Struct({ ...SaveRow.fields, data: Schema.String });
export type StoredSave = typeof StoredSave.Type;

/** The least time between two writes to one slot, in milliseconds. */
export const SAVE_EVERY_MS = 2000;
/** How long a guest's save is kept after it was last written. Members' are kept for good. */
export const GUEST_SAVES_KEPT_MS = 90 * DAY_MS;

export type SaveWrite =
  | { readonly status: "saved"; readonly version: number; readonly updatedAt: number }
  /** The stored version is not the one the write was made over. Nothing was written. */
  | { readonly status: "conflict" }
  /** The slot was written less than `SAVE_EVERY_MS` ago. Nothing was written. */
  | { readonly status: "slow" };

const Written = Schema.Struct({ version: Schema.Int, updatedAt: Schema.Int });

/**
 * What each player's games keep, one save per slot, overwritten in place. A
 * write names the version it was made over, so a game that read an older save
 * can never overwrite a newer one; and one slot is written at most once every
 * two seconds. Each save says whether a guest wrote it: guests' saves not
 * written for 90 days are removed whenever any save is written. A database
 * failure is a defect.
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
     * as the next version, but only while that is still the stored version and
     * it was stored at least `SAVE_EVERY_MS` ago. `guest` is whether a guest writes it.
     */
    readonly put: (
      playerId: PlayerId,
      slot: SaveSlot,
      over: number,
      data: string,
      guest: boolean,
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
          guest: Schema.Boolean,
          now: Schema.Int,
        }),
        Result: Written,
        // The first write inserts version 1, and finds a row already there if
        // another write came first; every later one updates only the version it
        // read, and only once the last write is old enough.
        execute: ({ playerId, slot, over, data, guest, now }) =>
          over === 0
            ? sql`
                INSERT INTO saves (player_id, slot, version, data, updated_at, guest)
                VALUES (${playerId}, ${slot}, 1, ${data}, ${now}, ${guest ? 1 : 0})
                ON CONFLICT (player_id, slot) DO NOTHING
                RETURNING version, updated_at AS updatedAt
              `
            : sql`
                UPDATE saves SET version = version + 1, data = ${data}, updated_at = ${now}, guest = ${guest ? 1 : 0}
                WHERE player_id = ${playerId} AND slot = ${slot} AND version = ${over}
                  AND updated_at <= ${now - SAVE_EVERY_MS}
                RETURNING version, updated_at AS updatedAt
              `,
      });
      /** The stored version of a slot, to tell a stale write from one too soon. */
      const stored = SqlSchema.findOneOption({
        Request: Schema.Struct({ playerId: Schema.String, slot: Schema.String }),
        Result: Schema.Struct({ version: Schema.Int }),
        execute: ({ playerId, slot }) =>
          sql`SELECT version FROM saves WHERE player_id = ${playerId} AND slot = ${slot}`,
      });
      /** Why a write changed nothing: the slot holds another version, or the same one written too recently. */
      const refusal = (playerId: string, slot: string, over: number) =>
        stored({ playerId, slot }).pipe(
          Effect.map((found): SaveWrite =>
            Option.isSome(found) && found.value.version === over ? { status: "slow" } : { status: "conflict" },
          ),
        );
      return Saves.of({
        list: (playerId) => list(playerId).pipe(Effect.orDie),
        get: (playerId, slot) => get({ playerId, slot }).pipe(Effect.orDie),
        put: (playerId, slot, over, data, guest, now) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                const written = yield* write({ playerId, slot, over, data, guest, now });
                if (Option.isNone(written)) {
                  return yield* refusal(playerId, slot, over);
                }
                yield* sql`DELETE FROM saves WHERE guest = 1 AND updated_at < ${now - GUEST_SAVES_KEPT_MS}`;
                const { version, updatedAt } = written.value;
                return { status: "saved", version, updatedAt } satisfies SaveWrite;
              }),
            )
            .pipe(Effect.orDie),
      });
    }),
  );
}

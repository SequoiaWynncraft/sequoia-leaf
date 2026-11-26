/**
 * The pieces players leave for others to meet (`Done.keep`, kept in `play_kept`, one for each player,
 * game and slot) and what a command meets of theirs (`Game.meets`, `Ctx.met`), as the play service
 * handles them. A database failure is a defect.
 */
import { type Ctx, type Kept, KEPT_BYTES, type PlayerId, SLOT } from "@sequoia-leaf/core";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { PlayerNames } from "../game/names.ts";
import { PlayerUuid } from "../wire.ts";

/** A piece as Leaf keeps it: where it was left, and its data as JSON. */
export interface Keeping {
  readonly slot: string;
  readonly data: string;
}

/** A piece another player left at a slot, as read back: whose, the piece, and how many others left one there. */
const Left = Schema.Struct({ playerId: PlayerUuid, data: Schema.fromJsonString(Schema.Unknown), of: Schema.Int });

const utf8 = new TextEncoder();

/** What the play service does with the pieces players leave, on the database and the names it is built with. */
export const keptPieces = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const names = yield* PlayerNames;
  const left = SqlSchema.findOneOption({
    Request: Schema.Struct({ game: Schema.String, slot: Schema.String, not: Schema.String, roll: Schema.Int }),
    Result: Left,
    // One statement, so that the count and the piece picked are of the same pieces.
    execute: ({ game, slot, not, roll }) => sql`
      WITH o AS (SELECT player_id, data FROM play_kept WHERE game = ${game} AND slot = ${slot} AND player_id <> ${not})
      SELECT player_id AS playerId, data, (SELECT count(*) FROM o) AS of FROM o ORDER BY player_id
      LIMIT 1 OFFSET ${roll} % max(1, (SELECT count(*) FROM o))
    `,
  });
  /**
   * One piece left at a slot of a game by a player other than `not`, with how many such there are:
   * of them in the order of their players' ids, the one at `roll`, counted round. None when there
   * are none.
   */
  const pick = (game: string, slot: string, not: string, roll: number) =>
    left({ game, slot, not, roll }).pipe(Effect.orDie);
  return {
    pick,
    /**
     * The pieces a command done leaves that Leaf keeps, each with its data as JSON. One whose slot
     * is not one `SLOT` allows, or whose data is not JSON or comes to more than `KEPT_BYTES`, is a
     * fault in the game's rules and not the player's: it is logged with the game and the slot and
     * let go, and the command stands.
     */
    of: (game: string, player: PlayerId, pieces: readonly Kept[]) =>
      Effect.gen(function* () {
        const kept: Keeping[] = [];
        for (const { slot, data } of pieces) {
          const text: string | undefined = JSON.stringify(data);
          if (SLOT.test(slot) && text !== undefined && utf8.encode(text).byteLength <= KEPT_BYTES)
            kept.push({ slot, data: text });
          else
            yield* Effect.annotateLogs(Effect.logWarning(`A ${game} command left a piece Leaf does not keep`), {
              player,
              game,
              slot,
            });
        }
        return kept;
      }),
    /** Keeps each piece of the player's in a game, in order, over the one at its slot: in the batch's transaction. */
    keep: (player: PlayerId, game: string, pieces: readonly Keeping[], now: number) =>
      Effect.forEach(
        pieces,
        ({ slot, data }) => sql`
          INSERT INTO play_kept (player_id, game, slot, data, updated_at) VALUES (${player}, ${game}, ${slot}, ${data}, ${now})
          ON CONFLICT (player_id, game, slot) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
        `,
        { discard: true },
      ).pipe(Effect.orDie),
    /**
     * A command's call (`ctx`) with what it meets at `slot` (`Game.meets`), picked by the call's own
     * dice (`pick`), its owner named as the boards name players (`PlayerNames`, "Someone" for one
     * Leaf cannot name). The call as it is for no slot, and for a slot nobody else has left one at.
     */
    meet: (game: string, slot: string | null, ctx: Ctx) =>
      Effect.gen(function* () {
        const found = slot === null ? Option.none() : yield* pick(game, slot, ctx.player.id, ctx.seed);
        if (Option.isNone(found)) return ctx;
        const { playerId, data, of } = found.value;
        const name = (yield* names.of([playerId])).get(playerId) ?? "Someone";
        return { ...ctx, met: { player: playerId, name, data, of } } satisfies Ctx;
      }),
  };
});

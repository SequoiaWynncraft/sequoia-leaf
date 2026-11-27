/**
 * The pieces players leave for others to meet (`Done.keep`, kept in `play_kept`, one for each player,
 * game and slot) and what a command meets of theirs (`Game.meets`, `Ctx.met`), as the play service
 * handles them. A slot that is held (`Kept.held`) has one piece at most: its holder's. A database
 * failure is a defect.
 */
import { type Ctx, type Kept, KEPT_BYTES, type Meeting, type PlayerId, SLOT, utcWeekStart } from "@sequoia-leaf/core";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { Events } from "../events/store.ts";
import { PlayerNames } from "../game/names.ts";
import { PlayerUuid } from "../wire.ts";

/** A piece as Leaf keeps it: where it was left, its data as JSON, and whether it holds its slot (`Kept.held`). */
export interface Keeping {
  readonly slot: string;
  readonly data: string;
  readonly held: boolean;
}

/** A piece another player left at a slot, as read back: whose, the piece, and how many others left one there. */
const Left = Schema.Struct({ playerId: PlayerUuid, data: Schema.fromJsonString(Schema.Unknown), of: Schema.Int });

const utf8 = new TextEncoder();

/**
 * What Leaf does with a held slot (`Kept.held`), on the database, the names and the events: reads
 * its holder this week, and keeps a player's piece there as its only one.
 */
const heldSlots = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const names = yield* PlayerNames;
  const events = yield* Events;
  const holder = SqlSchema.findOneOption({
    Request: Schema.Struct({ game: Schema.String, slot: Schema.String, since: Schema.Int }),
    Result: Left,
    execute: ({ game, slot, since }) => sql`
      SELECT player_id AS playerId, data, 1 AS of FROM play_kept
      WHERE game = ${game} AND slot = ${slot} AND updated_at >= ${since}
      ORDER BY updated_at DESC, player_id LIMIT 1
    `,
  });
  /** Lets go of everybody else's piece at a slot, and gives back whose they were and when each was left. */
  const letGo = SqlSchema.findAll({
    Request: Schema.Struct({ game: Schema.String, slot: Schema.String, player: Schema.String }),
    Result: Schema.Struct({ playerId: PlayerUuid, at: Schema.Int }),
    execute: ({ game, slot, player }) => sql`
      DELETE FROM play_kept WHERE game = ${game} AND slot = ${slot} AND player_id <> ${player}
      RETURNING player_id AS playerId, updated_at AS at
    `,
  });
  /**
   * Keeps a player's piece at a held slot: everybody else's there is let go of, and whoever held it
   * this week is told it was taken, and by whom (`held_taken`), named as the boards name players.
   */
  const hold = (player: PlayerId, game: string, slot: string, now: number) =>
    Effect.gen(function* () {
      const since = utcWeekStart(now);
      const taken = (yield* letGo({ game, slot, player })).filter((row) => row.at >= since);
      if (taken.length === 0) return;
      const username = (yield* names.of([player])).get(player) ?? "Someone";
      for (const { playerId } of taken) {
        yield* events.insert(playerId, { type: "held_taken", data: { game, slot, by: { id: player, username } } }, now);
      }
    });
  return { holder, hold };
});

/** What the play service does with the pieces players leave, on the database and the names it is built with. */
export const keptPieces = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const names = yield* PlayerNames;
  const { holder, hold } = yield* heldSlots;
  const left = SqlSchema.findOneOption({
    Request: Schema.Struct({
      game: Schema.String,
      slot: Schema.String,
      not: Schema.String,
      avoid: Schema.String,
      roll: Schema.Int,
    }),
    Result: Left,
    // One statement, so that the count and the piece picked are of the same pieces. `avoid` is a JSON list of ids.
    execute: ({ game, slot, not, avoid, roll }) => sql`
      WITH o AS (
        SELECT player_id, data FROM play_kept WHERE game = ${game} AND slot = ${slot} AND player_id <> ${not}
          AND player_id NOT IN (SELECT value FROM json_each(${avoid}))
      )
      SELECT player_id AS playerId, data, (SELECT count(*) FROM o) AS of FROM o ORDER BY player_id
      LIMIT 1 OFFSET ${roll} % max(1, (SELECT count(*) FROM o))
    `,
  });
  /**
   * One piece left at a slot of a game by a player other than `not` and those to `avoid`, with how
   * many such there are: of them in the order of their players' ids, the one at `roll`, counted
   * round. None when there are none.
   */
  const pick = (game: string, slot: string, not: string, avoid: readonly string[], roll: number) =>
    left({ game, slot, not, avoid: JSON.stringify(avoid), roll }).pipe(Effect.orDie);
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
        for (const { slot, data, held } of pieces) {
          const text: string | undefined = JSON.stringify(data);
          if (SLOT.test(slot) && text !== undefined && utf8.encode(text).byteLength <= KEPT_BYTES)
            kept.push({ slot, data: text, held: held === true });
          else
            yield* Effect.annotateLogs(Effect.logWarning(`A ${game} command left a piece Leaf does not keep`), {
              player,
              game,
              slot,
            });
        }
        return kept;
      }),
    /**
     * Keeps each piece of the player's in a game, in order, over the one at its slot, and a held one
     * as the slot's only piece (`hold`): in the batch's transaction.
     */
    keep: (player: PlayerId, game: string, pieces: readonly Keeping[], now: number) =>
      Effect.forEach(
        pieces,
        ({ slot, data, held }) =>
          Effect.andThen(
            held ? hold(player, game, slot, now) : Effect.void,
            sql`
              INSERT INTO play_kept (player_id, game, slot, data, updated_at) VALUES (${player}, ${game}, ${slot}, ${data}, ${now})
              ON CONFLICT (player_id, game, slot) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
            `,
          ),
        { discard: true },
      ).pipe(Effect.orDie),
    /**
     * A command's call (`ctx`) with what it meets (`Game.meets`), picked by the call's own dice
     * (`pick`) from those not to be avoided, or at a held slot its holder this week (the player
     * too), its owner named as the boards name players (`PlayerNames`, "Someone" for one Leaf cannot
     * name). The call as it is for no meeting, and for a slot nobody it may meet has left one at.
     */
    meet: (game: string, meeting: Meeting | null, ctx: Ctx) =>
      Effect.gen(function* () {
        const found =
          meeting === null
            ? Option.none()
            : meeting.held
              ? yield* holder({ game, slot: meeting.slot, since: utcWeekStart(ctx.now) }).pipe(Effect.orDie)
              : yield* pick(game, meeting.slot, ctx.player.id, meeting.avoid, ctx.seed);
        if (Option.isNone(found)) return ctx;
        const { playerId, data, of } = found.value;
        const name = (yield* names.of([playerId])).get(playerId) ?? "Someone";
        return { ...ctx, met: { player: playerId, name, data, of } } satisfies Ctx;
      }),
  };
});

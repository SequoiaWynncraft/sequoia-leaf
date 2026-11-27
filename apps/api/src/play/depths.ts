/**
 * The Little Raid's endless boards, read from what its runs leave with Leaf (`play_kept`): the
 * deepest room each member has won in an endless way, for all time or this week (`depthSlot`, a
 * week starting on Monday at 00:00 UTC), and the rooms of the Deep Woods a member holds this week
 * (`heldSlot`). Guests leave nothing, so are on no board. A database failure is a defect.
 */
import { type PlayerId, utcWeekStart } from "@sequoia-leaf/core";
import type { EndlessWay } from "@sequoia-leaf/raid/content/endless.ts";
import { depthSlot } from "@sequoia-leaf/raid/depths.ts";
import { heldRoom } from "@sequoia-leaf/raid/endless.ts";
import { Context, Effect, Layer, type Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { PlayerUuid } from "../wire.ts";
import { BOARD_MOST } from "./store.ts";

/** A board's span: every week there has been, or this one. */
export type Span = "ever" | "week";

/**
 * Somebody's deepest room on a board: their place (how many won deeper, or as deep sooner, and one),
 * the room (counting from 1), and when they first won it.
 */
const Deepest = Schema.Struct({ place: Schema.Int, room: Schema.Int, at: Schema.Int });
const OnBoard = Schema.Struct({ ...Deepest.fields, playerId: PlayerUuid });
/** A board: the deepest `BOARD_MOST`, and the player's own place on it, if they are on it. */
export interface DepthBoard {
  readonly top: readonly (typeof OnBoard.Type)[];
  readonly you: Option.Option<typeof Deepest.Type>;
}

export class RaidDepths extends Context.Service<
  RaidDepths,
  {
    /** An endless way's board, for all time or this week, as it stands at `now`. */
    readonly board: (way: EndlessWay, span: Span, playerId: PlayerId, now: number) => Effect.Effect<DepthBoard>;
    /** The rooms of the Deep Woods a player holds this week, counting from 1, in order. */
    readonly held: (playerId: PlayerId, now: number) => Effect.Effect<readonly number[]>;
  }
>()("leaf/RaidDepths") {
  static readonly layer = Layer.effect(
    RaidDepths,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const Where = Schema.Struct({ slot: Schema.String, since: Schema.Int });
      // Each depth left at a board's slot since a moment, with its place among them.
      const placed = ({ slot, since }: typeof Where.Type) => sql`
        WITH b AS (
          SELECT player_id, json_extract(data, '$.room') AS room, updated_at AS at FROM play_kept
          WHERE game = 'raid' AND slot = ${slot} AND updated_at >= ${since}
        )
        SELECT player_id AS playerId, room, at, 1 + (
          SELECT count(*) FROM b AS o
          WHERE o.room > b.room OR (o.room = b.room AND (o.at < b.at OR (o.at = b.at AND o.player_id < b.player_id)))
        ) AS place FROM b
      `;
      const top = SqlSchema.findAll({
        Request: Where,
        Result: OnBoard,
        execute: (where) => sql`SELECT * FROM (${placed(where)}) ORDER BY place LIMIT ${BOARD_MOST}`,
      });
      const own = SqlSchema.findOneOption({
        Request: Schema.Struct({ ...Where.fields, playerId: Schema.String }),
        Result: Deepest,
        execute: ({ playerId, ...where }) => sql`SELECT * FROM (${placed(where)}) WHERE playerId = ${playerId}`,
      });
      const held = SqlSchema.findAll({
        Request: Schema.Struct({ playerId: Schema.String, since: Schema.Int }),
        Result: Schema.Struct({ slot: Schema.String }),
        execute: ({ playerId, since }) => sql`
          SELECT slot FROM play_kept
          WHERE player_id = ${playerId} AND game = 'raid' AND slot LIKE 'deep:%' AND updated_at >= ${since}
        `,
      });
      return RaidDepths.of({
        board: (way, span, playerId, now) => {
          const where = { slot: depthSlot(way, span), since: span === "week" ? utcWeekStart(now) : 0 };
          return Effect.all({ top: top(where), you: own({ ...where, playerId }) }).pipe(Effect.orDie);
        },
        held: (playerId, now) =>
          held({ playerId, since: utcWeekStart(now) }).pipe(
            Effect.map((rows) =>
              rows.flatMap(({ slot }) => [heldRoom(slot)].flatMap((room) => (room === null ? [] : [room + 1]))),
            ),
            Effect.map((rooms) => rooms.toSorted((a, b) => a - b)),
            Effect.orDie,
          ),
      });
    }),
  );
}

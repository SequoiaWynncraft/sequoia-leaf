import { activityReport, DAY_MS, DONE_SHOWN, LOGGED, type Report } from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { Visits } from "./visits.ts";

const VisitRow = Schema.Struct({
  playerId: Schema.String,
  place: Schema.String,
  enteredAt: Schema.Int,
  leftAt: Schema.NullOr(Schema.Int),
});
const SessionRow = Schema.Struct({ playerId: Schema.String, startedAt: Schema.Int });
const SeenRow = Schema.Struct({
  playerId: Schema.String,
  name: Schema.String,
  guest: Schema.BooleanFromBit,
  firstSeenAt: Schema.Int,
  lastSeenAt: Schema.Int,
  secondsTotal: Schema.Int,
});
const DoneRow = Schema.Struct({
  playerId: Schema.String,
  at: Schema.Int,
  game: Schema.String,
  kind: Schema.String,
  data: Schema.String,
});
const WorksRow = Schema.Struct({ playerId: Schema.String, firstAt: Schema.Int, storyOrders: Schema.Int });
const CoinRow = Schema.Struct({ playerId: Schema.String, at: Schema.Int, amount: Schema.Int });
const CommandDayRow = Schema.Struct({
  playerId: Schema.String,
  day: Schema.Int,
  done: Schema.Int,
  refused: Schema.Int,
});

/** What a game logged, as it was stored: JSON, or the text itself if it is not. */
const readData = (text: string): unknown =>
  Option.getOrElse(Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(text), () => text);

/** What the games logged, with what each holds read back. */
const readAll = (rows: readonly (typeof DoneRow.Type)[]) =>
  rows.map((r) => ({ playerId: r.playerId, at: r.at, game: r.game, kind: r.kind, data: readData(r.data) }));

/**
 * The staff's report of who played (`GET /v1/game/admin/activity`): read from the visits, sessions
 * and players Leaf records, what the games logged (`activity`), the Coins ledger (`coin_entries`),
 * and the commands done and refused each day (`command_days`). Reading it first closes every visit
 * gone silent, so that the report is as of now. A database failure is a defect.
 */
export class ActivityReport extends Context.Service<
  ActivityReport,
  { readonly report: (from: number, now: number) => Effect.Effect<Report> }
>()("leaf/ActivityReport") {
  static readonly layer = Layer.effect(
    ActivityReport,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const visits = yield* Visits;
      const visitRows = SqlSchema.findAll({
        Request: Schema.Int,
        Result: VisitRow,
        execute: (from) => sql`
          SELECT player_id AS playerId, place, entered_at AS enteredAt, left_at AS leftAt FROM visits
          WHERE left_at IS NULL OR left_at >= ${from}
          ORDER BY entered_at, id
        `,
      });
      const sessionRows = SqlSchema.findAll({
        Request: Schema.Int,
        Result: SessionRow,
        execute: (from) => sql`
          SELECT player_id AS playerId, started_at AS startedAt FROM sessions
          WHERE ended_at IS NULL OR ended_at >= ${from}
          ORDER BY started_at, id
        `,
      });
      const seenRows = SqlSchema.findAll({
        Request: Schema.Void,
        Result: SeenRow,
        execute: () => sql`
          SELECT player_id AS playerId, name, guest, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt,
                 seconds_total AS secondsTotal
          FROM players_seen
        `,
      });
      // The last few things each player in the period did, newest first.
      const doneRows = SqlSchema.findAll({
        Request: Schema.Int,
        Result: DoneRow,
        execute: (from) => sql`
          SELECT playerId, at, game, kind, data FROM (
            SELECT player_id AS playerId, at, game, kind, data, id,
                   row_number() OVER (PARTITION BY player_id ORDER BY at DESC, id DESC) AS n
            FROM activity
            WHERE player_id IN (SELECT player_id FROM visits WHERE left_at IS NULL OR left_at >= ${from})
          )
          WHERE n <= ${DONE_SHOWN}
          ORDER BY playerId, at DESC, id DESC
        `,
      });
      const raidRows = SqlSchema.findAll({
        Request: Schema.Int,
        Result: DoneRow,
        execute: (from) => sql`
          SELECT player_id AS playerId, at, game, kind, data FROM activity
          WHERE game = 'raid' AND at >= ${from}
            AND kind IN (${LOGGED.raidStarted}, ${LOGGED.raidRoom}, ${LOGGED.raidEnded})
          ORDER BY player_id, at, id
        `,
      });
      // Everyone in the Works in the period: when they first were, and every story order they have filled.
      const worksRows = SqlSchema.findAll({
        Request: Schema.Int,
        Result: WorksRow,
        execute: (from) => sql`
          SELECT player_id AS playerId, min(at) AS firstAt, sum(kind = ${LOGGED.worksStory}) AS storyOrders
          FROM activity
          WHERE game = 'works'
            AND player_id IN (SELECT player_id FROM activity WHERE game = 'works' AND at >= ${from})
          GROUP BY player_id
        `,
      });
      // Coins brought over by hand from the old saves (`import:<player>`) are the lead's doing, not play.
      const coinRows = SqlSchema.findAll({
        Request: Schema.Int,
        Result: CoinRow,
        execute: (from) => sql`
          SELECT player_id AS playerId, at, amount FROM coin_entries
          WHERE at >= ${from} AND key NOT LIKE 'import:%'
          ORDER BY player_id, at, id
        `,
      });
      const commandRows = SqlSchema.findAll({
        Request: Schema.Int,
        Result: CommandDayRow,
        execute: (from) => sql`
          SELECT player_id AS playerId, day, done, refused FROM command_days
          WHERE day > ${from - DAY_MS}
          ORDER BY player_id, day
        `,
      });

      return ActivityReport.of({
        // Read in one transaction, so that every part is of the same moment.
        report: (from, now) =>
          Effect.gen(function* () {
            yield* visits.closeSilent(now);
            return activityReport({
              now,
              from,
              visits: yield* visitRows(from),
              sessions: yield* sessionRows(from),
              seen: yield* seenRows(undefined),
              done: readAll(yield* doneRows(from)),
              raid: readAll(yield* raidRows(from)),
              works: yield* worksRows(from),
              coins: yield* coinRows(from),
              commands: yield* commandRows(from),
            });
          }).pipe(sql.withTransaction, Effect.orDie),
      });
    }),
  );
}

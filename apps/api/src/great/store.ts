import { type GreatTotals, type PlayerId, utcWeekStart, WEEK_MS } from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { PlayerUuid } from "../wire.ts";

/** A member who helped toward the Great Sequoia's goals in a week, and how. */
export interface Helper extends GreatTotals {
  readonly playerId: PlayerId;
  /** The name they last opened the Grove with, or null when they never have. */
  readonly username: string | null;
  /** When they first helped that week. */
  readonly firstAt: number;
}

const Sums = Schema.Struct({ raids: Schema.Int, wars: Schema.Int, offeredLeaf: Schema.Int });

const HelperRow = Schema.Struct({
  playerId: PlayerUuid,
  username: Schema.NullOr(Schema.String),
  raids: Schema.Int,
  wars: Schema.Int,
  offeredLeaf: Schema.Int,
  firstAt: Schema.Int,
});

const HELPER_COLUMNS = `helper.player_id AS playerId, member.username, helper.raids, helper.wars,
  helper.offered AS offeredLeaf, helper.first_at AS firstAt`;

/**
 * The number the tables give the week a moment is in, as migration 12's
 * triggers count them: whole weeks since the first Monday before the epoch.
 */
function weekNumber(at: number): number {
  return Math.floor((at - utcWeekStart(0)) / WEEK_MS);
}

/**
 * What the guild did toward the Great Sequoia, week by week: the raids and wars
 * the credit sync recorded and the Leaf offered through the ledger, which
 * triggers add up as they are recorded. A database failure is a defect.
 */
export class Great extends Context.Service<
  Great,
  {
    /** The guild's raids and wars in the week of `at`, each once, and the Leaf offered, net of refunds. */
    readonly totals: (at: number) => Effect.Effect<GreatTotals>;
    /** Everyone who helped in the week of `at`, in the order they first did. */
    readonly helpers: (at: number) => Effect.Effect<readonly Helper[]>;
    /** How a member helped in the week of `at`, or undefined when they did not. */
    readonly helper: (playerId: PlayerId, at: number) => Effect.Effect<Helper | undefined>;
    /** How many weeks a member has helped in: the rings on their tree. */
    readonly rings: (playerId: PlayerId) => Effect.Effect<number>;
  }
>()("leaf/Great") {
  static readonly layer = Layer.effect(
    Great,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const totals = SqlSchema.findOneOption({
        Request: Schema.Int,
        Result: Sums,
        execute: (week) => sql`SELECT raids, wars, offered AS offeredLeaf FROM great_weeks WHERE week = ${week}`,
      });
      // A week whose only offering was refunded leaves a row of nothing, which is no help.
      const helpers = SqlSchema.findAll({
        Request: Schema.Int,
        Result: HelperRow,
        execute: (week) => sql`
          SELECT ${sql.literal(HELPER_COLUMNS)}
          FROM great_helpers AS helper
          LEFT JOIN grove_members AS member ON member.player_id = helper.player_id
          WHERE helper.week = ${week} AND helper.raids + helper.wars + helper.offered > 0
          ORDER BY helper.first_at, helper.player_id
        `,
      });
      const helper = SqlSchema.findOneOption({
        Request: Schema.Struct({ playerId: Schema.String, week: Schema.Int }),
        Result: HelperRow,
        execute: ({ playerId, week }) => sql`
          SELECT ${sql.literal(HELPER_COLUMNS)}
          FROM great_helpers AS helper
          LEFT JOIN grove_members AS member ON member.player_id = helper.player_id
          WHERE helper.week = ${week} AND helper.player_id = ${playerId}
            AND helper.raids + helper.wars + helper.offered > 0
        `,
      });
      const rings = SqlSchema.findOne({
        Request: Schema.String,
        Result: Schema.Struct({ rings: Schema.Int }),
        execute: (playerId) => sql`
          SELECT COUNT(*) AS rings FROM great_helpers
          WHERE player_id = ${playerId} AND raids + wars + offered > 0
        `,
      });

      return Great.of({
        totals: (at) =>
          totals(weekNumber(at)).pipe(
            Effect.map(Option.getOrElse(() => ({ raids: 0, wars: 0, offeredLeaf: 0 }))),
            Effect.orDie,
          ),
        helpers: (at) => helpers(weekNumber(at)).pipe(Effect.orDie),
        helper: (playerId, at) =>
          helper({ playerId, week: weekNumber(at) }).pipe(Effect.map(Option.getOrUndefined), Effect.orDie),
        rings: (playerId) =>
          rings(playerId).pipe(
            Effect.map((row) => row.rings),
            Effect.orDie,
          ),
      });
    }),
  );
}

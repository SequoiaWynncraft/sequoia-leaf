/**
 * What the games log of what players did (`Done.log`), written down by `PlayStore.log` in the play
 * service's transaction. A database failure is a defect.
 */
import { DAY_MS, LOGGED, type Logged, type PlayerId, talliedFrom, utcDay } from "@sequoia-leaf/core";
import { readFight } from "@sequoia-leaf/raid/fought.ts";
import { Effect, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/sql";

import { tally } from "../tally/store.ts";
import { GAMES } from "./games.ts";

/** How many things a player did are written down in a UTC day, in each table; past that, they are not (the play goes on). */
export const LOGGED_A_DAY = 1000;
/** How long what players did is kept. */
export const ACTIVITY_KEPT_MS = 180 * DAY_MS;
/** How long the raid's fights are kept. */
export const FIGHTS_KEPT_MS = 365 * DAY_MS;

/**
 * `PlayStore.log`: each thing a player did in `activity`; but each raid fight (`raid_fight`) in
 * `raid_fights`, checked as the raid reads one (`readFight`), with the version of the rules Leaf
 * plays it by. Each table takes `LOGGED_A_DAY` of a player's a UTC day, and lets go of what is older
 * than it keeps (`ACTIVITY_KEPT_MS` of the game's, `FIGHTS_KEPT_MS`). The Tally counts each thing it
 * counts, however much was written down. A fight that does not read is a fault in the rules, not
 * the player's: it is logged and let go, and the command stands.
 */
export function loggingIn(sql: SqlClient.SqlClient) {
  const today = SqlSchema.findAll({
    Request: Schema.Struct({
      table: Schema.Literals(["activity", "raid_fights"]),
      playerId: Schema.String,
      since: Schema.Int,
    }),
    Result: Schema.Struct({ n: Schema.Int }),
    execute: ({ table, playerId, since }) =>
      sql`SELECT count(*) AS n FROM ${sql(table)} WHERE at >= ${since} AND player_id = ${playerId}`,
  });
  /** As many of `logged` as `table` still takes of the player's on the UTC day of `now`. */
  const taken = (table: "activity" | "raid_fights", playerId: PlayerId, logged: readonly Logged[], now: number) =>
    logged.length === 0
      ? Effect.succeed([])
      : Effect.map(today({ table, playerId, since: utcDay(now) * DAY_MS }), ([day]) =>
          logged.slice(0, Math.max(0, LOGGED_A_DAY - (day?.n ?? 0))),
        );
  const fought = (playerId: PlayerId, one: Logged, now: number) => {
    const fight = readFight(one.data);
    if (fight === null)
      return Effect.annotateLogs(Effect.logWarning("A raid fight Leaf does not keep"), { player: playerId });
    const { party, against, ...record } = fight;
    const rules = GAMES.raid.rules;
    const sides = { party: JSON.stringify(party), against: against && JSON.stringify(against) };
    return sql`INSERT INTO raid_fights ${sql.insert({ playerId, at: now, rules, ...record, ...sides })}`;
  };
  return {
    log: (playerId: PlayerId, game: string, logged: readonly Logged[], now: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        const fights = logged.filter((one) => one.kind === LOGGED.raidFight);
        const done = logged.filter((one) => one.kind !== LOGGED.raidFight);
        for (const one of yield* taken("activity", playerId, done, now)) {
          yield* sql`
            INSERT INTO activity (player_id, at, game, kind, data)
            VALUES (${playerId}, ${now}, ${game}, ${one.kind}, ${JSON.stringify(one.data)})
          `;
        }
        if (done.length > 0) yield* sql`DELETE FROM activity WHERE game = ${game} AND at < ${now - ACTIVITY_KEPT_MS}`;
        for (const one of yield* taken("raid_fights", playerId, fights, now)) yield* fought(playerId, one, now);
        if (fights.length > 0) yield* sql`DELETE FROM raid_fights WHERE at < ${now - FIGHTS_KEPT_MS}`;
        // The Tally counts all of it, written down or not.
        for (const stat of talliedFrom(logged)) yield* tally(sql, playerId, stat, 1, now);
      }).pipe(Effect.orDie),
  };
}

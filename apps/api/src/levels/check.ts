import type { LevelRules, PlayerId } from "@sequoia-leaf/core";
import { Array as Arr, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { PlayerUuid } from "../wire.ts";
import { payLevels } from "./pay.ts";

/** How many accounts one transaction of a check pays for, so that a check never holds the database for long. */
const CHECKED_AT_ONCE = 100;

/**
 * A check for missed levels, as the one that holds it knows it: check number `run`, against
 * `rules`, of the accounts with an entry after `from` up to `to` that changed their XP or their level
 * payouts, from the first after the player `after`; and once that is done, of those with one after
 * `to` up to `until`, the newest entry when the check began.
 */
export interface LevelCheck {
  readonly run: number;
  readonly rules: LevelRules;
  readonly from: number;
  readonly to: number;
  readonly after: string;
  readonly until: number;
}

const Kept = Schema.Struct({
  rules: Schema.String,
  checkedTo: Schema.Int,
  checkingTo: Schema.NullOr(Schema.Int),
  checkedPlayer: Schema.NullOr(Schema.String),
  run: Schema.Int,
});

/** What the check has to cover from `kept`, up to the newest entry: the range one stopped left, else from where the last ended, or from the start for new rules. */
const rangeOf = (kept: Option.Option<typeof Kept.Type>, rules: string, newest: number) => {
  if (Option.isNone(kept) || kept.value.rules !== rules) return { from: 0, to: newest, after: "" };
  const { checkedTo, checkingTo, checkedPlayer } = kept.value;
  return checkingTo === null
    ? { from: checkedTo, to: newest, after: "" }
    : { from: checkedTo, to: checkingTo, after: checkedPlayer ?? "" };
};

/**
 * Begins a check, if there is anything to check: it takes `level_checks` for its own, with the next
 * number, so that any check begun before it writes nothing more. None when every account has been
 * checked up to the newest entry against these rules.
 */
export const beginLevelCheck = (rules: LevelRules) =>
  SqlClient.SqlClient.use((sql) =>
    Effect.gen(function* () {
      const kept = yield* SqlSchema.findOneOption({
        Request: Schema.Void,
        Result: Kept,
        execute: () => sql`
          SELECT rules, checked_to AS checkedTo, checking_to AS checkingTo, checked_player AS checkedPlayer, run
          FROM level_checks
        `,
      })(undefined);
      const newest = yield* SqlSchema.findOne({
        Request: Schema.Void,
        Result: Schema.Struct({ id: Schema.Int }),
        execute: () => sql`SELECT coalesce(max(id), 0) AS id FROM ledger_entries`,
      })(undefined);
      const json = JSON.stringify(rules);
      const range = rangeOf(kept, json, newest.id);
      if (range.from === range.to) return Option.none<LevelCheck>();
      const run = Option.match(kept, { onNone: () => 1, onSome: (k) => k.run + 1 });
      yield* sql`
        INSERT INTO level_checks (id, rules, checked_to, checking_to, checked_player, run)
        VALUES (1, ${json}, ${range.from}, ${range.to}, ${range.after}, ${run})
        ON CONFLICT (id) DO UPDATE SET rules = excluded.rules, checked_to = excluded.checked_to,
          checking_to = excluded.checking_to, checked_player = excluded.checked_player, run = excluded.run
      `;
      return Option.some<LevelCheck>({ run, rules, ...range, until: newest.id });
    }).pipe(sql.withTransaction),
  );

/** Whether `level_checks` is still the check's own: no check has begun since it did. */
const holds = (sql: SqlClient.SqlClient, check: LevelCheck) =>
  Effect.map(sql`SELECT 1 FROM level_checks WHERE run = ${check.run}`, (rows) => rows.length > 0);

/** The players a check goes through, in id order. */
export const checkedPlayers = (check: LevelCheck) =>
  SqlClient.SqlClient.use((sql) =>
    SqlSchema.findAll({
      Request: Schema.Void,
      Result: Schema.Struct({ playerId: PlayerUuid }),
      execute: () => sql`
        SELECT DISTINCT player_id AS playerId FROM ledger_entries
        WHERE id > ${check.from} AND id <= ${check.to} AND (xp_delta <> 0 OR origin = 'level')
          AND player_id > ${check.after}
        ORDER BY player_id
      `,
    })(undefined),
  ).pipe(Effect.map((rows) => rows.map((row) => row.playerId)));

/**
 * Pays some of a check's players for their levels and records that it got as far as the last of
 * them, in one transaction, if the check is still its own; says what each was paid, or none when
 * another check has begun since, which pays them instead.
 */
export const payLevelCheckPart = (check: LevelCheck, players: readonly PlayerId[], now: number) =>
  SqlClient.SqlClient.use((sql) =>
    Effect.gen(function* () {
      if (!(yield* holds(sql, check))) return Option.none<readonly number[]>();
      const paid = yield* Effect.forEach(players, (playerId) => payLevels(playerId, check.rules, now));
      yield* sql`UPDATE level_checks SET checked_player = ${players.at(-1) ?? check.after} WHERE run = ${check.run}`;
      return Option.some(paid);
    }).pipe(sql.withTransaction),
  );

/**
 * Records a check's range done, if the check is still its own, and gives the range it goes on to
 * (the entries after it up to `until`); none when it is done, or another check has begun since.
 */
export const endLevelRange = (check: LevelCheck) =>
  SqlClient.SqlClient.use((sql) =>
    Effect.gen(function* () {
      if (!(yield* holds(sql, check))) return Option.none<LevelCheck>();
      if (check.to < check.until) {
        yield* sql`
          UPDATE level_checks SET checked_to = ${check.to}, checking_to = ${check.until}, checked_player = ''
          WHERE run = ${check.run}
        `;
        return Option.some<LevelCheck>({ ...check, from: check.to, to: check.until, after: "" });
      }
      yield* sql`
        UPDATE level_checks SET checked_to = ${check.to}, checking_to = NULL, checked_player = NULL
        WHERE run = ${check.run}
      `;
      return Option.none<LevelCheck>();
    }).pipe(sql.withTransaction),
  );

/** Pays a check's range, a hundred accounts a transaction; says what each was paid, and whether the check is still its own. */
const payRange = (check: LevelCheck, now: number) =>
  Effect.gen(function* () {
    const paid: number[] = [];
    for (const part of Arr.chunksOf(yield* checkedPlayers(check), CHECKED_AT_ONCE)) {
      const done = yield* payLevelCheckPart(check, part, now);
      if (Option.isNone(done)) return { paid, held: false };
      paid.push(...done.value);
    }
    return { paid, held: true };
  });

/**
 * Pays every player for the levels they have reached and not been paid for,
 * such as the ones reached before levels paid Leaf. It writes no events: those
 * levels were announced when they were reached. Running it again changes
 * nothing.
 *
 * What a player is owed for levels (`payLevels`) changes only with an entry that changes their XP,
 * or one of origin `level` (a payout, or its reversal), or with the level rules. So a check looks
 * only at the accounts with such an entry since the last check ended (`level_checks`), and at
 * every account with one when the rules are new; it finishes a range a check stopped halfway left,
 * and goes on to the newest entry. It records how far it got every hundred accounts, in the
 * transaction that pays them. A check writes only while `level_checks` is its own: once another
 * has begun, that one finishes the range, and the first stops.
 */
export const payMissedLevels = Effect.fn("payMissedLevels")(function* (rules: LevelRules, now: number) {
  const paid: number[] = [];
  let check = yield* beginLevelCheck(rules);
  while (Option.isSome(check)) {
    const range = yield* payRange(check.value, now);
    paid.push(...range.paid);
    check = range.held ? yield* endLevelRange(check.value) : Option.none();
  }
  const owed = paid.filter((amount) => amount > 0);
  return { players: owed.length, leaf: owed.reduce((sum, amount) => sum + amount, 0) };
}, Effect.orDie);

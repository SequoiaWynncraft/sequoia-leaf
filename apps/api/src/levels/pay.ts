import { draftEntry, leaf, leafForLevel, levelForXp, type LevelRules, type PlayerId } from "@sequoia-leaf/core";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { Events } from "../events/store.ts";
import { Ledger } from "../ledger/store.ts";
import { PlayerUuid } from "../wire.ts";

/**
 * The key of a level's payout. The first time a player reaches a level it is
 * `level:<player>:<level>`; the n-th time, after the earlier payouts were
 * reversed because the player lost the XP, it is `level:<player>:<level>:<n>`.
 */
function levelKey(playerId: PlayerId, level: number, time: number): string {
  return time === 1 ? `level:${playerId}:${level}` : `level:${playerId}:${level}:${time}`;
}

const LEVEL_KEY = /^level:[0-9a-f-]{36}:(\d+)(?::\d+)?$/;

function levelOfKey(key: string): number {
  const level = LEVEL_KEY.exec(key)?.[1];
  if (level === undefined) {
    throw new Error(`Not the key of a level payout: ${key}`);
  }
  return Number(level);
}

/**
 * Pays the Leaf for every level the player has reached and is not paid for,
 * lowest first, and returns the Leaf paid. A level is paid for while its
 * payout stands, so paying again changes nothing. A payout that was reversed,
 * because a correction took back the XP that reached the level, no longer
 * counts: reaching the level again pays it again, once. The Leaf grants no XP,
 * so it can never reach a level by itself.
 *
 * Call it in the transaction that added the XP.
 */
export const payLevels = Effect.fn("payLevels")(function* (playerId: PlayerId, rules: LevelRules, now: number) {
  const ledger = yield* Ledger;
  const reached = levelForXp((yield* ledger.account(playerId)).xp, rules).level;
  const standing = new Set<number>();
  const times = new Map<number, number>();
  for (const { entry, reversed } of yield* ledger.earns(playerId, "level")) {
    const level = levelOfKey(entry.idempotencyKey);
    times.set(level, (times.get(level) ?? 0) + 1);
    if (!reversed) {
      standing.add(level);
    }
  }
  let total = 0;
  for (let level = 2; level <= reached; level += 1) {
    const amount = leafForLevel(level, rules);
    if (amount === 0 || standing.has(level)) {
      continue;
    }
    const idempotencyKey = levelKey(playerId, level, (times.get(level) ?? 0) + 1);
    yield* ledger.insert(
      draftEntry({ kind: "earn", playerId, amount: leaf(amount), xp: 0, source: "level", idempotencyKey }),
      now,
    );
    total += amount;
  }
  return total;
});

/** The level a player's XP has reached. */
export const levelOf = (playerId: PlayerId, rules: LevelRules) =>
  Ledger.use((ledger) => ledger.account(playerId)).pipe(Effect.map((account) => levelForXp(account.xp, rules).level));

/**
 * When the player's XP has passed `levelBefore`, pays the levels reached and
 * says so with a `level_up` event. Returns the Leaf paid. Call it in the
 * transaction that added the XP.
 */
export const levelUp = Effect.fn("levelUp")(function* (
  playerId: PlayerId,
  levelBefore: number,
  rules: LevelRules,
  now: number,
) {
  const level = yield* levelOf(playerId, rules);
  if (level <= levelBefore) {
    return 0;
  }
  const paid = yield* payLevels(playerId, rules, now);
  yield* Events.use((events) => events.insert(playerId, { type: "level_up", data: { level, leaf: paid } }, now));
  return paid;
});

/** How many accounts one transaction of a check pays for, so that a check never holds the database for long. */
const CHECKED_AT_ONCE = 100;

/**
 * A check for missed levels: the accounts with an entry after `from` up to `to` that changed their
 * XP or their level payouts, from the first after the player `after`, against `rules` (as JSON).
 */
interface LevelCheck {
  readonly rules: string;
  readonly from: number;
  readonly to: number;
  readonly after: string;
}

const Kept = Schema.Struct({
  rules: Schema.String,
  checkedTo: Schema.Int,
  checkingTo: Schema.NullOr(Schema.Int),
  checkedPlayer: Schema.NullOr(Schema.String),
});

/**
 * The check to make now: the one under way, if one was stopped; else from where the last one ended
 * up to the newest entry; or from the start, when the rules are not the ones last checked against.
 */
const nextCheck = Effect.fnUntraced(function* (rules: LevelRules) {
  const sql = yield* SqlClient.SqlClient;
  const kept = yield* SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: Kept,
    execute: () => sql`
      SELECT rules, checked_to AS checkedTo, checking_to AS checkingTo, checked_player AS checkedPlayer FROM level_checks
    `,
  })(undefined);
  const newest = yield* SqlSchema.findOne({
    Request: Schema.Void,
    Result: Schema.Struct({ id: Schema.Int }),
    execute: () => sql`SELECT coalesce(max(id), 0) AS id FROM ledger_entries`,
  })(undefined);
  const json = JSON.stringify(rules);
  if (Option.isNone(kept) || kept.value.rules !== json) return { rules: json, from: 0, to: newest.id, after: "" };
  const { checkedTo, checkingTo, checkedPlayer } = kept.value;
  return checkingTo === null
    ? { rules: json, from: checkedTo, to: newest.id, after: "" }
    : { rules: json, from: checkedTo, to: checkingTo, after: checkedPlayer ?? "" };
});

/** The players a check goes through, in id order. */
const checkedPlayers = (check: LevelCheck) =>
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
  );

/** Pays some players of a check for their levels, and records that it got as far as the last of them; returns what each was paid. */
const payPart = (players: readonly PlayerId[], rules: LevelRules, now: number) =>
  SqlClient.SqlClient.use((sql) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const paid = yield* Effect.forEach(players, (playerId) => payLevels(playerId, rules, now));
        yield* sql`UPDATE level_checks SET checked_player = ${players.at(-1) ?? null}`;
        return paid;
      }),
    ),
  );

/**
 * Pays every player for the levels they have reached and not been paid for,
 * such as the ones reached before levels paid Leaf. It writes no events: those
 * levels were announced when they were reached. Running it again changes
 * nothing.
 *
 * What a player is owed for levels (`payLevels`) changes only with an entry that changes their XP,
 * or one of origin `level` (a payout, or its reversal), or with the level rules. So a check looks
 * only at the accounts with such an entry since the last check ended (`level_checks`), and at
 * every account with one when the rules are new. It records how far it got every hundred accounts,
 * in the transaction that pays them, so that a check stopped halfway goes on from there next time.
 */
export const payMissedLevels = Effect.fn("payMissedLevels")(function* (rules: LevelRules, now: number) {
  const sql = yield* SqlClient.SqlClient;
  const check = yield* nextCheck(rules);
  if (check.from === check.to) return { players: 0, leaf: 0 };
  yield* sql`
    INSERT INTO level_checks (id, rules, checked_to, checking_to, checked_player)
    VALUES (1, ${check.rules}, ${check.from}, ${check.to}, ${check.after})
    ON CONFLICT (id) DO UPDATE SET rules = excluded.rules, checked_to = excluded.checked_to,
      checking_to = excluded.checking_to, checked_player = excluded.checked_player
  `;
  const players = (yield* checkedPlayers(check)).map((row) => row.playerId);
  const paid: number[] = [];
  for (let at = 0; at < players.length; at += CHECKED_AT_ONCE) {
    paid.push(...(yield* payPart(players.slice(at, at + CHECKED_AT_ONCE), rules, now)));
  }
  yield* sql`UPDATE level_checks SET checked_to = checking_to, checking_to = NULL, checked_player = NULL`;
  const owed = paid.filter((amount) => amount > 0);
  return { players: owed.length, leaf: owed.reduce((sum, amount) => sum + amount, 0) };
}, Effect.orDie);

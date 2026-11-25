import type { MinecraftId, PlayerId } from "@sequoia-leaf/core";
import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

/** What a merge did with each game's state: moved over, kept beside the other's, or given up for it. */
export type GameMoved = "moved" | "newer" | "older";

const Game = Schema.Struct({ game: Schema.String, updatedAt: Schema.Int });
const Slot = Schema.Struct({ slot: Schema.String, updatedAt: Schema.Int });
const Count = Schema.Struct({ n: Schema.Int });

/**
 * Takes player `from`, who came with Discord alone, into player `into`, the player of the Minecraft
 * account they have just linked, so that everything is in one place: the guild's Leaf and quests the
 * account earned (which are `into`'s and stay where they are) and what `from` played. `from` has no
 * Leaf (only a Minecraft account earns any), so nothing moves through the ledger; one that had some
 * is left as it is, and null is answered. Each game's state
 * moves over; where both have one, the one played last stays and the other is kept in save history,
 * for staff to bring back. Counters and time add up; likes, stays, events and visits move; `into`'s
 * name and skin stay. The merge is recorded in `merges`. Run it in the transaction that links the
 * account. A database failure is a defect.
 */
export const mergeInto = Effect.fnUntraced(function* (
  from: PlayerId,
  into: PlayerId,
  account: MinecraftId,
  now: number,
) {
  const sql = yield* SqlClient.SqlClient;
  const ledgerOf = SqlSchema.findOne({
    Request: Schema.String,
    Result: Count,
    execute: (player) => sql`SELECT count(*) AS n FROM ledger_entries WHERE player_id = ${player}`,
  });
  if ((yield* ledgerOf(from)).n > 0) {
    // Only a Minecraft account earns Leaf, so this is not met; if it were, nothing is moved for it.
    yield* Effect.logWarning("A player with Leaf of their own was not taken into another", { from, into });
    return null;
  }

  const games = yield* moveGames(sql, from, into, now);
  yield* moveSaves(sql, from, into, now);
  yield* addUp(sql, from, into);
  yield* moveLikes(sql, from, into);
  yield* moveHistory(sql, from, into);
  yield* sql`
    INSERT INTO merges (from_id, into_id, account, moved, merged_at)
    VALUES (${from}, ${into}, ${account}, ${JSON.stringify({ games })}, ${now})
  `;
  return games;
}, Effect.orDie);

const gamesOf = (sql: SqlClient.SqlClient, player: PlayerId) =>
  SqlSchema.findAll({
    Request: Schema.String,
    Result: Game,
    execute: (id) => sql`SELECT game, updated_at AS updatedAt FROM play_state WHERE player_id = ${id}`,
  })(player);

const slotsOf = (sql: SqlClient.SqlClient, player: PlayerId) =>
  SqlSchema.findAll({
    Request: Schema.String,
    Result: Slot,
    execute: (id) => sql`SELECT slot, updated_at AS updatedAt FROM saves WHERE player_id = ${id}`,
  })(player);

/** Each game's state: moved over, or, where both have one, the newer kept and the other put in save history. */
const moveGames = (sql: SqlClient.SqlClient, from: PlayerId, into: PlayerId, now: number) =>
  Effect.gen(function* () {
    const games: Record<string, GameMoved> = {};
    const theirs = new Map((yield* gamesOf(sql, into)).map((g) => [g.game, g.updatedAt]));
    for (const { game, updatedAt } of yield* gamesOf(sql, from)) {
      const other = theirs.get(game);
      const keepFrom = other === undefined || updatedAt > other;
      games[game] = other === undefined ? "moved" : keepFrom ? "newer" : "older";
      if (other !== undefined) {
        yield* dropGame(sql, keepFrom ? into : from, game, into, now);
      }
      if (keepFrom) {
        // The postcard goes with the state it was made from; the state is made due, so Leaf writes it again.
        yield* sql`DELETE FROM play_postcards WHERE player_id = ${from} AND game = ${game}`;
        yield* sql`UPDATE play_state SET player_id = ${into}, due_at = ${now} WHERE player_id = ${from} AND game = ${game}`;
        for (const table of ["play_commands", "play_kept", "standings"]) {
          yield* sql`UPDATE ${sql(table)} SET player_id = ${into} WHERE player_id = ${from} AND game = ${game}`;
        }
      }
    }
    return games;
  });

/** Saves from before the games kept states: the same, slot by slot. */
const moveSaves = (sql: SqlClient.SqlClient, from: PlayerId, into: PlayerId, now: number) =>
  Effect.gen(function* () {
    const slots = new Map((yield* slotsOf(sql, into)).map((s) => [s.slot, s.updatedAt]));
    for (const { slot, updatedAt } of yield* slotsOf(sql, from)) {
      const other = slots.get(slot);
      const loser = other === undefined ? null : updatedAt > other ? into : from;
      if (loser !== null) {
        yield* sql`
          INSERT INTO save_history (player_id, slot, kind, version, data, saved_at, kept_at)
          SELECT ${into}, slot, 'earlier', version, data, updated_at, ${now} FROM saves
          WHERE player_id = ${loser} AND slot = ${slot}
        `;
        yield* sql`DELETE FROM saves WHERE player_id = ${loser} AND slot = ${slot}`;
      }
      if (loser !== from) {
        yield* sql`UPDATE saves SET player_id = ${into} WHERE player_id = ${from} AND slot = ${slot}`;
      }
    }
  });

/** Coins, counters, time and awards add up. */
const addUp = (sql: SqlClient.SqlClient, from: PlayerId, into: PlayerId) =>
  Effect.gen(function* () {
    yield* sql`
      INSERT INTO coins (player_id, balance) SELECT ${into}, balance FROM coins WHERE player_id = ${from}
      ON CONFLICT (player_id) DO UPDATE SET balance = balance + excluded.balance
    `;
    yield* sql`DELETE FROM coins WHERE player_id = ${from}`;
    yield* sql`UPDATE coin_entries SET player_id = ${into} WHERE player_id = ${from}`;
    yield* sql`
      INSERT INTO command_days (player_id, day, done, refused)
      SELECT ${into}, day, done, refused FROM command_days WHERE player_id = ${from}
      ON CONFLICT (player_id, day) DO UPDATE SET done = done + excluded.done, refused = refused + excluded.refused
    `;
    yield* sql`
      INSERT INTO time_in (player_id, game, played_ms, afk_ms)
      SELECT ${into}, game, played_ms, afk_ms FROM time_in WHERE player_id = ${from}
      ON CONFLICT (player_id, game) DO UPDATE
      SET played_ms = played_ms + excluded.played_ms, afk_ms = afk_ms + excluded.afk_ms
    `;
    yield* sql`
      INSERT INTO tallies (player_id, stat, n, week, week_n, at)
      SELECT ${into}, stat, n, week, week_n, at FROM tallies WHERE player_id = ${from}
      ON CONFLICT (player_id, stat) DO UPDATE SET
        n = n + excluded.n,
        week_n = CASE
          WHEN week = excluded.week THEN week_n + excluded.week_n
          WHEN excluded.week > week THEN excluded.week_n
          ELSE week_n
        END,
        week = max(week, excluded.week),
        at = max(at, excluded.at)
    `;
    yield* sql`INSERT OR IGNORE INTO awards (player_id, id, at) SELECT ${into}, id, at FROM awards WHERE player_id = ${from}`;
    for (const table of ["command_days", "time_in", "tallies", "awards"]) {
      yield* sql`DELETE FROM ${sql(table)} WHERE player_id = ${from}`;
    }
  });

/** Likes and stays move to the one player, except any they would make of their own camp. */
const moveLikes = (sql: SqlClient.SqlClient, from: PlayerId, into: PlayerId) =>
  Effect.gen(function* () {
    for (const [table, who, owner] of [
      ["camp_likes", "liker_id", "owner_id"],
      ["camp_visits", "visitor_id", "owner_id"],
    ] as const) {
      yield* sql`UPDATE OR IGNORE ${sql(table)} SET ${sql(who)} = ${into} WHERE ${sql(who)} = ${from} AND ${sql(owner)} != ${into}`;
      yield* sql`UPDATE OR IGNORE ${sql(table)} SET ${sql(owner)} = ${into} WHERE ${sql(owner)} = ${from} AND ${sql(who)} != ${into}`;
      yield* sql`DELETE FROM ${sql(table)} WHERE ${sql(who)} = ${from} OR ${sql(owner)} = ${from}`;
    }
  });

/** Their history moves whole; `into`'s name and skin, its account's, stay. */
const moveHistory = (sql: SqlClient.SqlClient, from: PlayerId, into: PlayerId) =>
  Effect.gen(function* () {
    for (const table of ["events", "activity", "sessions", "visits", "banner_people", "sign_ins"]) {
      yield* sql`UPDATE ${sql(table)} SET player_id = ${into} WHERE player_id = ${from}`;
    }
    yield* sql`UPDATE visits SET camp_owner = ${into} WHERE camp_owner = ${from}`;
    yield* sql`UPDATE last_visits SET camp_owner = ${into} WHERE camp_owner = ${from}`;
    yield* sql`
      INSERT INTO last_visits (player_id, visit_id, place, guest, heard_at, left_at, stay, camp_owner)
      SELECT ${into}, visit_id, place, guest, heard_at, left_at, stay, camp_owner FROM last_visits WHERE player_id = ${from}
      ON CONFLICT (player_id) DO UPDATE SET
        visit_id = excluded.visit_id, place = excluded.place, guest = excluded.guest, heard_at = excluded.heard_at,
        left_at = excluded.left_at, camp_owner = excluded.camp_owner
      WHERE excluded.visit_id > last_visits.visit_id
    `;
    yield* sql`DELETE FROM last_visits WHERE player_id = ${from}`;
    yield* sql`
      INSERT INTO players_seen (player_id, name, guest, first_seen_at, last_seen_at, seconds_total, sessions, stay)
      SELECT ${into}, name, guest, first_seen_at, last_seen_at, seconds_total, sessions, stay
      FROM players_seen WHERE player_id = ${from}
      ON CONFLICT (player_id) DO UPDATE SET
        first_seen_at = min(first_seen_at, excluded.first_seen_at),
        last_seen_at = max(last_seen_at, excluded.last_seen_at),
        seconds_total = seconds_total + excluded.seconds_total,
        sessions = sessions + excluded.sessions
    `;
    // `into`'s name and skin are its account's; `from`'s were their Discord name and Leaf's figure.
    for (const table of ["players_seen", "player_names", "skins"]) {
      yield* sql`DELETE FROM ${sql(table)} WHERE player_id = ${from}`;
    }
  });

/** Drops `player`'s state of `game`, keeping it in `keeper`'s save history so staff can bring it back. */
const dropGame = (sql: SqlClient.SqlClient, player: PlayerId, game: string, keeper: PlayerId, now: number) =>
  Effect.gen(function* () {
    yield* sql`
      INSERT INTO save_history (player_id, slot, kind, version, data, saved_at, kept_at)
      SELECT ${keeper}, ${`play:${game}`}, 'earlier', rev, state, updated_at, ${now} FROM play_state
      WHERE player_id = ${player} AND game = ${game}
    `;
    for (const table of ["play_postcards", "play_commands", "play_kept", "standings"]) {
      yield* sql`DELETE FROM ${sql(table)} WHERE player_id = ${player} AND game = ${game}`;
    }
    yield* sql`DELETE FROM play_state WHERE player_id = ${player} AND game = ${game}`;
  });

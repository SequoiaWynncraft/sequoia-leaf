import type { MinecraftId, PlayerId } from "@sequoia-leaf/core";
import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

/** What a merge did with each game's state: moved over, kept beside the other's, or given up for it. */
export type GameMoved = "moved" | "newer" | "older";

const Game = Schema.Struct({ game: Schema.String, rev: Schema.Int, updatedAt: Schema.Int });
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
  yield* addUp(sql, from, into, now);
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
    execute: (id) => sql`SELECT game, rev, updated_at AS updatedAt FROM play_state WHERE player_id = ${id}`,
  })(player);

/** Each game's state: moved over, or, where both have one, the newer kept and the other put in save history. */
const moveGames = (sql: SqlClient.SqlClient, from: PlayerId, into: PlayerId, now: number) =>
  Effect.gen(function* () {
    const games: Record<string, GameMoved> = {};
    const theirs = new Map((yield* gamesOf(sql, into)).map((g) => [g.game, g]));
    for (const { game, rev, updatedAt } of yield* gamesOf(sql, from)) {
      const theirsOf = theirs.get(game);
      const other = theirsOf?.updatedAt;
      const keepFrom = other === undefined || updatedAt > other;
      games[game] = other === undefined ? "moved" : keepFrom ? "newer" : "older";
      if (other !== undefined) {
        yield* dropGame(sql, keepFrom ? into : from, game, into, now);
      }
      if (keepFrom) {
        // The postcard goes with the state it was made from; the state is made due, so Leaf writes it again.
        // Its revision passes both players' so that no copy of either, kept anywhere, is taken for it.
        const next = Math.max(rev, theirsOf?.rev ?? 0) + 1;
        yield* sql`DELETE FROM play_postcards WHERE player_id = ${from} AND game = ${game}`;
        yield* sql`
          UPDATE play_state SET player_id = ${into}, rev = ${next}, due_at = ${now}
          WHERE player_id = ${from} AND game = ${game}
        `;
        for (const table of ["play_commands", "play_kept", "standings"]) {
          yield* sql`UPDATE ${sql(table)} SET player_id = ${into} WHERE player_id = ${from} AND game = ${game}`;
        }
      }
    }
    return games;
  });

/**
 * Coins, counters, time and awards add up. Coins move as Coins always do, by entries (they are
 * append-only): one out of `from`, one into `into`, each named for this merge, earned by neither.
 */
const addUp = (sql: SqlClient.SqlClient, from: PlayerId, into: PlayerId, now: number) =>
  Effect.gen(function* () {
    const held = yield* SqlSchema.findAll({
      Request: Schema.String,
      Result: Schema.Struct({ balance: Schema.Int }),
      execute: (id) => sql`SELECT balance FROM coins WHERE player_id = ${id} AND balance > 0`,
    })(from);
    for (const { balance } of held) {
      yield* sql`
        INSERT INTO coin_entries (player_id, amount, reason, game, key, at, earned) VALUES
          (${from}, ${-balance}, 'moved', NULL, ${`moved:${from}:out`}, ${now}, 0),
          (${into}, ${balance}, 'moved', NULL, ${`moved:${from}:in`}, ${now}, 0)
      `;
    }
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
    // One open visit a player: theirs closes where it was last heard of, as a page gone quiet would.
    yield* sql`UPDATE visits SET left_at = heard_at WHERE player_id = ${from} AND left_at IS NULL`;
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

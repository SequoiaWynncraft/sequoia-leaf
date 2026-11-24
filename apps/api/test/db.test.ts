import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Ctx, leaf, playerId } from "@sequoia-leaf/core";
import { PULLS } from "@sequoia-leaf/pulls";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";

import { AppConfig } from "../src/config.ts";
import { Database } from "../src/db.ts";
import { Ledger } from "../src/ledger/store.ts";
import { rejection, testConfig } from "./support.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "leaf-db-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true });
});

/** Runs a program against the database file at `path`, opened as the server opens it. */
function onFile<A, E>(path: string, program: Effect.Effect<A, E, SqlClient.SqlClient | Ledger>): Promise<A> {
  const database = Ledger.layer.pipe(
    Layer.provideMerge(Database),
    Layer.provide(Layer.succeed(AppConfig)(testConfig({ databasePath: path }))),
  );
  return Effect.runPromise(program.pipe(Effect.provide(database)));
}

/** Runs SQL against the database file at `path`. */
/** Undoes migration 37: no newest visit kept for each player, and visits indexed by when they were last heard of. */
const beforeLastVisits = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    for (const trigger of [
      "visits_opened",
      "visits_heard",
      "visits_removed",
      "players_seen_stay",
      "players_seen_first",
    ]) {
      yield* sql`DROP TRIGGER ${sql(trigger)}`;
    }
    yield* sql`DROP TABLE last_visits`;
    yield* sql`DROP INDEX visits_open_by_heard`;
    yield* sql`CREATE INDEX visits_by_heard ON visits (heard_at)`;
  });

/** Undoes migrations 37 and 36: and no check for missed levels kept. */
const beforeLevelChecks = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    yield* beforeLastVisits(sql);
    yield* sql`DROP TABLE level_checks`;
  });

/** Undoes migrations 37 to 34: no likes of camps kept, and `presence` back, empty, as migrations 12 to 29 left it. */
const beforeDropPresence = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    yield* beforeLevelChecks(sql);
    yield* sql`DROP TABLE camp_likes`;
    yield* sql`
      CREATE TABLE presence (
        player_id TEXT    PRIMARY KEY,
        username  TEXT    NOT NULL,
        place     TEXT    NOT NULL,
        seen_at   INTEGER NOT NULL,
        stay      INTEGER NOT NULL DEFAULT 1 CHECK (stay IN (0, 1)),
        guest     INTEGER NOT NULL DEFAULT 0 CHECK (guest IN (0, 1)),
        left_at   INTEGER
      ) STRICT
    `;
    yield* sql`CREATE INDEX presence_by_time ON presence (seen_at)`;
  });

/** Undoes migrations 34 and 33 (who is about from visits), for a test going back before them. */
const beforeAboutFromVisits = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    yield* beforeDropPresence(sql);
    yield* sql`DROP INDEX visits_by_heard`;
    yield* sql`ALTER TABLE players_seen DROP COLUMN stay`;
  });

/** Undoes migrations 33 and 32 (when each state is next due a tend), for a test going back before them. */
const beforePlayDue = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    yield* beforeAboutFromVisits(sql);
    yield* sql`DROP INDEX play_state_due`;
    yield* sql`ALTER TABLE play_state DROP COLUMN due_at`;
  });

/**
 * Undoes migrations 33 (`about_from_visits`), 32 (`play_due`), 31 (a state's generation,
 * `play_state.born`) and 30 (the Tally's `tallies` and `camp_visits`), for a test going back before them.
 */
const beforeTallies = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    yield* beforePlayDue(sql);
    yield* sql`ALTER TABLE play_state DROP COLUMN born`;
    yield* sql`DROP TABLE tallies`;
    yield* sql`DROP TABLE camp_visits`;
  });

/**
 * Undoes migrations 33 to 28 (`about_from_visits`, `play_due`, `play_born`, `tallies`, `presence_left`, `time_in`), for a
 * test going back before them: `played` as migrations 23 and 27 left it.
 */
const beforeTimeIn = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    yield* beforeTallies(sql);
    yield* sql`ALTER TABLE presence DROP COLUMN left_at`;
    yield* sql`DROP TABLE time_in`;
    yield* sql`ALTER TABLE visits DROP COLUMN acted_at`;
    yield* sql`
      CREATE TABLE played (
        player_id TEXT,
        game      TEXT,
        ms        INTEGER NOT NULL,
        seen_at   INTEGER NOT NULL,
        afk_ms    INTEGER NOT NULL DEFAULT 0,
        afk       INTEGER NOT NULL DEFAULT 0 CHECK (afk IN (0, 1)),
        PRIMARY KEY (player_id, game)
      ) STRICT, WITHOUT ROWID
    `;
  });

function query(path: string, statement: (sql: SqlClient.SqlClient) => Effect.Effect<ReadonlyArray<unknown>, unknown>) {
  return onFile(path, SqlClient.SqlClient.use(statement));
}

describe("the database", () => {
  it("creates the file and its directory, and keeps what was written when opened again", async () => {
    const path = join(directory, "nested", "leaf.db");
    await onFile(
      path,
      Ledger.use((ledger) =>
        ledger.post({ kind: "earn", playerId: alice, amount: leaf(110), source: "raid", idempotencyKey: "a" }, 1),
      ),
    );

    const account = await onFile(
      path,
      Ledger.use((ledger) => ledger.account(alice)),
    );

    expect(account.balance).toBe(110);
  });

  it("sets up a new database from the schema migration, once", async () => {
    const path = join(directory, "leaf.db");
    await onFile(path, Effect.void);

    expect(await query(path, (sql) => sql`SELECT migration_id, name FROM effect_sql_migrations`)).toEqual([
      { migration_id: 10, name: "schema" },
      { migration_id: 11, name: "announcements" },
      { migration_id: 12, name: "game" },
      { migration_id: 13, name: "presence_stay" },
      { migration_id: 14, name: "guests" },
      { migration_id: 15, name: "save_history" },
      { migration_id: 16, name: "activity" },
      { migration_id: 17, name: "play" },
      { migration_id: 18, name: "earned" },
      { migration_id: 19, name: "standings" },
      { migration_id: 20, name: "purchases" },
      { migration_id: 21, name: "awards" },
      { migration_id: 22, name: "banner_people" },
      { migration_id: 23, name: "played" },
      { migration_id: 24, name: "play_guest" },
      { migration_id: 25, name: "wars_by_time" },
      { migration_id: 26, name: "play_kept" },
      { migration_id: 27, name: "afk" },
      { migration_id: 28, name: "time_in" },
      { migration_id: 29, name: "presence_left" },
      { migration_id: 30, name: "tallies" },
      { migration_id: 31, name: "play_born" },
      { migration_id: 32, name: "play_due" },
      { migration_id: 33, name: "about_from_visits" },
      { migration_id: 34, name: "drop_presence" },
      { migration_id: 35, name: "camp_likes" },
      { migration_id: 36, name: "level_checks" },
      { migration_id: 37, name: "last_visits" },
    ]);
    // Each feed has its own lease and cursor, not started yet.
    expect(await query(path, (sql) => sql`SELECT name, started_at, cursor FROM sync_state ORDER BY name`)).toEqual([
      { name: "achievements", started_at: null, cursor: null },
      { name: "credits", started_at: null, cursor: null },
    ]);
  });

  it("opens a database migrated before Leaf used Effect's migrator, such as an older backup, applying only what came after", async () => {
    const path = join(directory, "leaf.db");
    await onFile(
      path,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* Ledger.use((ledger) =>
          ledger.post({ kind: "earn", playerId: alice, amount: leaf(110), source: "raid", idempotencyKey: "a" }, 1),
        );
        // Put the record back the way the old migrator kept it, one row per file.
        yield* sql`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT, WITHOUT ROWID`;
        yield* sql`
          WITH RECURSIVE n(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM n WHERE id < 10)
          INSERT INTO schema_migrations SELECT printf('%04d_old.sql', id), 1763294400000 FROM n
        `;
        yield* sql`DROP TABLE effect_sql_migrations`;
        // Nor had it the tables added since.
        yield* sql`DROP TABLE announcements`;
        for (const table of [
          "saves",
          "skins",
          "player_names",
          "save_history",
          "visits",
          "sessions",
          "players_seen",
          "play_state",
          "play_commands",
          "coin_entries",
          "coins",
          "command_days",
          "activity",
          "standings",
          "cancelled_purchases",
          "awards",
          "banner_people",
          "play_kept",
          "time_in",
          "tallies",
          "camp_visits",
          "camp_likes",
          "level_checks",
          "last_visits",
        ]) {
          yield* sql`DROP TABLE ${sql(table)}`;
        }
        yield* sql`DROP INDEX activities_wars`;
      }),
    );

    const account = await onFile(
      path,
      Ledger.use((ledger) => ledger.account(alice)),
    );

    expect(account.balance).toBe(110);
    expect(await query(path, (sql) => sql`SELECT max(migration_id) AS latest FROM effect_sql_migrations`)).toEqual([
      { latest: 37 },
    ]);
    expect(await query(path, (sql) => sql`SELECT count(*) AS n FROM announcements`)).toEqual([{ n: 0 }]);
    expect(await query(path, (sql) => sql`SELECT count(*) AS n FROM saves`)).toEqual([{ n: 0 }]);
    expect(await query(path, (sql) => sql`SELECT name FROM sqlite_master WHERE name = 'presence'`)).toEqual([]);
  });

  it("marks each state kept before it knew a guest's as theirs: from where it stands, or else as the player was last seen", async () => {
    const path = join(directory, "leaf.db");
    const guest = "00000000-0000-4000-8000-00000000000a";
    const member = "00000000-0000-4000-8000-00000000000b";
    const unknown = "00000000-0000-4000-8000-00000000000c";
    await onFile(
      path,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // Back to before migration 24 (after 23, `played`), with a guest on a board, a guest last seen,
        // and a player never seen.
        yield* sql`ALTER TABLE play_state DROP COLUMN guest`;
        yield* sql`DROP INDEX activities_wars`;
        yield* sql`DROP TABLE play_kept`;
        yield* beforeTimeIn(sql);
        yield* sql`ALTER TABLE played DROP COLUMN afk_ms`;
        yield* sql`ALTER TABLE played DROP COLUMN afk`;
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 24`;
        for (const [player, game] of [
          [guest, "works"],
          [guest, "town"],
          [member, "works"],
          [unknown, "works"],
        ] as const) {
          yield* sql`INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (${player}, ${game}, 1, '{}', 1)`;
        }
        yield* sql`INSERT INTO standings (player_id, game, score, also, guest, updated_at) VALUES (${guest}, 'works', 5, '{}', 1, 1)`;
        yield* sql`INSERT INTO players_seen (player_id, name, guest, first_seen_at, last_seen_at) VALUES (${guest}, 'G', 1, 1, 1)`;
        yield* sql`INSERT INTO players_seen (player_id, name, guest, first_seen_at, last_seen_at) VALUES (${member}, 'M', 0, 1, 1)`;
      }),
    );
    expect(
      await query(path, (sql) => sql`SELECT player_id AS player, game, guest FROM play_state ORDER BY player_id, game`),
    ).toEqual([
      { player: guest, game: "town", guest: 1 },
      { player: guest, game: "works", guest: 1 },
      { player: member, game: "works", guest: 0 },
      { player: unknown, game: "works", guest: 0 },
    ]);
  });

  it("keeps how many of each prize each member who has pulled has, from their stored pulls, as the game reads them", async () => {
    const path = join(directory, "leaf.db");
    const pulled = "00000000-0000-4000-8000-00000000000a";
    const opened = "00000000-0000-4000-8000-00000000000b";
    const raided = "00000000-0000-4000-8000-00000000000c";
    const guest = "00000000-0000-4000-8000-00000000000d";
    const ctx: Ctx = {
      now: Date.UTC(2026, 10, 25),
      player: { id: pulled, guest: false },
      seed: 7,
      room: 0,
      awards: [],
    };
    const have = { "figure:greg": 2, "headliner:banner-1": 1 };
    // With a ware of the Treasury's, retired: let go of as the game reads the state.
    const state = PULLS.encode({ ...PULLS.create(ctx), have: { ...have, "ware:jar": 1 } });
    expect(PULLS.decode(state)?.have).toEqual(have);
    await onFile(
      path,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // Back to before migration 26, with a member who has pulled, one who has only opened the
        // pulls, one who has only played the raid, and a guest.
        yield* sql`DROP TABLE play_kept`;
        yield* beforeTimeIn(sql);
        yield* sql`ALTER TABLE played DROP COLUMN afk_ms`;
        yield* sql`ALTER TABLE played DROP COLUMN afk`;
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 26`;
        for (const [player, game, text, isGuest] of [
          [pulled, "pulls", state, 0],
          [opened, "pulls", PULLS.encode(PULLS.create(ctx)), 0],
          [raided, "raid", "{}", 0],
          [guest, "pulls", state, 1],
        ] as const) {
          yield* sql`
            INSERT INTO play_state (player_id, game, rev, state, updated_at, guest)
            VALUES (${player}, ${game}, 1, ${text}, 5, ${isGuest})
          `;
        }
      }),
    );
    expect(
      await query(path, (sql) => sql`SELECT player_id AS player, game, slot, data, updated_at AS at FROM play_kept`),
    ).toEqual([{ player: pulled, game: "pulls", slot: "have", data: JSON.stringify(have), at: 5 }]);
  });

  it("starts each player's time in each game from what Leaf had: their pages' calls as played, the rest of their visits since as AFK", async () => {
    const path = join(directory, "leaf.db");
    const member = "00000000-0000-4000-8000-00000000000a";
    const stayer = "00000000-0000-4000-8000-00000000000b";
    const MINUTE = 60_000;
    const began = Date.UTC(2026, 10, 22, 22, 49, 27);
    await onFile(
      path,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // Back to before migration 28, Leaf having begun counting calls at migration 23.
        yield* beforeTimeIn(sql);
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 28`;
        yield* sql`UPDATE effect_sql_migrations SET created_at = '2026-11-22 22:49:27' WHERE migration_id = 23`;
        // The member's pages called the town ten minutes, the pulls five and the raid two; the stayer's none.
        for (const [game, ms] of [
          ["town", 10 * MINUTE],
          ["pulls", 5 * MINUTE],
          ["raid", 2 * MINUTE],
        ] as const) {
          yield* sql`INSERT INTO played (player_id, game, ms, seen_at) VALUES (${member}, ${game}, ${ms}, ${began})`;
        }
        // Since then the member was in town 40 minutes, in a camp 5 and at the table 1 (less than its
        // calls); and in town before then, which counts for nothing. The stayer came to town half an
        // hour before then, and is there still, two hours after.
        const [session] = yield* sql<{ id: number }>`
          INSERT INTO sessions (player_id, guest, started_at) VALUES (${member}, 0, ${began}) RETURNING id
        `;
        for (const [player, place, from, minutes, open] of [
          [member, "town", began - 60 * MINUTE, 30, false],
          [member, "town", began + MINUTE, 40, false],
          [member, "camp", began + 50 * MINUTE, 5, false],
          [member, "table", began + 60 * MINUTE, 1, false],
          [stayer, "town", began - 30 * MINUTE, 150, true],
        ] as const) {
          const to = from + minutes * MINUTE;
          yield* sql`
            INSERT INTO visits (session_id, player_id, guest, place, source, entered_at, heard_at, instance, left_at, seconds)
            VALUES (${session?.id ?? 0}, ${player}, 0, ${place}, 'call', ${from}, ${to}, 'old', ${open ? null : to}, ${minutes * 60})
          `;
        }
      }),
    );
    expect(
      await query(
        path,
        (sql) => sql`SELECT player_id AS player, game, played_ms AS played, afk_ms AS afk FROM time_in ORDER BY 1, 2`,
      ),
    ).toEqual([
      { player: member, game: "raid", played: 2 * MINUTE, afk: 0 },
      { player: member, game: "town", played: 15 * MINUTE, afk: 30 * MINUTE },
      { player: stayer, game: "town", played: 0, afk: 120 * MINUTE },
    ]);
    expect(await query(path, (sql) => sql`SELECT name FROM sqlite_master WHERE name = 'played'`)).toEqual([]);
  });

  it("has each yard due a tend two minutes after it was last written, and no state of another game ever", async () => {
    const path = join(directory, "leaf.db");
    const member = "00000000-0000-4000-8000-00000000000a";
    const written = Date.UTC(2026, 10, 23, 20);
    await onFile(
      path,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // Back to before migration 32, with a yard and a camp stored.
        yield* beforePlayDue(sql);
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 32`;
        for (const game of ["works", "town"]) {
          yield* sql`INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (${member}, ${game}, 3, '{}', ${written})`;
        }
      }),
    );
    expect(await query(path, (sql) => sql`SELECT game, due_at AS due FROM play_state ORDER BY game`)).toEqual([
      { game: "town", due: null },
      { game: "works", due: written + 120_000 },
    ]);
  });

  it("keeps whether each player's character stays from their presence row, and yes for one with none", async () => {
    const path = join(directory, "leaf.db");
    const [stays, goes, unsaid] = ["a", "b", "c"].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
    await onFile(
      path,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // Back to before migration 33: two players with presence rows, one without.
        yield* beforeAboutFromVisits(sql);
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 33`;
        for (const [player, stay] of [
          [stays, 1],
          [goes, 0],
          [unsaid, null],
        ] as const) {
          yield* sql`
            INSERT INTO players_seen (player_id, name, guest, first_seen_at, last_seen_at) VALUES (${player}, 'P', 0, 1, 1)
          `;
          if (stay !== null)
            yield* sql`
              INSERT INTO presence (player_id, username, place, seen_at, stay, guest) VALUES (${player}, 'P', 'town', 1, ${stay}, 0)
            `;
        }
      }),
    );
    expect(await query(path, (sql) => sql`SELECT player_id AS player, stay FROM players_seen ORDER BY 1`)).toEqual([
      { player: stays, stay: 1 },
      { player: goes, stay: 0 },
      { player: unsaid, stay: 1 },
    ]);
  });

  it("keeps each player's newest visit, and whether they stay, from the visits they had", async () => {
    const path = join(directory, "leaf.db");
    const [alice2, bob2, carol2] = ["a", "b", "c"].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
    await onFile(
      path,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // Back to before migration 37: Alice in town now after a camp, Bob gone who would rather not stay, Carol never seen.
        yield* beforeLastVisits(sql);
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 37`;
        yield* sql`INSERT INTO sessions (id, player_id, guest, started_at) VALUES (1, ${alice2}, 0, 1), (2, ${bob2}, 1, 1)`;
        yield* sql`
          INSERT INTO visits (session_id, player_id, guest, place, source, entered_at, heard_at, left_at, instance)
          VALUES (1, ${alice2}, 0, 'camp', 'call', 1, 5, 6, 'old'), (2, ${bob2}, 1, 'works', 'room', 2, 7, 9, 'old'),
                 (1, ${alice2}, 0, 'town', 'room', 6, 8, NULL, 'old')
        `;
        yield* sql`
          INSERT INTO players_seen (player_id, name, guest, first_seen_at, last_seen_at, stay)
          VALUES (${alice2}, 'A', 0, 1, 1, 1), (${bob2}, 'B', 1, 1, 1, 0), (${carol2}, 'C', 0, 1, 1, 1)
        `;
      }),
    );
    expect(
      await query(
        path,
        (sql) => sql`SELECT player_id, place, guest, heard_at, left_at, stay FROM last_visits ORDER BY 1`,
      ),
    ).toEqual([
      { player_id: alice2, place: "town", guest: 0, heard_at: 8, left_at: null, stay: 1 },
      { player_id: bob2, place: "works", guest: 1, heard_at: 7, left_at: 9, stay: 0 },
    ]);
  });

  it("enforces foreign keys, which SQLite leaves off unless asked", async () => {
    expect(await query(join(directory, "leaf.db"), (sql) => sql`PRAGMA foreign_keys`)).toEqual([{ foreign_keys: 1 }]);
  });

  it("refuses an entry that reverses one that does not exist", async () => {
    const refused = await rejection(
      query(
        join(directory, "leaf.db"),
        (sql) => sql`
          INSERT INTO ledger_entries
            (player_id, kind, balance_delta, xp_delta, origin, idempotency_key, reverses_id, created_at)
          VALUES (${alice}, 'reversal', -5, -5, 'raid', 'undo', 999, 1)
        `,
      ),
    );

    expect(Bun.inspect(refused)).toContain("reversal_mismatch");
  });
});

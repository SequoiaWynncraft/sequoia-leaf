import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { leaf, playerId } from "@sequoia-leaf/core";
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
          "presence",
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
          "played",
        ]) {
          yield* sql`DROP TABLE ${sql(table)}`;
        }
      }),
    );

    const account = await onFile(
      path,
      Ledger.use((ledger) => ledger.account(alice)),
    );

    expect(account.balance).toBe(110);
    expect(await query(path, (sql) => sql`SELECT max(migration_id) AS latest FROM effect_sql_migrations`)).toEqual([
      { latest: 24 },
    ]);
    expect(await query(path, (sql) => sql`SELECT count(*) AS n FROM announcements`)).toEqual([{ n: 0 }]);
    expect(await query(path, (sql) => sql`SELECT count(*) AS n FROM saves`)).toEqual([{ n: 0 }]);
    expect(await query(path, (sql) => sql`SELECT count(*) AS n FROM presence WHERE stay = 1`)).toEqual([{ n: 0 }]);
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
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = 24`;
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

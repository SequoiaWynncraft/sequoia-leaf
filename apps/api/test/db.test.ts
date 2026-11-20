import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun";
import { leaf, playerId } from "@sequoia-leaf/core";
import { Effect, Layer, String as Str } from "effect";
import { SqlClient } from "effect/sql";

import schemaAtMigration10 from "../migrations/0010_schema.ts";
import groveAtMigration11 from "../migrations/0011_grove.ts";
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
      { migration_id: 11, name: "grove" },
      { migration_id: 12, name: "great" },
      { migration_id: 13, name: "market" },
      { migration_id: 14, name: "conversions" },
    ]);
    // Each feed has its own lease and cursor, not started yet.
    expect(await query(path, (sql) => sql`SELECT name, started_at, cursor FROM sync_state ORDER BY name`)).toEqual([
      { name: "achievements", started_at: null, cursor: null },
      { name: "credits", started_at: null, cursor: null },
    ]);
  });

  it("opens a database migrated before Leaf used Effect's migrator, such as an older backup, applying only what came after", async () => {
    const path = join(directory, "leaf.db");
    // A database as the old migrator left it: the schema of migration 10, recorded one row per file.
    await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord({ "10_schema": schemaAtMigration10 }) });
        yield* Ledger.use((ledger) =>
          ledger.post({ kind: "earn", playerId: alice, amount: leaf(110), source: "raid", idempotencyKey: "a" }, 1),
        );
        yield* sql`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT, WITHOUT ROWID`;
        yield* sql`
          WITH RECURSIVE n(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM n WHERE id < 10)
          INSERT INTO schema_migrations SELECT printf('%04d_old.sql', id), 1763294400000 FROM n
        `;
        yield* sql`DROP TABLE effect_sql_migrations`;
      }).pipe(
        Effect.provide(
          Ledger.layer.pipe(
            Layer.provideMerge(SqliteClient.layer({ filename: path, transformQueryNames: Str.camelToSnake })),
          ),
        ),
      ),
    );

    const account = await onFile(
      path,
      Ledger.use((ledger) => ledger.account(alice)),
    );

    expect(account.balance).toBe(110);
    expect(
      await query(
        path,
        (sql) => sql`SELECT migration_id FROM effect_sql_migrations WHERE migration_id > 10 ORDER BY 1`,
      ),
    ).toEqual([11, 12, 13, 14].map((id) => ({ migration_id: id })));
  });

  it("adds up for the Great Sequoia the raids and wars recorded before it was built", async () => {
    const path = join(directory, "leaf.db");
    const before = Date.UTC(2026, 10, 24);
    await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* SqliteMigrator.run({
          loader: SqliteMigrator.fromRecord({ "10_schema": schemaAtMigration10, "11_grove": groveAtMigration11 }),
        });
        // A party of two in one raid, and a war, on Tuesday 24 November 2026.
        for (const [key, event, kind] of [
          [`raid:5:${alice}`, "raid:5", "raid"],
          ["raid:5:00000000-0000-4000-8000-00000000000b", "raid:5", "raid"],
          [`war:8:${alice}`, "war:8", "war"],
        ] as const) {
          yield* sql`
            INSERT INTO activities (source_key, event_key, player_id, kind, detail, season_rating, occurred_at, recorded_at)
            VALUES (${key}, ${event}, ${key.slice(-36)}, ${kind}, 'x', 100, ${before}, ${before})
          `;
        }
      }).pipe(Effect.provide(SqliteClient.layer({ filename: path, transformQueryNames: Str.camelToSnake }))),
    );

    await onFile(path, Effect.void);

    expect(await query(path, (sql) => sql`SELECT raids, wars, offered FROM great_weeks`)).toEqual([
      { raids: 1, wars: 1, offered: 0 },
    ]);
    expect(
      await query(path, (sql) => sql`SELECT player_id, raids, wars FROM great_helpers ORDER BY player_id`),
    ).toEqual([
      { player_id: alice, raids: 1, wars: 1 },
      { player_id: "00000000-0000-4000-8000-00000000000b", raids: 1, wars: 0 },
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

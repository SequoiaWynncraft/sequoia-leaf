import { dirname, join } from "node:path";

import { BunServices } from "@effect/platform-bun";
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun";
import { Effect, FileSystem, Layer, String as Str } from "effect";
import { SqlClient } from "effect/sql";

import { AppConfig } from "./config.ts";

const MIGRATIONS = join(import.meta.dir, "..", "migrations");

/**
 * Before Leaf ran Effect's migrator, it recorded the migrations it applied in
 * `schema_migrations`, by file name. This copies that record into the
 * migrator's table, so the migrator does not apply them again. Every backup
 * taken before 19 November 2026 is such a database, so this is what lets one
 * be restored. The old table stays, so an older version can still start on it.
 */
const adoptOldRecord = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const old = yield* sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`;
  if (old.length === 0) {
    return;
  }
  yield* sql.withTransaction(
    Effect.gen(function* () {
      // The table the migrator makes for SQLite; it leaves one that exists alone.
      yield* sql`
        CREATE TABLE IF NOT EXISTS effect_sql_migrations (
          migration_id integer PRIMARY KEY NOT NULL,
          created_at datetime NOT NULL DEFAULT current_timestamp,
          name VARCHAR(255) NOT NULL
        )
      `;
      // `0007_war_claim.sql` is migration 7, `war_claim`.
      yield* sql`
        INSERT OR IGNORE INTO effect_sql_migrations (migration_id, name, created_at)
        SELECT CAST(substr(name, 1, 4) AS INTEGER), substr(name, 6, length(name) - 9),
               datetime(applied_at / 1000, 'unixepoch')
        FROM schema_migrations
      `;
    }),
  );
});

/**
 * A SQLite database, open for the life of the layer, with its schema brought
 * up to date before anything uses it. `:memory:` gives a private, empty one,
 * which is what the tests use.
 *
 * Columns are snake_case in SQL and camelCase in code: `sql.insert` takes
 * camelCase objects, and queries name the columns they read as the code does
 * (`player_id AS playerId`), which costs nothing per row.
 */
export const databaseAt = (filename: string) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // Off by default, for each connection. A reversal references the entry it undoes.
      yield* sql`PRAGMA foreign_keys = ON`;
      yield* adoptOldRecord;
      yield* SqliteMigrator.run({ loader: SqliteMigrator.fromFileSystem(MIGRATIONS) });
    }),
  ).pipe(
    Layer.provide(BunServices.layer),
    Layer.provideMerge(SqliteClient.layer({ filename, transformQueryNames: Str.camelToSnake })),
  );

/** The database file the settings name, its directory created when missing. */
export const Database = Layer.unwrap(
  Effect.gen(function* () {
    const { databasePath } = yield* AppConfig;
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(dirname(databasePath), { recursive: true });
    return databaseAt(databasePath);
  }),
).pipe(Layer.provide(BunServices.layer));

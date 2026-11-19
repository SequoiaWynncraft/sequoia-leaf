import { dirname, join } from "node:path";

import { BunServices } from "@effect/platform-bun";
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun";
import { Effect, FileSystem, Layer, String as Str } from "effect";
import { SqlClient } from "effect/sql";

import { AppConfig } from "./config.ts";

const MIGRATIONS = join(import.meta.dir, "..", "migrations");

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

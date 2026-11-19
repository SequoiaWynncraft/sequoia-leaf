import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { Context, Effect, Layer } from "effect";

import { AppConfig } from "./config.ts";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "migrations");

/**
 * Opens the database file, creating it and its directory when missing, and
 * brings its schema up to date. `:memory:` opens a private empty database,
 * which is what the tests use.
 */
export function openDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, { create: true });
  // Readers do not block the writer, and a snapshot can be taken while serving.
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

/**
 * Applies the migrations that have not run yet, in file name order, each in
 * its own transaction. Returns the names of the ones it applied.
 */
export function migrate(db: Database, directory: string = MIGRATIONS_DIR): string[] {
  db.run(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT, WITHOUT ROWID",
  );
  const applied = new Set(
    db
      .query<{ name: string }, []>("SELECT name FROM schema_migrations")
      .all()
      .map((row) => row.name),
  );
  const pending = readdirSync(directory)
    .filter((name) => name.endsWith(".sql") && !applied.has(name))
    .toSorted((a, b) => a.localeCompare(b));
  for (const name of pending) {
    const sql = readFileSync(join(directory, name), "utf8");
    db.transaction(() => {
      db.run(sql);
      db.query("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(name, Date.now());
    })();
  }
  return pending;
}

/**
 * The database, open for the life of the app and closed when it stops, which
 * folds the write-ahead log back in. Its calls are synchronous: the stores take
 * it as it is.
 */
export class Db extends Context.Service<Db, Database>()("leaf/Db") {
  /** The file the settings name. */
  static readonly layer = Layer.effect(
    Db,
    Effect.gen(function* () {
      const { databasePath } = yield* AppConfig;
      return yield* Effect.acquireRelease(
        Effect.sync(() => openDatabase(databasePath)),
        (db) => Effect.sync(() => db.close()),
      );
    }),
  );
}

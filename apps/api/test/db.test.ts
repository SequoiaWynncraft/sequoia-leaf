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
        for (const table of ["saves", "skins", "player_names", "presence"]) {
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
      { latest: 14 },
    ]);
    expect(await query(path, (sql) => sql`SELECT count(*) AS n FROM announcements`)).toEqual([{ n: 0 }]);
    expect(await query(path, (sql) => sql`SELECT count(*) AS n FROM saves`)).toEqual([{ n: 0 }]);
    expect(await query(path, (sql) => sql`SELECT count(*) AS n FROM presence WHERE stay = 1`)).toEqual([{ n: 0 }]);
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

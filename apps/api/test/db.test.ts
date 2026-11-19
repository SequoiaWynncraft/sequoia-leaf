import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BunServices } from "@effect/platform-bun";
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun";
import { leaf, playerId } from "@sequoia-leaf/core";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";

import { AppConfig } from "../src/config.ts";
import { Database, databaseAt } from "../src/db.ts";
import { Ledger } from "../src/ledger/store.ts";
import { rejection, testConfig } from "./support.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const bob = playerId("00000000-0000-4000-8000-00000000000b");
const carol = playerId("00000000-0000-4000-8000-00000000000c");
const dave = playerId("00000000-0000-4000-8000-00000000000d");
/** The quest columns from before quests had a second way to finish. */
const FIRST_QUEST_COLUMNS =
  "player_id, slot, sequence, template_id, objective_type, objective_raid, target, reward_leaf, reward_xp, progress, started_at, expires_at, completed_at";
const MIGRATIONS = join(import.meta.dir, "..", "migrations");

/** Applies the migrations numbered below `id`, or all of them, and answers the ones it applied. */
const migrate = (before = Number.POSITIVE_INFINITY) =>
  SqliteMigrator.run({
    loader: SqliteMigrator.fromFileSystem(MIGRATIONS).pipe(
      Effect.map((migrations) => migrations.filter(([id]) => id < before)),
    ),
  });

/** Runs a program against a bare database in memory, which the program migrates as it needs. */
const inMemory = <A, E>(program: Effect.Effect<A, E, SqlClient.SqlClient | BunServices.BunServices>) =>
  Effect.runPromise(program.pipe(Effect.provide([SqliteClient.layer({ filename: ":memory:" }), BunServices.layer])));

/** Runs a program against the database file at `path`, as Leaf opens it. */
const onFile = <A, E>(
  path: string,
  program: Effect.Effect<A, E, SqlClient.SqlClient | Ledger | BunServices.BunServices>,
) =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(Ledger.layer.pipe(Layer.provideMerge(databaseAt(path)), Layer.merge(BunServices.layer))),
    ),
  );

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "leaf-db-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true });
});

describe("the database", () => {
  it("creates the file and its directory, and keeps what was written when opened again", async () => {
    const path = join(directory, "nested", "leaf.db");
    const leafDatabase = Ledger.layer.pipe(
      Layer.provideMerge(Database),
      Layer.provide(Layer.succeed(AppConfig)(testConfig({ databasePath: path }))),
    );
    await Effect.runPromise(
      Ledger.use((ledger) =>
        ledger.post({ kind: "earn", playerId: alice, amount: leaf(110), source: "raid", idempotencyKey: "a" }, 1),
      ).pipe(Effect.provide(leafDatabase)),
    );

    const account = await Effect.runPromise(
      Ledger.use((ledger) => ledger.account(alice)).pipe(Effect.provide(leafDatabase)),
    );

    expect(account.balance).toBe(110);
  });

  it("applies each migration once", async () => {
    const path = join(directory, "leaf.db");
    await onFile(path, Effect.void);

    const [again, applied] = await onFile(
      path,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return [yield* migrate(), yield* sql`SELECT migration_id, name FROM effect_sql_migrations ORDER BY 1`];
      }),
    );

    expect(again).toEqual([]);
    expect(applied).toEqual([
      { migrationId: 1, name: "ledger" },
      { migrationId: 2, name: "activities" },
      { migrationId: 3, name: "quests" },
      { migrationId: 4, name: "events" },
      { migrationId: 5, name: "season_rating_quests" },
      { migrationId: 6, name: "achievement_sync" },
      { migrationId: 7, name: "war_claim" },
      { migrationId: 8, name: "either_or_quests" },
      { migrationId: 9, name: "timed_quests" },
      { migrationId: 10, name: "quest_rerolls" },
    ]);
  });

  it("takes over the record of a database migrated before Leaf used Effect's migrator, applying nothing again", async () => {
    const path = join(directory, "leaf.db");
    await onFile(
      path,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* Ledger.use((ledger) =>
          ledger.post({ kind: "earn", playerId: alice, amount: leaf(110), source: "raid", idempotencyKey: "a" }, 1),
        );
        // Put the record back the way the old migrator kept it.
        yield* sql`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT, WITHOUT ROWID`;
        yield* sql`
          INSERT INTO schema_migrations
          SELECT printf('%04d_%s.sql', migration_id, name), 1763294400000 FROM effect_sql_migrations
        `;
        yield* sql`DROP TABLE effect_sql_migrations`;
      }),
    );

    const [record, old, account] = await onFile(
      path,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return [
          yield* sql`SELECT migration_id, name, created_at FROM effect_sql_migrations ORDER BY 1`,
          yield* sql`SELECT name FROM sqlite_master WHERE name = 'schema_migrations'`,
          yield* Ledger.use((ledger) => ledger.account(alice)),
        ] as const;
      }),
    );

    expect(record).toHaveLength(10);
    expect(record[0]).toEqual({ migrationId: 1, name: "ledger", createdAt: "2025-11-16 12:00:00" });
    expect(record[9]).toEqual({ migrationId: 10, name: "quest_rerolls", createdAt: "2025-11-16 12:00:00" });
    expect(old).toEqual([]);
    expect(account.balance).toBe(110);
  });

  it("gives the awards feed its own lease and cursor, not started yet", async () => {
    const states = await inMemory(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* migrate();
        return yield* sql`SELECT name, started_at, cursor FROM sync_state ORDER BY name`;
      }),
    );

    expect(states).toEqual([
      { name: "achievements", started_at: null, cursor: null },
      { name: "credits", started_at: null, cursor: null },
    ]);
  });

  it("keeps the quests already handed out when the table is rebuilt for season rating", async () => {
    const [applied, quests] = await inMemory(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* migrate(5);
        yield* sql.unsafe(
          `INSERT INTO quests VALUES ('${alice}', 'daily', 1, 'daily.raids.nol.3', 'raids', 'nol', 3, 300, 150, 2, 10, NULL, NULL),
                                     ('${alice}', 'weekly', 1, 'weekly.wars.15', 'wars', NULL, 15, 800, 400, 15, 10, 20, 15)`,
        );
        const later = yield* migrate();
        const kept = yield* sql.unsafe(`SELECT ${FIRST_QUEST_COLUMNS} FROM quests ORDER BY slot`);
        // A season rating quest fits the rebuilt table.
        yield* sql.unsafe(
          `INSERT INTO quests (${FIRST_QUEST_COLUMNS})
           VALUES ('${alice}', 'daily', 2, 'daily.season_rating.1000', 'season_rating', NULL, 1000, 250, 125, 440, 30, NULL, NULL)`,
        );
        return [later, kept] as const;
      }),
    );

    expect(applied.map(([id]) => id)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(quests).toEqual([
      {
        player_id: alice,
        slot: "daily",
        sequence: 1,
        template_id: "daily.raids.nol.3",
        objective_type: "raids",
        objective_raid: "nol",
        target: 3,
        reward_leaf: 300,
        reward_xp: 150,
        progress: 2,
        started_at: 10,
        expires_at: null,
        completed_at: null,
      },
      {
        player_id: alice,
        slot: "weekly",
        sequence: 1,
        template_id: "weekly.wars.15",
        objective_type: "wars",
        objective_raid: null,
        target: 15,
        reward_leaf: 800,
        reward_xp: 400,
        progress: 15,
        started_at: 10,
        expires_at: 20,
        completed_at: 15,
      },
    ]);
  });

  it("gives quests still open a second way to finish, counting from the upgrade", async () => {
    const rows = await inMemory(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* migrate(8);
        yield* sql.unsafe(
          `INSERT INTO quests VALUES
             ('${alice}', 'daily', 4, 'daily.raids.nol.3', 'raids', 'nol', 3, 300, 150, 2, 10, NULL, NULL),
             ('${alice}', 'daily', 3, 'daily.raids.any.2', 'raids', NULL, 2, 200, 100, 2, 5, NULL, 9),
             ('${bob}', 'daily', 1, 'daily.raids.any.2', 'raids', NULL, 2, 200, 100, 1, 10, NULL, NULL),
             ('${carol}', 'daily', 1, 'daily.wars.2', 'wars', NULL, 2, 200, 100, 1, 10, NULL, NULL),
             ('${dave}', 'daily', 1, 'daily.season_rating.1000', 'season_rating', NULL, 1000, 250, 125, 440, 10, NULL, NULL),
             ('${alice}', 'weekly', 1, 'weekly.raids.tna.12', 'raids', 'tna', 12, 800, 400, 5, 10, 20, NULL),
             ('${bob}', 'weekly', 1, 'weekly.raids.any.20', 'raids', NULL, 20, 800, 400, 5, 10, 20, NULL),
             ('${carol}', 'weekly', 1, 'weekly.wars.15', 'wars', NULL, 15, 800, 400, 5, 10, 20, NULL),
             ('${alice}', 'repeatable', 7, 'repeatable.raids.any.8', 'raids', NULL, 8, 200, 100, 3, 10, NULL, NULL)`,
        );
        yield* migrate();
        return yield* sql`
          SELECT template_id || ' ' || progress || '/' || target || (CASE WHEN completed_at IS NULL THEN '' ELSE ' done' END) AS quest,
                 alternative_type || ' ' || alternative_progress || '/' || alternative_target AS alternative
          FROM quests ORDER BY player_id, slot, sequence
        `;
      }),
    );

    expect(rows).toEqual([
      { quest: "daily.raids.any.2 2/2 done", alternative: null },
      { quest: "daily.raids.nol.3 2/3", alternative: "wars 0/9" },
      { quest: "repeatable.raids.any.8 3/8", alternative: "wars 0/24" },
      { quest: "weekly.raids.tna.12 5/12", alternative: "wars 0/60" },
      { quest: "daily.raids.any.2 1/2", alternative: "wars 0/6" },
      { quest: "weekly.raids.any.20 5/20", alternative: "wars 0/60" },
      { quest: "daily.wars.2 1/2", alternative: "raids 0/1" },
      { quest: "weekly.wars.15 5/15", alternative: "raids 0/5" },
      { quest: "daily.season_rating.1000 440/1000", alternative: null },
    ]);
  });

  it("drops the repeatable quests still open when timed quests take their slot", async () => {
    const rows = await inMemory(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* migrate(9);
        yield* sql.unsafe(
          `INSERT INTO quests (${FIRST_QUEST_COLUMNS}) VALUES
             ('${alice}', 'repeatable', 3, 'repeatable.raids.any.8', 'raids', NULL, 8, 200, 100, 8, 10, NULL, 40),
             ('${alice}', 'repeatable', 4, 'repeatable.raids.any.8', 'raids', NULL, 8, 200, 100, 7, 40, NULL, NULL),
             ('${alice}', 'daily', 1, 'daily.raids.any.2', 'raids', NULL, 2, 200, 100, 1, 10, NULL, NULL)`,
        );
        yield* migrate();
        const stored = yield* sql<{ quest: string; expires_at: number | null }>`
          SELECT slot || ':' || sequence AS quest, expires_at FROM quests ORDER BY slot, sequence
        `;
        // A timed quest fits the table.
        yield* sql.unsafe(
          `INSERT INTO quests (${FIRST_QUEST_COLUMNS})
           VALUES ('${alice}', 'timed', 1, 'timed.raids.any.3.or.wars.9', 'raids', NULL, 3, 500, 250, 0, 50, 60, NULL)`,
        );
        return stored;
      }),
    );

    expect(rows.map((row) => row.quest)).toEqual(["daily:1", "repeatable:3", "repeatable:4"]);
    expect(rows[0]?.expires_at).toBeNull();
    expect(rows[1]?.expires_at).toBeNull();
    expect(rows[2]?.expires_at).toBe(40);
  });

  it("refuses an entry that reverses one that does not exist", async () => {
    const refused = await rejection(
      onFile(
        join(directory, "leaf.db"),
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`
            INSERT INTO ledger_entries
              (player_id, kind, balance_delta, xp_delta, origin, idempotency_key, reverses_id, created_at)
            VALUES (${alice}, 'reversal', -5, -5, 'raid', 'undo', 999, 1)
          `;
        }),
      ),
    );

    expect(Bun.inspect(refused)).toContain("reversal_mismatch");
  });

  it("enforces foreign keys, which SQLite leaves off unless asked", async () => {
    const [setting] = await onFile(
      join(directory, "leaf.db"),
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql`PRAGMA foreign_keys`;
      }),
    );

    expect(setting).toEqual({ foreignKeys: 1 });
  });
});

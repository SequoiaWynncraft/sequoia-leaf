import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { leaf, playerId } from "@sequoia-leaf/core";

import { migrate, openDatabase } from "../src/db.ts";
import { getAccount, postEntry } from "../src/ledger/store.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const bob = playerId("00000000-0000-4000-8000-00000000000b");
const carol = playerId("00000000-0000-4000-8000-00000000000c");
const dave = playerId("00000000-0000-4000-8000-00000000000d");
/** The quest columns from before quests had a second way to finish. */
const FIRST_QUEST_COLUMNS =
  "player_id, slot, sequence, template_id, objective_type, objective_raid, target, reward_leaf, reward_xp, progress, started_at, expires_at, completed_at";
const MIGRATIONS = join(import.meta.dir, "..", "migrations");

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "leaf-db-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true });
});

describe("openDatabase", () => {
  it("creates the file and its directory, and keeps what was written when opened again", () => {
    const path = join(directory, "nested", "leaf.db");
    const first = openDatabase(path);
    postEntry(first, { kind: "earn", playerId: alice, amount: leaf(110), source: "raid", idempotencyKey: "a" }, 1);
    first.close();

    const second = openDatabase(path);

    expect(getAccount(second, alice).balance).toBe(110);
    second.close();
  });

  it("applies each migration once", () => {
    const db = openDatabase(join(directory, "leaf.db"));

    expect(migrate(db)).toEqual([]);
    const applied = db.query<{ name: string }, []>("SELECT name FROM schema_migrations ORDER BY name").all();
    expect(applied.map((row) => row.name)).toEqual([
      "0001_ledger.sql",
      "0002_activities.sql",
      "0003_quests.sql",
      "0004_events.sql",
      "0005_season_rating_quests.sql",
      "0006_achievement_sync.sql",
      "0007_war_claim.sql",
      "0008_either_or_quests.sql",
      "0009_timed_quests.sql",
      "0010_quest_rerolls.sql",
    ]);
    db.close();
  });

  it("gives the awards feed its own lease and cursor, not started yet", () => {
    const db = new Database(":memory:");
    migrate(db);
    const states = db
      .query<{ name: string; started_at: number | null; cursor: number | null }, []>(
        "SELECT name, started_at, cursor FROM sync_state ORDER BY name",
      )
      .all();
    expect(states).toEqual([
      { name: "achievements", started_at: null, cursor: null },
      { name: "credits", started_at: null, cursor: null },
    ]);
    db.close();
  });

  it("keeps the quests already handed out when the table is rebuilt for season rating", () => {
    const before = join(directory, "migrations");
    mkdirSync(before);
    for (const name of readdirSync(MIGRATIONS).filter((file) => file < "0005")) {
      copyFileSync(join(MIGRATIONS, name), join(before, name));
    }
    const db = new Database(":memory:");
    migrate(db, before);
    db.run(
      `INSERT INTO quests VALUES ('${alice}', 'daily', 1, 'daily.raids.nol.3', 'raids', 'nol', 3, 300, 150, 2, 10, NULL, NULL),
                                 ('${alice}', 'weekly', 1, 'weekly.wars.15', 'wars', NULL, 15, 800, 400, 15, 10, 20, 15)`,
    );

    expect(migrate(db)).toEqual(
      readdirSync(MIGRATIONS)
        .filter((file) => file >= "0005")
        .toSorted(),
    );

    expect(db.query(`SELECT ${FIRST_QUEST_COLUMNS} FROM quests ORDER BY slot`).all()).toEqual([
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
    db.run(
      `INSERT INTO quests (${FIRST_QUEST_COLUMNS})
       VALUES ('${alice}', 'daily', 2, 'daily.season_rating.1000', 'season_rating', NULL, 1000, 250, 125, 440, 30, NULL, NULL)`,
    );
    db.close();
  });

  it("gives quests still open a second way to finish, counting from the upgrade", () => {
    const before = join(directory, "migrations");
    mkdirSync(before);
    for (const name of readdirSync(MIGRATIONS).filter((file) => file < "0008")) {
      copyFileSync(join(MIGRATIONS, name), join(before, name));
    }
    const db = new Database(":memory:");
    migrate(db, before);
    db.run(
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

    migrate(db);

    const rows = db
      .query<{ quest: string; alternative: string | null }, []>(
        `SELECT template_id || ' ' || progress || '/' || target || (CASE WHEN completed_at IS NULL THEN '' ELSE ' done' END) AS quest,
                alternative_type || ' ' || alternative_progress || '/' || alternative_target AS alternative
         FROM quests ORDER BY player_id, slot, sequence`,
      )
      .all();
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
    db.close();
  });

  it("drops the repeatable quests still open when timed quests take their slot", () => {
    const before = join(directory, "migrations");
    mkdirSync(before);
    for (const name of readdirSync(MIGRATIONS).filter((file) => file < "0009")) {
      copyFileSync(join(MIGRATIONS, name), join(before, name));
    }
    const db = new Database(":memory:");
    migrate(db, before);
    db.run(
      `INSERT INTO quests (${FIRST_QUEST_COLUMNS}) VALUES
         ('${alice}', 'repeatable', 3, 'repeatable.raids.any.8', 'raids', NULL, 8, 200, 100, 8, 10, NULL, 40),
         ('${alice}', 'repeatable', 4, 'repeatable.raids.any.8', 'raids', NULL, 8, 200, 100, 7, 40, NULL, NULL),
         ('${alice}', 'daily', 1, 'daily.raids.any.2', 'raids', NULL, 2, 200, 100, 1, 10, NULL, NULL)`,
    );

    migrate(db);

    const rows = db
      .query<{ quest: string; expires_at: number | null }, []>(
        "SELECT slot || ':' || sequence AS quest, expires_at FROM quests ORDER BY slot, sequence",
      )
      .all();
    expect(rows.map((row) => row.quest)).toEqual(["daily:1", "repeatable:3", "repeatable:4"]);
    expect(rows[0]?.expires_at).toBeNull();
    expect(rows[1]?.expires_at).toBeNull();
    expect(rows[2]?.expires_at).toBe(40);
    db.run(
      `INSERT INTO quests (${FIRST_QUEST_COLUMNS})
       VALUES ('${alice}', 'timed', 1, 'timed.raids.any.3.or.wars.9', 'raids', NULL, 3, 500, 250, 0, 50, 60, NULL)`,
    );
    db.close();
  });

  it("refuses an entry that reverses one that does not exist", () => {
    const db = openDatabase(":memory:");
    const insert = db.query(
      `INSERT INTO ledger_entries
         (player_id, kind, balance_delta, xp_delta, origin, idempotency_key, reverses_id, created_at)
       VALUES (?, 'reversal', -5, -5, 'raid', 'undo', 999, 1)`,
    );

    expect(() => insert.run(alice)).toThrow();
  });
});

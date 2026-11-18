import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { leaf, playerId } from "@sequoia-leaf/core";

import { migrate, openDatabase } from "../src/db.ts";
import { getAccount, postEntry } from "../src/ledger/store.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
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

    expect(db.query("SELECT * FROM quests ORDER BY slot").all()).toEqual([
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
      `INSERT INTO quests VALUES ('${alice}', 'daily', 2, 'daily.season_rating.1000', 'season_rating', NULL, 1000, 250, 125, 440, 30, NULL, NULL)`,
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

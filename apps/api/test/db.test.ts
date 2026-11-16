import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { leaf, playerId } from "@sequoia-leaf/core";

import { migrate, openDatabase } from "../src/db.ts";
import { getAccount, postEntry } from "../src/ledger/store.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");

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
    expect(applied.map((row) => row.name)).toEqual(["0001_ledger.sql", "0002_activities.sql", "0003_quests.sql"]);
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

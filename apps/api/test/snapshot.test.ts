import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { leaf, playerId } from "@sequoia-leaf/core";

import {
  listSnapshots,
  SNAPSHOT_INTERVAL_MS,
  snapshotIfDue,
  SNAPSHOTS_KEPT,
  takeSnapshot,
} from "../src/backup/snapshot.ts";
import { openDatabase } from "../src/db.ts";
import { getAccount, postEntry } from "../src/ledger/store.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const T0 = Date.parse("2026-11-16T13:00:00Z");
const HOUR = 60 * 60_000;

let directory: string;
let db: Database;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "leaf-snapshot-"));
  db = openDatabase(join(directory, "leaf.db"));
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true });
});

function names(): string[] {
  return listSnapshots(join(directory, "backups")).map((snapshot) => snapshot.name);
}

describe("snapshots", () => {
  it("writes a database file that holds what the live one held at that moment", () => {
    postEntry(db, { kind: "earn", playerId: alice, amount: leaf(110), source: "raid", idempotencyKey: "a" }, T0);

    const path = takeSnapshot(db, join(directory, "backups"), T0);
    postEntry(db, { kind: "earn", playerId: alice, amount: leaf(50), source: "raid", idempotencyKey: "b" }, T0);

    expect(path).toBe(join(directory, "backups", "leaf-2026-11-16T13-00-00Z.db"));
    const copy = new Database(path, { readonly: true });
    expect(getAccount(copy, alice).balance).toBe(110);
    expect(copy.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    copy.close();
  });

  it("takes one only when the newest is six hours old", () => {
    const backups = join(directory, "backups");

    expect(snapshotIfDue(db, backups, T0)).toBeDefined();
    expect(snapshotIfDue(db, backups, T0 + SNAPSHOT_INTERVAL_MS - 1)).toBeUndefined();
    expect(snapshotIfDue(db, backups, T0 + SNAPSHOT_INTERVAL_MS)).toBeDefined();

    expect(names()).toEqual(["leaf-2026-11-16T13-00-00Z.db", "leaf-2026-11-16T19-00-00Z.db"]);
  });

  it("keeps the newest snapshots and leaves other files alone", () => {
    const backups = join(directory, "backups");
    for (let index = 0; index < SNAPSHOTS_KEPT + 2; index += 1) {
      takeSnapshot(db, backups, T0 + index * HOUR);
    }
    writeFileSync(join(backups, "notes.txt"), "not a snapshot");

    takeSnapshot(db, backups, T0 + 100 * HOUR);

    expect(names()).toHaveLength(SNAPSHOTS_KEPT);
    expect(names()[0]).toBe("leaf-2026-11-16T16-00-00Z.db");
    expect(names().at(-1)).toBe("leaf-2026-11-20T17-00-00Z.db");
    expect(Bun.file(join(backups, "notes.txt")).size).toBeGreaterThan(0);
  });
});

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { leaf, playerId } from "@sequoia-leaf/core";
import { Effect } from "effect";

import {
  listSnapshots,
  SNAPSHOT_INTERVAL_MS,
  snapshotIfDue,
  SNAPSHOTS_KEPT,
  takeSnapshot,
} from "../src/backup/snapshot.ts";
import { noNetwork, testLeaf } from "./support.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const T0 = Date.parse("2026-11-16T13:00:00Z");
const HOUR = 60 * 60_000;

let directory: string;
let server: ReturnType<typeof testLeaf>;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "leaf-snapshot-"));
  server = testLeaf({ now: T0 }, noNetwork);
});

afterEach(async () => {
  await server.dispose();
  rmSync(directory, { recursive: true });
});

function snapshotAt(backups: string, now: number) {
  return server.run(takeSnapshot(backups, now));
}

function snapshotWhenDue(backups: string, now: number) {
  return server.run(snapshotIfDue(backups, now));
}

function names(): string[] {
  return listSnapshots(join(directory, "backups")).map((snapshot) => snapshot.name);
}

describe("snapshots", () => {
  it("writes a database file that holds what the live one held at that moment", async () => {
    await server.post({ kind: "earn", playerId: alice, amount: leaf(110), source: "raid", idempotencyKey: "a" }, T0);

    const path = await snapshotAt(join(directory, "backups"), T0);
    await server.post({ kind: "earn", playerId: alice, amount: leaf(50), source: "raid", idempotencyKey: "b" }, T0);

    expect(path).toBe(join(directory, "backups", "leaf-2026-11-16T13-00-00Z.db"));
    const copy = new Database(path, { readonly: true });
    expect(copy.query("SELECT balance FROM accounts WHERE player_id = ?").get(alice)).toEqual({ balance: 110 });
    expect(copy.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    copy.close();
  });

  it("takes one only when the newest is six hours old", async () => {
    const backups = join(directory, "backups");

    expect(await snapshotWhenDue(backups, T0)).toBeDefined();
    expect(await snapshotWhenDue(backups, T0 + SNAPSHOT_INTERVAL_MS - 1)).toBeUndefined();
    expect(await snapshotWhenDue(backups, T0 + SNAPSHOT_INTERVAL_MS)).toBeDefined();

    expect(names()).toEqual(["leaf-2026-11-16T13-00-00Z.db", "leaf-2026-11-16T19-00-00Z.db"]);
  });

  it("does not count a copy that was cut short, and deletes it once it is clearly abandoned", async () => {
    const backups = join(directory, "backups");
    mkdirSync(backups);
    const abandoned = join(backups, "leaf-2026-11-16T07-00-00Z.db.one.partial");
    const inProgress = join(backups, "leaf-2026-11-16T13-00-00Z.db.two.partial");
    writeFileSync(abandoned, "half a database");
    writeFileSync(inProgress, "half a database");
    const twoHoursAgo = new Date(Date.now() - 2 * HOUR);
    utimesSync(abandoned, twoHoursAgo, twoHoursAgo);

    expect(await snapshotWhenDue(backups, T0)).toBeDefined();

    expect(readdirSync(backups).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "leaf-2026-11-16T13-00-00Z.db",
      "leaf-2026-11-16T13-00-00Z.db.two.partial",
    ]);
  });

  it("keeps the newest snapshots and leaves other files alone", async () => {
    const backups = join(directory, "backups");
    await server.run(
      Effect.forEach(
        Array.from({ length: SNAPSHOTS_KEPT + 2 }, (_, index) => T0 + index * HOUR),
        (at) => takeSnapshot(backups, at),
        { discard: true },
      ),
    );
    writeFileSync(join(backups, "notes.txt"), "not a snapshot");

    await snapshotAt(backups, T0 + 100 * HOUR);

    expect(names()).toHaveLength(SNAPSHOTS_KEPT);
    expect(names()[0]).toBe("leaf-2026-11-16T16-00-00Z.db");
    expect(names().at(-1)).toBe("leaf-2026-11-20T17-00-00Z.db");
    expect(Bun.file(join(backups, "notes.txt")).size).toBeGreaterThan(0);
  });
});

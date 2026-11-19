import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { leaf, type PlayerId, playerId } from "@sequoia-leaf/core";

import { openDatabase } from "../src/db.ts";
import { postEntry } from "../src/ledger/store.ts";
import { MAX_WINDOW_MS, SETTLE_MS, windowedSync } from "../src/sync/windowed.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const MINUTE = 60_000;
const T0 = 1_763_000_000_000;

let directory: string;
/** The server's connection, which runs the sync. */
let server: Database;
/** Another process's connection to the same file, such as a script run by hand. */
let other: Database;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "leaf-windowed-"));
  const path = join(directory, "leaf.db");
  server = openDatabase(path);
  other = openDatabase(path);
  // It gives up at once instead of waiting for the lock, so the test shows who holds it.
  other.run("PRAGMA busy_timeout = 0");
});

afterEach(() => {
  server.close();
  other.close();
  rmSync(directory, { recursive: true, force: true });
});

function raidPay(db: Database, id: number, player: PlayerId, at: number): void {
  postEntry(
    db,
    { kind: "earn", playerId: player, amount: leaf(110), source: "raid", idempotencyKey: `raid:${id}:${player}` },
    at,
  );
}

/** A write that records nothing. */
function writeNothing() {
  return { recorded: 0, leafPaid: 0 };
}

/** A feed with nothing in it. */
async function nothing(): Promise<never[]> {
  return [];
}

describe("windowedSync", () => {
  it("holds the write lock for its whole write, so another connection's commit cannot land between its reads and its writes", async () => {
    await windowedSync(server, "credits", T0, "recent", nothing, () => ({ recorded: 0, leafPaid: 0 }));
    let otherWrite: unknown;

    const result = await windowedSync(server, "credits", T0 + MINUTE, "recent", nothing, () => {
      // The credit sync reads what it has recorded before it writes.
      server.query("SELECT COUNT(*) FROM activities").get();
      try {
        raidPay(other, 1, alice, T0 + MINUTE);
      } catch (error) {
        otherWrite = error;
      }
      raidPay(server, 2, alice, T0 + MINUTE);
      return { recorded: 1, leafPaid: 110 };
    });

    expect(result).toEqual({ status: "synced", recorded: 1, leafPaid: 110 });
    expect(otherWrite).toMatchObject({ code: "SQLITE_BUSY" });
    expect(other.query("SELECT idempotency_key FROM ledger_entries").all()).toEqual([
      { idempotency_key: `raid:2:${alice}` },
    ]);
  });

  it("catches up after a gap longer than the feeds answer a window for, a window per run", async () => {
    const windows: [number, number][] = [];
    const read = async (from: number, to: number): Promise<never[]> => {
      windows.push([from, to]);
      return [];
    };
    await windowedSync(server, "credits", T0, "recent", read, writeNothing);
    const back = T0 + 45 * 24 * 60 * MINUTE;

    await windowedSync(server, "credits", back, "recent", read, writeNothing);
    await windowedSync(server, "credits", back + MINUTE, "recent", read, writeNothing);

    expect(windows.map(([from, to]) => to - from <= MAX_WINDOW_MS)).toEqual([true, true]);
    expect(windows[0]).toEqual([T0, T0 + MAX_WINDOW_MS]);
    expect(windows[1]?.[1]).toBe(back + MINUTE - SETTLE_MS);
  });
});

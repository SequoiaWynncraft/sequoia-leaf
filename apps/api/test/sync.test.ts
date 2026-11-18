import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";

import { type Activity, DEFAULT_RULES, type PlayerId, playerId } from "@sequoia-leaf/core";

import { type CreditSource, RECENT_OVERLAP_MS, SETTLE_MS, syncCredits, type SyncMode } from "../src/earning/sync.ts";
import { getAccount, listEntries } from "../src/ledger/store.ts";
import { rejection, testDatabase } from "./support.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const bob = playerId("00000000-0000-4000-8000-00000000000b");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** The first sync runs at T0, so crediting starts at T0. */
const T0 = 1_763_000_000_000;

let db: Database;

beforeEach(() => {
  db = testDatabase();
});

function raid(id: number, player: PlayerId, occurredAt: number, seasonRating = 110): Activity {
  return {
    kind: "raid",
    sourceKey: `raid:${id}:${player}`,
    playerId: player,
    occurredAt,
    seasonRating,
    raid: "tna",
    raidName: "The Nameless Anomaly",
  };
}

function war(id: number, player: PlayerId, occurredAt: number, warPoints: number, inClaim?: boolean): Activity {
  const activity: Activity = {
    kind: "war",
    sourceKey: `war:${id}:${player}`,
    playerId: player,
    occurredAt,
    seasonRating: 60,
    territory: "Detlas",
    warPoints,
  };
  return inClaim === undefined ? activity : { ...activity, inClaim };
}

/** A feed that answers a window with the activities inside it, and remembers what it was asked. */
function feed(activities: Activity[]): { source: CreditSource; windows: [number, number][] } {
  const windows: [number, number][] = [];
  const source: CreditSource = async (from, to) => {
    windows.push([from, to]);
    return activities.filter((activity) => activity.occurredAt >= from && activity.occurredAt < to);
  };
  return { source, windows };
}

const failing: CreditSource = async () => {
  throw new Error("backend is down");
};

function sync(source: CreditSource, now: number, mode: SyncMode = "recent") {
  return syncCredits(db, source, DEFAULT_RULES, now, mode);
}

function recordedKeys(): string[] {
  return db
    .query<{ source_key: string }, []>("SELECT source_key FROM activities ORDER BY occurred_at, source_key")
    .all()
    .map((row) => row.source_key);
}

describe("syncCredits", () => {
  it("credits nothing that happened before its first run", async () => {
    const { source, windows } = feed([raid(1, alice, T0 - HOUR), raid(2, alice, T0 - 1), raid(3, bob, T0)]);

    expect(await sync(source, T0)).toEqual({ status: "started" });
    await sync(source, T0 + MINUTE);

    expect(windows).toEqual([[T0, T0 + MINUTE - SETTLE_MS]]);
    expect(recordedKeys()).toEqual([`raid:3:${bob}`]);
    expect(getAccount(db, alice).balance).toBe(0);
  });

  it("records a raid and pays its season rating in Leaf and XP", async () => {
    const { source } = feed([raid(1, alice, T0 + MINUTE)]);
    await sync(source, T0);

    const result = await sync(source, T0 + 5 * MINUTE);

    expect(result).toEqual({ status: "synced", recorded: 1, leafPaid: 110 });
    expect(getAccount(db, alice)).toEqual({ playerId: alice, balance: 110, xp: 110 });
    const [entry] = listEntries(db, alice, { limit: 10 });
    expect(entry).toMatchObject({ kind: "earn", origin: "raid", idempotencyKey: `raid:1:${alice}` });
    const row = db.query("SELECT kind, raid, detail, season_rating, occurred_at FROM activities").get();
    expect(row).toEqual({
      kind: "raid",
      raid: "tna",
      detail: "The Nameless Anomaly",
      season_rating: 110,
      occurred_at: T0 + MINUTE,
    });
  });

  it("pays a war its points rounded down", async () => {
    const { source } = feed([war(7, alice, T0 + MINUTE, 31.9)]);
    await sync(source, T0);

    await sync(source, T0 + 5 * MINUTE);

    expect(getAccount(db, alice)).toEqual({ playerId: alice, balance: 31, xp: 31 });
    const [entry] = listEntries(db, alice, { limit: 10 });
    expect(entry).toMatchObject({ origin: "war", idempotencyKey: `war:7:${alice}` });
  });

  it("pays a defence of Sequoia's claim twice per point, and says so in its event", async () => {
    const { source } = feed([war(7, alice, T0 + MINUTE, 73.4, true), war(8, bob, T0 + MINUTE, 73.4, false)]);
    await sync(source, T0);

    await sync(source, T0 + 5 * MINUTE);

    expect(getAccount(db, alice).balance).toBe(146);
    expect(getAccount(db, bob).balance).toBe(73);
    const rows = db
      .query<{ in_claim: number | null }, []>("SELECT in_claim FROM activities ORDER BY source_key")
      .all()
      .map((row) => row.in_claim);
    expect(rows).toEqual([1, 0]);
    const events: unknown[] = db
      .query<{ data: string }, []>("SELECT data FROM events WHERE type = 'leaf_earned' ORDER BY id")
      .all()
      .map((row): unknown => JSON.parse(row.data));
    expect(events).toEqual([
      expect.objectContaining({ leaf: 146, in_claim: true }),
      expect.objectContaining({ leaf: 73, in_claim: false }),
    ]);
  });

  it("records nothing about the claim for a war the backend could not place", async () => {
    const { source } = feed([war(7, alice, T0 + MINUTE, 40)]);
    await sync(source, T0);

    await sync(source, T0 + 5 * MINUTE);

    expect(getAccount(db, alice).balance).toBe(40);
    expect(db.query("SELECT in_claim FROM activities").get()).toEqual({ in_claim: null });
    const event = db.query<{ data: string }, []>("SELECT data FROM events WHERE type = 'leaf_earned'").get();
    const data: unknown = JSON.parse(event?.data ?? "{}");
    expect(data).not.toHaveProperty("in_claim");
  });

  it("records a war scored at zero without paying for it", async () => {
    const { source } = feed([war(7, alice, T0 + MINUTE, 0)]);
    await sync(source, T0);

    const result = await sync(source, T0 + 5 * MINUTE);

    expect(result).toEqual({ status: "synced", recorded: 1, leafPaid: 0 });
    expect(recordedKeys()).toEqual([`war:7:${alice}`]);
    expect(listEntries(db, alice, { limit: 10 })).toEqual([]);
  });

  it("pays each credit once when a later run reads the same events again", async () => {
    const { source } = feed([raid(1, alice, T0 + MINUTE), raid(1, bob, T0 + MINUTE)]);
    await sync(source, T0);
    await sync(source, T0 + 5 * MINUTE);

    const again = await sync(source, T0 + 6 * MINUTE);

    expect(again).toEqual({ status: "synced", recorded: 0, leafPaid: 0 });
    expect(getAccount(db, alice).balance).toBe(110);
    expect(getAccount(db, bob).balance).toBe(110);
  });

  it("leaves events younger than the settle delay for the next run", async () => {
    const now = T0 + 5 * MINUTE;
    const { source } = feed([raid(1, alice, now - SETTLE_MS + 1)]);
    await sync(source, T0);

    await sync(source, now);
    expect(recordedKeys()).toEqual([]);

    await sync(source, now + MINUTE);
    expect(recordedKeys()).toEqual([`raid:1:${alice}`]);
  });

  it("starts a recent run a little before where the last one stopped", async () => {
    const { source, windows } = feed([]);
    await sync(source, T0);
    await sync(source, T0 + HOUR);

    await sync(source, T0 + HOUR + MINUTE);

    expect(windows[1]).toEqual([T0 + HOUR - SETTLE_MS - RECENT_OVERLAP_MS, T0 + HOUR + MINUTE - SETTLE_MS]);
  });

  it("picks up a credit that appears late on the deep run, but not on a recent one", async () => {
    const activities: Activity[] = [];
    const { source } = feed(activities);
    await sync(source, T0);
    await sync(source, T0 + 3 * HOUR);
    // Bob's name resolved to his account two hours after the raid.
    activities.push(raid(1, bob, T0 + HOUR));

    await sync(source, T0 + 3 * HOUR + MINUTE);
    expect(getAccount(db, bob).balance).toBe(0);

    await sync(source, T0 + 3 * HOUR + 2 * MINUTE, "deep");
    expect(getAccount(db, bob).balance).toBe(110);
  });

  it("does nothing while another run holds the lease", async () => {
    const { source } = feed([]);
    await sync(source, T0);
    db.query("UPDATE sync_state SET locked_until = ? WHERE name = 'credits'").run(T0 + 2 * MINUTE);

    expect(await sync(source, T0 + MINUTE)).toEqual({ status: "busy" });
    expect(await sync(source, T0 + 2 * MINUTE)).toMatchObject({ status: "synced" });
  });

  it("releases the lease and pays nothing when the feed fails", async () => {
    const { source } = feed([raid(1, alice, T0 + MINUTE)]);
    await sync(source, T0);
    expect(await rejection(sync(failing, T0 + 5 * MINUTE))).toEqual(new Error("backend is down"));

    expect(await sync(source, T0 + 5 * MINUTE)).toMatchObject({ status: "synced", recorded: 1 });
  });
});

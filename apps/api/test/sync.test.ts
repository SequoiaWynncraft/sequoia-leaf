import { type Activity, DEFAULT_RULES, type PlayerId, playerId } from "@sequoia-leaf/core";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { type CreditSource, RECENT_OVERLAP_MS, SETTLE_MS, syncCredits, type SyncMode } from "../src/earning/sync.ts";
import { getAccount, listEntries } from "../src/ledger/store.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const bob = playerId("00000000-0000-4000-8000-00000000000b");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** The first sync runs at T0, so crediting starts at T0 - SETTLE_MS. */
const T0 = 1_763_000_000_000;

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

function war(id: number, player: PlayerId, occurredAt: number, warPoints: number): Activity {
  return {
    kind: "war",
    sourceKey: `war:${id}:${player}`,
    playerId: player,
    occurredAt,
    seasonRating: 60,
    territory: "Detlas",
    warPoints,
  };
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

function sync(source: CreditSource, now: number, mode: SyncMode = "recent", maxPlayers?: number) {
  return syncCredits(
    env.DB,
    source,
    DEFAULT_RULES.earning,
    now,
    maxPlayers === undefined ? { mode } : { mode, maxPlayers },
  );
}

async function recordedKeys(): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT source_key FROM activities ORDER BY occurred_at, source_key").all<{
    source_key: string;
  }>();
  return results.map((row) => row.source_key);
}

describe("syncCredits", () => {
  it("credits nothing that happened before its first run", async () => {
    const { source, windows } = feed([raid(1, alice, T0 - HOUR)]);

    expect(await sync(source, T0)).toEqual({ status: "started" });
    await sync(source, T0 + MINUTE);

    expect(windows).toEqual([[T0 - SETTLE_MS, T0 + MINUTE - SETTLE_MS]]);
    expect(await recordedKeys()).toEqual([]);
    expect((await getAccount(env.DB, alice)).balance).toBe(0);
  });

  it("records a raid and pays its season rating in Leaf and XP", async () => {
    const { source } = feed([raid(1, alice, T0 + MINUTE)]);
    await sync(source, T0);

    const result = await sync(source, T0 + 5 * MINUTE);

    expect(result).toEqual({ status: "synced", recorded: 1, leafPaid: 110, complete: true });
    expect(await getAccount(env.DB, alice)).toEqual({ playerId: alice, balance: 110, xp: 110 });
    const [entry] = await listEntries(env.DB, alice, { limit: 10 });
    expect(entry).toMatchObject({ kind: "earn", origin: "raid", idempotencyKey: `raid:1:${alice}` });
    const row = await env.DB.prepare("SELECT kind, raid, detail, season_rating, occurred_at FROM activities").first();
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

    expect(await getAccount(env.DB, alice)).toEqual({ playerId: alice, balance: 31, xp: 31 });
    const [entry] = await listEntries(env.DB, alice, { limit: 10 });
    expect(entry).toMatchObject({ origin: "war", idempotencyKey: `war:7:${alice}` });
  });

  it("records a war scored at zero without paying for it", async () => {
    const { source } = feed([war(7, alice, T0 + MINUTE, 0)]);
    await sync(source, T0);

    const result = await sync(source, T0 + 5 * MINUTE);

    expect(result).toEqual({ status: "synced", recorded: 1, leafPaid: 0, complete: true });
    expect(await recordedKeys()).toEqual([`war:7:${alice}`]);
    expect(await listEntries(env.DB, alice, { limit: 10 })).toEqual([]);
  });

  it("pays each credit once when a later run reads the same events again", async () => {
    const { source } = feed([raid(1, alice, T0 + MINUTE), raid(1, bob, T0 + MINUTE)]);
    await sync(source, T0);
    await sync(source, T0 + 5 * MINUTE);

    const again = await sync(source, T0 + 6 * MINUTE);

    expect(again).toEqual({ status: "synced", recorded: 0, leafPaid: 0, complete: true });
    expect((await getAccount(env.DB, alice)).balance).toBe(110);
    expect((await getAccount(env.DB, bob)).balance).toBe(110);
  });

  it("leaves events younger than the settle delay for the next run", async () => {
    const now = T0 + 5 * MINUTE;
    const { source } = feed([raid(1, alice, now - SETTLE_MS + 1)]);
    await sync(source, T0);

    await sync(source, now);
    expect(await recordedKeys()).toEqual([]);

    await sync(source, now + MINUTE);
    expect(await recordedKeys()).toEqual([`raid:1:${alice}`]);
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
    expect((await getAccount(env.DB, bob)).balance).toBe(0);

    await sync(source, T0 + 3 * HOUR + 2 * MINUTE, "deep");
    expect((await getAccount(env.DB, bob)).balance).toBe(110);
  });

  it("stops at the player limit and finishes on the next run", async () => {
    const { source } = feed([raid(1, alice, T0 + MINUTE), raid(2, bob, T0 + 2 * MINUTE)]);
    await sync(source, T0);

    const first = await sync(source, T0 + 5 * MINUTE, "recent", 1);
    expect(first).toEqual({ status: "synced", recorded: 1, leafPaid: 110, complete: false });
    expect(await recordedKeys()).toEqual([`raid:1:${alice}`]);

    const second = await sync(source, T0 + 6 * MINUTE, "recent", 1);
    expect(second).toEqual({ status: "synced", recorded: 1, leafPaid: 110, complete: true });
    expect(await recordedKeys()).toEqual([`raid:1:${alice}`, `raid:2:${bob}`]);
  });

  it("does nothing while another run holds the lease", async () => {
    const { source } = feed([]);
    await sync(source, T0);
    await env.DB.prepare("UPDATE sync_state SET locked_until = ? WHERE name = 'credits'")
      .bind(T0 + 2 * MINUTE)
      .run();

    expect(await sync(source, T0 + MINUTE)).toEqual({ status: "busy" });
    expect(await sync(source, T0 + 2 * MINUTE)).toMatchObject({ status: "synced" });
  });

  it("releases the lease and pays nothing when the feed fails", async () => {
    const { source } = feed([raid(1, alice, T0 + MINUTE)]);
    await sync(source, T0);
    await expect(sync(failing, T0 + 5 * MINUTE)).rejects.toThrow("backend is down");

    expect(await sync(source, T0 + 5 * MINUTE)).toMatchObject({ status: "synced", recorded: 1 });
  });
});

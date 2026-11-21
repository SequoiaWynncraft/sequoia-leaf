import { beforeEach, describe, expect, it } from "bun:test";

import { type Activity, DEFAULT_RULES, type PlayerId, playerId } from "@sequoia-leaf/core";
import { Effect } from "effect";

import { type CreditSource, RECENT_OVERLAP_MS, SETTLE_MS, syncCredits, type SyncMode } from "../src/earning/sync.ts";
import { HOUR, MINUTE, noNetwork, raid, rejection, testLeaf } from "./support.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const bob = playerId("00000000-0000-4000-8000-00000000000b");
/** The first sync runs at T0, so crediting starts at T0. */
const T0 = 1_763_000_000_000;

let leaf: ReturnType<typeof testLeaf>;

beforeEach(() => {
  leaf = testLeaf({ now: T0 }, noNetwork);
});

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
  const source: CreditSource = (from, to) =>
    Effect.sync(() => {
      windows.push([from, to]);
      return activities.filter((activity) => activity.occurredAt >= from && activity.occurredAt < to);
    });
  return { source, windows };
}

const failing: CreditSource<Error> = () => Effect.fail(new Error("backend is down"));

function sync(source: CreditSource<Error>, now: number, mode: SyncMode = "recent") {
  return leaf.run(syncCredits(source, DEFAULT_RULES, now, mode));
}

async function recordedKeys(): Promise<string[]> {
  const rows = await leaf.query<{ source_key: string }>(
    (sql) => sql`SELECT source_key FROM activities ORDER BY occurred_at, source_key`,
  );
  return rows.map((row) => row.source_key);
}

/** A player's ledger entries, newest first. */
function entries(player: PlayerId) {
  return leaf.query((sql) => sql`SELECT * FROM ledger_entries WHERE player_id = ${player} ORDER BY id DESC`);
}

describe("syncCredits", () => {
  it("credits nothing that happened before its first run", async () => {
    const { source, windows } = feed([raid(1, alice, T0 - HOUR), raid(2, alice, T0 - 1), raid(3, bob, T0)]);

    expect(await sync(source, T0)).toEqual({ status: "started" });
    await sync(source, T0 + MINUTE);

    expect(windows).toEqual([[T0, T0 + MINUTE - SETTLE_MS]]);
    expect(await recordedKeys()).toEqual([`raid:3:${bob}`]);
    expect((await leaf.account(alice)).balance).toBe(0);
  });

  it("records a raid and pays its flat Leaf and XP", async () => {
    const { source } = feed([raid(1, alice, T0 + MINUTE)]);
    await sync(source, T0);

    const result = await sync(source, T0 + 5 * MINUTE);

    expect(result).toEqual({ status: "synced", recorded: 1, leafPaid: 100 });
    expect(await leaf.account(alice)).toEqual({ playerId: alice, balance: 100, xp: 100 });
    const [entry] = await entries(alice);
    expect(entry).toMatchObject({ kind: "earn", origin: "raid", idempotency_key: `raid:1:${alice}` });
    const rows = await leaf.query((sql) => sql`SELECT kind, raid, detail, season_rating, occurred_at FROM activities`);
    expect(rows).toEqual([
      { kind: "raid", raid: "tna", detail: "The Nameless Anomaly", season_rating: 110, occurred_at: T0 + MINUTE },
    ]);
  });

  it("pays a war its points rounded down", async () => {
    const { source } = feed([war(7, alice, T0 + MINUTE, 31.9)]);
    await sync(source, T0);

    await sync(source, T0 + 5 * MINUTE);

    expect(await leaf.account(alice)).toEqual({ playerId: alice, balance: 15, xp: 15 });
    const [entry] = await entries(alice);
    expect(entry).toMatchObject({ origin: "war", idempotency_key: `war:7:${alice}` });
  });

  it("pays a defence of Sequoia's claim twice per point, and says so in its event", async () => {
    const { source } = feed([war(7, alice, T0 + MINUTE, 73.4, true), war(8, bob, T0 + MINUTE, 73.4, false)]);
    await sync(source, T0);

    await sync(source, T0 + 5 * MINUTE);

    expect((await leaf.account(alice)).balance).toBe(73);
    expect((await leaf.account(bob)).balance).toBe(36);
    expect(await leaf.query((sql) => sql`SELECT in_claim FROM activities ORDER BY source_key`)).toEqual([
      { in_claim: 1 },
      { in_claim: 0 },
    ]);
    const events = (
      await leaf.query<{ data: string }>((sql) => sql`SELECT data FROM events WHERE type = 'leaf_earned' ORDER BY id`)
    ).map((row): unknown => JSON.parse(row.data));
    expect(events).toEqual([
      expect.objectContaining({ leaf: 73, in_claim: true }),
      expect.objectContaining({ leaf: 36, in_claim: false }),
    ]);
  });

  it("records nothing about the claim for a war the backend could not place", async () => {
    const { source } = feed([war(7, alice, T0 + MINUTE, 40)]);
    await sync(source, T0);

    await sync(source, T0 + 5 * MINUTE);

    expect((await leaf.account(alice)).balance).toBe(20);
    expect(await leaf.query((sql) => sql`SELECT in_claim FROM activities`)).toEqual([{ in_claim: null }]);
    const [event] = await leaf.query<{ data: string }>(
      (sql) => sql`SELECT data FROM events WHERE type = 'leaf_earned'`,
    );
    const data: unknown = JSON.parse(event?.data ?? "{}");
    expect(data).not.toHaveProperty("in_claim");
  });

  it("records a war scored at zero without paying for it", async () => {
    const { source } = feed([war(7, alice, T0 + MINUTE, 0)]);
    await sync(source, T0);

    const result = await sync(source, T0 + 5 * MINUTE);

    expect(result).toEqual({ status: "synced", recorded: 1, leafPaid: 0 });
    expect(await recordedKeys()).toEqual([`war:7:${alice}`]);
    expect(await entries(alice)).toEqual([]);
  });

  it("pays each credit once when a later run reads the same events again", async () => {
    const { source } = feed([raid(1, alice, T0 + MINUTE), raid(1, bob, T0 + MINUTE)]);
    await sync(source, T0);
    await sync(source, T0 + 5 * MINUTE);

    const again = await sync(source, T0 + 6 * MINUTE);

    expect(again).toEqual({ status: "synced", recorded: 0, leafPaid: 0 });
    expect((await leaf.account(alice)).balance).toBe(100);
    expect((await leaf.account(bob)).balance).toBe(100);
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
    expect((await leaf.account(bob)).balance).toBe(0);

    await sync(source, T0 + 3 * HOUR + 2 * MINUTE, "deep");
    expect((await leaf.account(bob)).balance).toBe(100);
  });

  it("does nothing while another run holds the lease", async () => {
    const { source } = feed([]);
    await sync(source, T0);
    await leaf.query((sql) => sql`UPDATE sync_state SET locked_until = ${T0 + 2 * MINUTE} WHERE name = 'credits'`);

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

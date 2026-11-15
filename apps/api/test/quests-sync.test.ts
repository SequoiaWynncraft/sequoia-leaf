import { type Activity, DEFAULT_RULES, type PlayerId, playerId, type Rules } from "@sequoia-leaf/core";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { type CreditSource, syncCredits } from "../src/earning/sync.ts";
import { getAccount, listEntries } from "../src/ledger/store.ts";
import { loadQuestBook } from "../src/quests/store.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const MINUTE = 60_000;
/** Wednesday 4 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 4, 12);

/** One template per slot, so every test knows which quests it gets. */
const rules: Rules = {
  ...DEFAULT_RULES,
  quests: {
    dailyChargeCap: 3,
    templates: [
      { id: "daily", slot: "daily", objective: { type: "raids", count: 2 }, reward: { leaf: 200, xp: 100 } },
      { id: "weekly", slot: "weekly", objective: { type: "raids", count: 3 }, reward: { leaf: 800, xp: 400 } },
      { id: "repeatable", slot: "repeatable", objective: { type: "raids", count: 2 }, reward: { leaf: 50, xp: 25 } },
    ],
  },
};

function raid(id: number, player: PlayerId, occurredAt: number): Activity {
  return {
    kind: "raid",
    sourceKey: `raid:${id}:${player}`,
    playerId: player,
    occurredAt,
    seasonRating: 110,
    raid: "tna",
    raidName: "The Nameless Anomaly",
  };
}

function feed(activities: Activity[]): CreditSource {
  return async (from, to) => activities.filter((activity) => activity.occurredAt >= from && activity.occurredAt < to);
}

function sync(source: CreditSource, now: number) {
  return syncCredits(env.DB, source, rules, now, { mode: "recent" });
}

async function questRows() {
  const { results } = await env.DB.prepare(
    "SELECT slot, sequence, progress, completed_at FROM quests ORDER BY slot, sequence",
  ).all<{ slot: string; sequence: number; progress: number; completed_at: number | null }>();
  return results.map((row) => `${row.slot}:${row.sequence} ${row.progress}${row.completed_at === null ? "" : " done"}`);
}

describe("quests in the credit sync", () => {
  it("hands out quests on a player's first activity and counts it toward them", async () => {
    const source = feed([raid(1, alice, T0 + MINUTE)]);
    await sync(source, T0);

    await sync(source, T0 + 5 * MINUTE);

    expect(await questRows()).toEqual(["daily:1 1", "repeatable:1 1", "weekly:1 1"]);
    expect(await getAccount(env.DB, alice)).toEqual({ playerId: alice, balance: 110, xp: 110 });
  });

  it("pays a finished quest's Leaf and XP with the raid that finished it", async () => {
    const source = feed([raid(1, alice, T0 + MINUTE), raid(2, alice, T0 + 2 * MINUTE)]);
    await sync(source, T0);

    const result = await sync(source, T0 + 5 * MINUTE);

    // Two raids at 110, the daily at 200 and the repeatable at 50.
    expect(result).toEqual({ status: "synced", recorded: 2, leafPaid: 470, complete: true });
    expect(await getAccount(env.DB, alice)).toEqual({ playerId: alice, balance: 470, xp: 345 });
    expect(await questRows()).toEqual(["daily:1 2 done", "repeatable:1 2 done", "repeatable:2 0", "weekly:1 2"]);
    const quests = (await listEntries(env.DB, alice, { limit: 10 })).filter((entry) => entry.origin === "quest");
    const paid = quests.toSorted((a, b) => a.idempotencyKey.localeCompare(b.idempotencyKey));
    expect(paid.map((entry) => [entry.idempotencyKey, entry.balanceDelta, entry.xpDelta])).toEqual([
      [`quest:${alice}:daily:1`, 200, 100],
      [`quest:${alice}:repeatable:1`, 50, 25],
    ]);
  });

  it("keeps progress between runs", async () => {
    const activities = [raid(1, alice, T0 + MINUTE)];
    const source = feed(activities);
    await sync(source, T0);
    await sync(source, T0 + 5 * MINUTE);
    activities.push(raid(2, alice, T0 + 6 * MINUTE), raid(3, alice, T0 + 7 * MINUTE));

    await sync(source, T0 + 10 * MINUTE);

    expect(await questRows()).toEqual(["daily:1 2 done", "repeatable:1 2 done", "repeatable:2 1", "weekly:1 3 done"]);
    // Three raids at 110, the daily at 200, the repeatable at 50 and the weekly at 800.
    expect((await getAccount(env.DB, alice)).balance).toBe(1380);
    expect((await loadQuestBook(env.DB, alice))?.dailyCharges).toBe(0);
  });

  it("pays a quest once when the same events are read again", async () => {
    const source = feed([raid(1, alice, T0 + MINUTE), raid(2, alice, T0 + 2 * MINUTE)]);
    await sync(source, T0);
    await sync(source, T0 + 5 * MINUTE);

    const again = await sync(source, T0 + 6 * MINUTE);

    expect(again).toEqual({ status: "synced", recorded: 0, leafPaid: 0, complete: true });
    expect((await getAccount(env.DB, alice)).balance).toBe(470);
  });
});

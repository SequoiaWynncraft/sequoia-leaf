import { beforeEach, describe, expect, it } from "bun:test";

import {
  DEFAULT_RULES,
  minecraftId,
  type PlayerId,
  playerId,
  refreshQuests,
  type ReportedActivity,
  type Rules,
} from "@sequoia-leaf/core";

import { type CreditSource, syncCredits } from "../src/earning/sync.ts";
import { Ledger } from "../src/ledger/store.ts";
import { questJson } from "../src/quests/json.ts";
import { Quests } from "../src/quests/store.ts";
import { feed, MINUTE, noNetwork, raid, testLeaf } from "./support.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
/** Wednesday 4 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 4, 12);

let leaf: ReturnType<typeof testLeaf>;

beforeEach(() => {
  leaf = testLeaf({ now: T0 }, noNetwork);
});

/** One template per slot, so every test knows which quests it gets. */
const rules: Rules = {
  ...DEFAULT_RULES,
  quests: {
    dailyChargeCap: 3,
    templates: [
      { id: "daily", slot: "daily", objectives: [{ type: "raids", count: 2 }], reward: { leaf: 200, xp: 100 } },
      { id: "weekly", slot: "weekly", objectives: [{ type: "raids", count: 3 }], reward: { leaf: 800, xp: 400 } },
      { id: "repeatable", slot: "repeatable", objectives: [{ type: "raids", count: 2 }], reward: { leaf: 50, xp: 25 } },
    ],
  },
};

function war(id: number, player: PlayerId, occurredAt: number): ReportedActivity {
  return {
    kind: "war",
    sourceKey: `war:${id}:${player}`,
    account: minecraftId(player),
    occurredAt,
    seasonRating: 60,
    territory: "Detlas",
    warPoints: 40,
  };
}

function sync(source: CreditSource, now: number) {
  return leaf.run(syncCredits(source, rules, now, "recent"));
}

async function questRows(): Promise<string[]> {
  const rows = await leaf.query<{ slot: string; sequence: number; progress: number; completed_at: number | null }>(
    (sql) => sql`SELECT slot, sequence, progress, completed_at FROM quests ORDER BY slot, sequence`,
  );
  return rows.map((row) => `${row.slot}:${row.sequence} ${row.progress}${row.completed_at === null ? "" : " done"}`);
}

function book(player: PlayerId) {
  return leaf.run(Quests.use((quests) => quests.book(player)));
}

function completedSince(player: PlayerId, since: number) {
  return leaf.run(Quests.use((quests) => quests.completedSince(player, since)));
}

describe("quests in the credit sync", () => {
  it("hands out quests on a player's first activity and counts it toward them", async () => {
    const source = feed([raid(1, alice, T0 + MINUTE)]);
    await sync(source, T0);

    await sync(source, T0 + 5 * MINUTE);

    expect(await questRows()).toEqual(["daily:1 1", "repeatable:1 1", "weekly:1 1"]);
    expect(await leaf.account(alice)).toEqual({ playerId: alice, balance: 110, xp: 110 });
  });

  it("pays a finished quest's Leaf and XP with the raid that finished it", async () => {
    const source = feed([raid(1, alice, T0 + MINUTE), raid(2, alice, T0 + 2 * MINUTE)]);
    await sync(source, T0);

    const result = await sync(source, T0 + 5 * MINUTE);

    // Two raids at 110, the daily at 200 and the repeatable at 50.
    expect(result).toEqual({ status: "synced", recorded: 2, leafPaid: 470 });
    expect(await leaf.account(alice)).toEqual({ playerId: alice, balance: 470, xp: 345 });
    expect(await questRows()).toEqual(["daily:1 2 done", "repeatable:1 2 done", "repeatable:2 0", "weekly:1 2"]);
    const quests = await leaf.run(Ledger.use((ledger) => ledger.earns(alice, "quest")));
    const paid = quests.map(({ entry }) => entry).toSorted((a, b) => a.idempotencyKey.localeCompare(b.idempotencyKey));
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
    expect((await leaf.account(alice)).balance).toBe(1380);
    expect((await book(alice))?.dailyCharges).toBe(0);
  });

  it("stores a repeatable left open as retired once the rules hand none out", async () => {
    const activities = [raid(1, alice, T0 + MINUTE)];
    const source = feed(activities);
    await sync(source, T0);
    await sync(source, T0 + 5 * MINUTE);
    const off = {
      ...rules,
      quests: { ...rules.quests, templates: rules.quests.templates.filter((t) => t.slot !== "repeatable") },
    };
    activities.push(raid(2, alice, T0 + 6 * MINUTE));

    await leaf.run(syncCredits(source, off, T0 + 10 * MINUTE, "recent"));

    const stored = await leaf.query(
      (sql) => sql`SELECT progress, started_at, expires_at FROM quests WHERE slot = 'repeatable'`,
    );
    expect(stored).toEqual([{ progress: 1, started_at: T0 + MINUTE, expires_at: T0 + MINUTE }]);
    const storedBook = await book(alice);
    expect(storedBook && refreshQuests(storedBook, alice, T0 + 11 * MINUTE, off.quests).written).toEqual([]);
  });

  it("pays a quest once when the same events are read again", async () => {
    const source = feed([raid(1, alice, T0 + MINUTE), raid(2, alice, T0 + 2 * MINUTE)]);
    await sync(source, T0);
    await sync(source, T0 + 5 * MINUTE);

    const again = await sync(source, T0 + 6 * MINUTE);

    expect(again).toEqual({ status: "synced", recorded: 0, leafPaid: 0 });
    expect((await leaf.account(alice)).balance).toBe(470);
  });
});

describe("a quest that raids or wars can finish", () => {
  const eitherRules: Rules = {
    ...DEFAULT_RULES,
    quests: {
      dailyChargeCap: 3,
      templates: [
        {
          id: "either",
          slot: "daily",
          objectives: [
            { type: "raids", raid: "tna", count: 3 },
            { type: "wars", count: 3 },
          ],
          reward: { leaf: 300, xp: 150 },
        },
      ],
    },
  };

  it("keeps each goal's progress between runs and pays when the wars finish it", async () => {
    const activities = [raid(1, alice, T0 + MINUTE), war(2, alice, T0 + 2 * MINUTE)];
    const source = feed(activities);
    await leaf.run(syncCredits(source, eitherRules, T0, "recent"));
    await leaf.run(syncCredits(source, eitherRules, T0 + 5 * MINUTE, "recent"));

    expect((await book(alice))?.latest.daily?.goals.map((goal) => goal.progress)).toEqual([1, 1]);

    activities.push(war(3, alice, T0 + 6 * MINUTE), war(4, alice, T0 + 7 * MINUTE));
    await leaf.run(syncCredits(source, eitherRules, T0 + 10 * MINUTE, "recent"));

    // One raid at 110, three wars of 40 war points at 20 and the quest at 300.
    expect((await leaf.account(alice)).balance).toBe(470);
    const [finished] = await completedSince(alice, T0);
    expect(finished === undefined ? undefined : questJson(finished)).toMatchObject({
      id: "daily:1",
      title: "Complete 3 TNA raids or 3 wars",
      objective: { type: "wars", raid: null },
      progress: 3,
      target: 3,
      goals: [
        { type: "raids", raid: "tna", progress: 1, target: 3 },
        { type: "wars", raid: null, progress: 3, target: 3 },
      ],
    });
  });
});

describe("a season rating quest in the credit sync", () => {
  const ratingRules: Rules = {
    ...DEFAULT_RULES,
    quests: {
      dailyChargeCap: 3,
      templates: [
        {
          id: "rating",
          slot: "daily",
          objectives: [{ type: "season_rating", amount: 500 }],
          reward: { leaf: 250, xp: 125 },
        },
      ],
    },
  };

  it("keeps the season rating earned so far between runs and pays when it reaches the amount", async () => {
    const activities = [raid(1, alice, T0 + MINUTE, 440)];
    const source = feed(activities);
    await leaf.run(syncCredits(source, ratingRules, T0, "recent"));

    await leaf.run(syncCredits(source, ratingRules, T0 + 5 * MINUTE, "recent"));

    expect((await book(alice))?.latest.daily).toMatchObject({
      goals: [{ objective: { type: "season_rating", amount: 500 }, progress: 440 }],
      completedAt: null,
    });

    activities.push(raid(2, alice, T0 + 6 * MINUTE, 220));
    await leaf.run(syncCredits(source, ratingRules, T0 + 10 * MINUTE, "recent"));

    // Two raids at 440 and 220, and the quest at 250.
    expect((await leaf.account(alice)).balance).toBe(910);
    const [finished] = await completedSince(alice, T0);
    expect(finished === undefined ? undefined : questJson(finished)).toMatchObject({
      id: "daily:1",
      title: "Earn 500 season rating",
      objective: { type: "season_rating", raid: null },
      progress: 500,
      target: 500,
      reward: { leaf: 250, xp: 125 },
    });
  });
});

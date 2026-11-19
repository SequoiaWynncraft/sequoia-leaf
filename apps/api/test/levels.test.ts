import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";

import {
  type Activity,
  DEFAULT_RULES,
  leaf,
  type LedgerEntry,
  type PlayerId,
  playerId,
  type Rules,
} from "@sequoia-leaf/core";

import { type CreditSource, syncCredits } from "../src/earning/sync.ts";
import { listEventsAfter } from "../src/events/store.ts";
import { getAccount, listEntries, postEntry } from "../src/ledger/store.ts";
import { payLevels, payMissedLevels } from "../src/levels/pay.ts";
import { testDatabase } from "./support.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const bob = playerId("00000000-0000-4000-8000-00000000000b");
const MINUTE = 60_000;
/** Wednesday 4 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 4, 12);

/** No quests, so only raids and levels pay. Level 2 takes 1,000 XP and pays 100 Leaf, level 3 1,250 more and 125. */
const rules: Rules = { ...DEFAULT_RULES, quests: { ...DEFAULT_RULES.quests, templates: [] } };

let db: Database;

beforeEach(() => {
  db = testDatabase();
});

function raid(id: number, player: PlayerId, occurredAt: number, seasonRating: number): Activity {
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

function feed(activities: Activity[]): CreditSource {
  return async (from, to) => activities.filter((activity) => activity.occurredAt >= from && activity.occurredAt < to);
}

function levelEntries(player: PlayerId): [string, number, number][] {
  return listEntries(db, player, { limit: 50 })
    .filter((entry) => entry.origin === "level")
    .map((entry) => [entry.idempotencyKey, entry.balanceDelta, entry.xpDelta]);
}

function events(player: PlayerId): { type: string; data: unknown }[] {
  return listEventsAfter(db, player, 0, 50).map((event) => ({ type: event.type, data: JSON.parse(event.data) }));
}

/** Gives a player XP the way a raid paid before levels paid Leaf: an earn entry with no level pay. */
function earnedBefore(player: PlayerId, amount: number, key: string): LedgerEntry {
  const result = postEntry(
    db,
    { kind: "earn", playerId: player, amount: leaf(amount), source: "raid", idempotencyKey: key },
    T0,
  );
  if (result.status !== "posted") {
    throw new Error(`Expected ${key} to post, got ${result.status}`);
  }
  return result.entry;
}

/** Takes an entry back in full, as a correction does. */
function reverse(entry: LedgerEntry): void {
  postEntry(
    db,
    { kind: "reversal", playerId: entry.playerId, reverses: entry, idempotencyKey: `undo:${entry.idempotencyKey}` },
    T0,
  );
}

/** The entry that paid for a level. */
function levelPayout(player: PlayerId, key: string): LedgerEntry {
  const entry = listEntries(db, player, { limit: 50 }).find((candidate) => candidate.idempotencyKey === key);
  if (entry === undefined) {
    throw new Error(`No entry ${key}`);
  }
  return entry;
}

describe("Leaf for levels", () => {
  it("pays a level in the sync that reaches it, says so, and pays it once", async () => {
    const source = feed([raid(1, alice, T0 + MINUTE, 600), raid(2, alice, T0 + 2 * MINUTE, 500)]);
    await syncCredits(db, source, rules, T0, "recent");

    const result = await syncCredits(db, source, rules, T0 + 5 * MINUTE, "recent");
    await syncCredits(db, source, rules, T0 + 6 * MINUTE, "deep");

    expect(result).toEqual({ status: "synced", recorded: 2, leafPaid: 1100 + 100 });
    expect(getAccount(db, alice)).toMatchObject({ balance: 1200, xp: 1100 });
    expect(levelEntries(alice)).toEqual([[`level:${alice}:2`, 100, 0]]);
    expect(events(alice).at(-1)).toEqual({ type: "level_up", data: { level: 2, leaf: 100 } });
  });

  it("pays every level a single sync passes, with one event for the level reached", async () => {
    const source = feed([raid(1, alice, T0 + MINUTE, 2300)]);
    await syncCredits(db, source, rules, T0, "recent");

    await syncCredits(db, source, rules, T0 + 5 * MINUTE, "recent");

    expect(levelEntries(alice)).toEqual([
      [`level:${alice}:3`, 125, 0],
      [`level:${alice}:2`, 100, 0],
    ]);
    expect(events(alice).filter((event) => event.type === "level_up")).toEqual([
      { type: "level_up", data: { level: 3, leaf: 225 } },
    ]);
  });

  it("pays each player once for the levels reached before levels paid Leaf, without events", () => {
    earnedBefore(alice, 2300, "raid:old:a");
    earnedBefore(bob, 900, "raid:old:b");

    expect(payMissedLevels(db, rules.levels, T0)).toEqual({ players: 1, leaf: 225 });
    expect(payMissedLevels(db, rules.levels, T0 + MINUTE)).toEqual({ players: 0, leaf: 0 });

    expect(getAccount(db, alice)).toMatchObject({ balance: 2300 + 225, xp: 2300 });
    expect(getAccount(db, bob)).toMatchObject({ balance: 900, xp: 900 });
    expect(levelEntries(alice)).toHaveLength(2);
    expect(events(alice)).toEqual([]);
  });

  it("pays a level reached after the missed ones were paid, and none of those again", async () => {
    earnedBefore(alice, 1000, "raid:old:a");
    payMissedLevels(db, rules.levels, T0);
    const source = feed([raid(1, alice, T0 + MINUTE, 1300)]);
    await syncCredits(db, source, rules, T0, "recent");

    await syncCredits(db, source, rules, T0 + 5 * MINUTE, "recent");

    expect(levelEntries(alice)).toEqual([
      [`level:${alice}:3`, 125, 0],
      [`level:${alice}:2`, 100, 0],
    ]);
    expect(events(alice).at(-1)).toEqual({ type: "level_up", data: { level: 3, leaf: 125 } });
  });

  it("pays a level again, once, when it is reached again after its payout was reversed", () => {
    const raidPay = earnedBefore(alice, 1000, "raid:old:a");
    payMissedLevels(db, rules.levels, T0);
    reverse(raidPay);
    reverse(levelPayout(alice, `level:${alice}:2`));
    earnedBefore(alice, 1000, "raid:new:a");

    expect(payLevels(db, alice, rules.levels, T0 + MINUTE)).toBe(100);
    expect(payLevels(db, alice, rules.levels, T0 + 2 * MINUTE)).toBe(0);
    expect(payMissedLevels(db, rules.levels, T0 + 3 * MINUTE)).toEqual({ players: 0, leaf: 0 });
    expect(levelEntries(alice)).toEqual([
      [`level:${alice}:2:2`, 100, 0],
      [`undo:level:${alice}:2`, -100, 0],
      [`level:${alice}:2`, 100, 0],
    ]);
    expect(getAccount(db, alice)).toMatchObject({ balance: 1000 + 100, xp: 1000 });
  });

  it("does not pay a level twice while its payout stands, even when XP fell below it and came back", () => {
    const raidPay = earnedBefore(alice, 1000, "raid:old:a");
    payMissedLevels(db, rules.levels, T0);
    reverse(raidPay);
    earnedBefore(alice, 1000, "raid:new:a");

    expect(payLevels(db, alice, rules.levels, T0)).toBe(0);
    expect(levelEntries(alice)).toEqual([[`level:${alice}:2`, 100, 0]]);
  });
});

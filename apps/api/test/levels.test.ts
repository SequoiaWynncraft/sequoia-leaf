import { beforeEach, describe, expect, it } from "bun:test";

import { DEFAULT_RULES, leaf, type LedgerEntry, type PlayerId, playerId, type Rules } from "@sequoia-leaf/core";
import { Effect } from "effect";

import { type CreditSource, syncCredits } from "../src/earning/sync.ts";
import { Events } from "../src/events/store.ts";
import { Ledger } from "../src/ledger/store.ts";
import { payLevels, payMissedLevels } from "../src/levels/pay.ts";
import { feed, MINUTE, noNetwork, raid, rejection, testLeaf } from "./support.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const bob = playerId("00000000-0000-4000-8000-00000000000b");
/** Wednesday 4 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 4, 12);

/** No quests, so only raids and levels pay. Level 2 takes 1,000 XP and pays 100 Leaf, level 3 1,250 more and 125. */
const rules: Rules = { ...DEFAULT_RULES, quests: { ...DEFAULT_RULES.quests, templates: [] } };

let ledger: ReturnType<typeof testLeaf>;

beforeEach(() => {
  ledger = testLeaf({ now: T0 }, noNetwork);
});

/** The player's level entries, payouts and their reversals, newest first. */
async function levelEntries(player: PlayerId): Promise<[string, number, number][]> {
  const rows = await ledger.query<{ idempotency_key: string; balance_delta: number; xp_delta: number }>(
    (sql) => sql`
      SELECT idempotency_key, balance_delta, xp_delta FROM ledger_entries
      WHERE player_id = ${player} AND origin = 'level'
      ORDER BY id DESC
    `,
  );
  return rows.map((row) => [row.idempotency_key, row.balance_delta, row.xp_delta]);
}

async function events(player: PlayerId): Promise<{ type: string; data: unknown }[]> {
  const stored = await ledger.run(Events.use((store) => store.after(player, 0, 50)));
  return stored.map((event) => ({ type: event.type, data: JSON.parse(event.data) }));
}

function sync(source: CreditSource, now: number, mode: "recent" | "deep" = "recent") {
  return ledger.run(syncCredits(source, rules, now, mode));
}

/** Gives a player XP the way a raid paid before levels paid Leaf: an earn entry with no level pay. */
async function earnedBefore(player: PlayerId, amount: number, key: string): Promise<LedgerEntry> {
  const result = await ledger.post(
    { kind: "earn", playerId: player, amount: leaf(amount), source: "raid", idempotencyKey: key },
    T0,
  );
  if (result.status !== "posted") {
    throw new Error(`Expected ${key} to post, got ${result.status}`);
  }
  return result.entry;
}

/** Takes an entry back in full, as a correction does. */
async function reverse(entry: LedgerEntry): Promise<void> {
  await ledger.post(
    { kind: "reversal", playerId: entry.playerId, reverses: entry, idempotencyKey: `undo:${entry.idempotencyKey}` },
    T0,
  );
}

/** The entry that paid for a level. */
async function levelPayout(player: PlayerId, key: string): Promise<LedgerEntry> {
  const payouts = await ledger.run(Ledger.use((store) => store.earns(player, "level")));
  const entry = payouts.map((payout) => payout.entry).find((candidate) => candidate.idempotencyKey === key);
  if (entry === undefined) {
    throw new Error(`No entry ${key}`);
  }
  return entry;
}

describe("Leaf for levels", () => {
  it("pays a level in the sync that reaches it, says so, and pays it once", async () => {
    const source = feed([raid(1, alice, T0 + MINUTE, 600), raid(2, alice, T0 + 2 * MINUTE, 500)]);
    await sync(source, T0, "recent");

    const result = await sync(source, T0 + 5 * MINUTE, "recent");
    await sync(source, T0 + 6 * MINUTE, "deep");

    expect(result).toEqual({ status: "synced", recorded: 2, leafPaid: 1100 + 100 });
    expect(await ledger.account(alice)).toMatchObject({ balance: 1200, xp: 1100 });
    expect(await levelEntries(alice)).toEqual([[`level:${alice}:2`, 100, 0]]);
    expect((await events(alice)).at(-1)).toEqual({ type: "level_up", data: { level: 2, leaf: 100 } });
  });

  it("pays every level a single sync passes, with one event for the level reached", async () => {
    const source = feed([raid(1, alice, T0 + MINUTE, 2300)]);
    await sync(source, T0, "recent");

    await sync(source, T0 + 5 * MINUTE, "recent");

    expect(await levelEntries(alice)).toEqual([
      [`level:${alice}:3`, 125, 0],
      [`level:${alice}:2`, 100, 0],
    ]);
    expect((await events(alice)).filter((event) => event.type === "level_up")).toEqual([
      { type: "level_up", data: { level: 3, leaf: 225 } },
    ]);
  });

  it("pays each player once for the levels reached before levels paid Leaf, without events", async () => {
    await earnedBefore(alice, 2300, "raid:old:a");
    await earnedBefore(bob, 900, "raid:old:b");

    expect(await ledger.run(payMissedLevels(rules.levels, T0))).toEqual({ players: 1, leaf: 225 });
    expect(await ledger.run(payMissedLevels(rules.levels, T0 + MINUTE))).toEqual({ players: 0, leaf: 0 });

    expect(await ledger.account(alice)).toMatchObject({ balance: 2300 + 225, xp: 2300 });
    expect(await ledger.account(bob)).toMatchObject({ balance: 900, xp: 900 });
    expect(await levelEntries(alice)).toHaveLength(2);
    expect(await events(alice)).toEqual([]);
  });

  it("pays a level reached after the missed ones were paid, and none of those again", async () => {
    await earnedBefore(alice, 1000, "raid:old:a");
    await ledger.run(payMissedLevels(rules.levels, T0));
    const source = feed([raid(1, alice, T0 + MINUTE, 1300)]);
    await sync(source, T0, "recent");

    await sync(source, T0 + 5 * MINUTE, "recent");

    expect(await levelEntries(alice)).toEqual([
      [`level:${alice}:3`, 125, 0],
      [`level:${alice}:2`, 100, 0],
    ]);
    expect((await events(alice)).at(-1)).toEqual({ type: "level_up", data: { level: 3, leaf: 125 } });
  });

  it("pays a level again, once, when it is reached again after its payout was reversed", async () => {
    const raidPay = await earnedBefore(alice, 1000, "raid:old:a");
    await ledger.run(payMissedLevels(rules.levels, T0));
    await reverse(raidPay);
    await reverse(await levelPayout(alice, `level:${alice}:2`));
    await earnedBefore(alice, 1000, "raid:new:a");

    expect(await ledger.run(payLevels(alice, rules.levels, T0 + MINUTE))).toBe(100);
    expect(await ledger.run(payLevels(alice, rules.levels, T0 + 2 * MINUTE))).toBe(0);
    expect(await ledger.run(payMissedLevels(rules.levels, T0 + 3 * MINUTE))).toEqual({ players: 0, leaf: 0 });
    expect(await levelEntries(alice)).toEqual([
      [`level:${alice}:2:2`, 100, 0],
      [`undo:level:${alice}:2`, -100, 0],
      [`level:${alice}:2`, 100, 0],
    ]);
    expect(await ledger.account(alice)).toMatchObject({ balance: 1000 + 100, xp: 1000 });
  });

  it("finishes at the next start a check stopped halfway, paying each level once", async () => {
    const players = Array.from({ length: 250 }, (_, n) =>
      playerId(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`),
    );
    const stopAt = players[180];
    const stopping = { on: true };
    const own = testLeaf(
      { now: T0 },
      noNetwork,
      {},
      {
        ledger: (real) => ({
          ...real,
          account: (player) =>
            stopping.on && player === stopAt ? Effect.die(new Error("Leaf stops here")) : real.account(player),
        }),
      },
    );
    try {
      for (const [n, player] of players.entries()) {
        // oxlint-disable-next-line no-await-in-loop -- one after another
        await own.post(
          { kind: "earn", playerId: player, amount: leaf(1000), source: "raid", idempotencyKey: `r${n}` },
          T0,
        );
      }

      const stopped = await rejection(own.run(payMissedLevels(rules.levels, T0)));
      stopping.on = false;
      const finished = await own.run(payMissedLevels(rules.levels, T0 + MINUTE));
      const again = await own.run(payMissedLevels(rules.levels, T0 + 2 * MINUTE));

      expect(String(stopped)).toContain("Leaf stops here");
      const paid = await own.query<{ n: number; leaf: number }>(
        (sql) => sql`SELECT count(*) AS n, sum(balance_delta) AS leaf FROM ledger_entries WHERE origin = 'level'`,
      );
      expect(paid).toEqual([{ n: 250, leaf: 250 * 100 }]);
      expect(finished.leaf).toBeGreaterThan(0);
      expect(again).toEqual({ players: 0, leaf: 0 });
    } finally {
      await own.dispose();
    }
  });

  it("checks every account again when the level rules change, and pays what the new ones owe", async () => {
    await earnedBefore(alice, 2300, "raid:old:a");
    const unpaid = { ...rules.levels, firstLevelLeaf: 0, leafGrowthPerLevel: 0 };
    expect(await ledger.run(payMissedLevels(unpaid, T0))).toEqual({ players: 0, leaf: 0 });

    expect(await ledger.run(payMissedLevels(rules.levels, T0 + MINUTE))).toEqual({ players: 1, leaf: 225 });
  });

  it("checks at a start only the accounts whose XP or level payouts changed since the last check", async () => {
    const asked: string[] = [];
    const own = testLeaf(
      { now: T0 },
      noNetwork,
      {},
      {
        ledger: (real) => ({
          ...real,
          account: (player) =>
            Effect.andThen(
              Effect.sync(() => asked.push(player)),
              real.account(player),
            ),
        }),
      },
    );
    try {
      await own.post({ kind: "earn", playerId: alice, amount: leaf(2300), source: "raid", idempotencyKey: "a" }, T0);
      await own.post({ kind: "earn", playerId: bob, amount: leaf(500), source: "raid", idempotencyKey: "b" }, T0);
      await own.run(payMissedLevels(rules.levels, T0));
      // Alice's level payouts are new since that check: she is looked at once more, and owes nothing.
      await own.run(payMissedLevels(rules.levels, T0 + MINUTE));
      asked.length = 0;

      expect(await own.run(payMissedLevels(rules.levels, T0 + 2 * MINUTE))).toEqual({ players: 0, leaf: 0 });
      expect(asked).toEqual([]);
      await own.post({ kind: "earn", playerId: bob, amount: leaf(600), source: "raid", idempotencyKey: "b2" }, T0);
      expect(await own.run(payMissedLevels(rules.levels, T0 + 3 * MINUTE))).toEqual({ players: 1, leaf: 100 });
      expect(asked).toEqual([bob]);
    } finally {
      await own.dispose();
    }
  });

  it("does not pay a level twice while its payout stands, even when XP fell below it and came back", async () => {
    const raidPay = await earnedBefore(alice, 1000, "raid:old:a");
    await ledger.run(payMissedLevels(rules.levels, T0));
    await reverse(raidPay);
    await earnedBefore(alice, 1000, "raid:new:a");

    expect(await ledger.run(payLevels(alice, rules.levels, T0))).toBe(0);
    expect(await levelEntries(alice)).toEqual([[`level:${alice}:2`, 100, 0]]);
  });
});

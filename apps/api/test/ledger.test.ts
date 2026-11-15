import { leaf, type LedgerEntry, type PlayerId, playerId, type Posting } from "@sequoia-leaf/core";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { getAccount, listEntries, postEntry, type PostResult } from "../src/ledger/store.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const bob = playerId("00000000-0000-4000-8000-00000000000b");
const NOW = 1_763_000_000_000;

function post(posting: Posting, now = NOW): Promise<PostResult> {
  return postEntry(env.DB, posting, now);
}

async function posted(posting: Posting): Promise<LedgerEntry> {
  const result = await post(posting);
  if (result.status !== "posted") {
    throw new Error(`Expected the posting to be written, got ${JSON.stringify(result)}`);
  }
  return result.entry;
}

function earn(player: PlayerId, amount: number, key: string): Posting {
  return { kind: "earn", playerId: player, amount: leaf(amount), source: "raid", idempotencyKey: key };
}

function spend(player: PlayerId, amount: number, key: string): Posting {
  return { kind: "spend", playerId: player, amount: leaf(amount), sink: "shop", idempotencyKey: key };
}

/** Every account's totals must equal the sums of that player's entries. */
async function expectAccountsMatchEntries(): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT player_id FROM accounts AS a
     WHERE balance <> (SELECT COALESCE(SUM(balance_delta), 0) FROM ledger_entries WHERE player_id = a.player_id)
        OR lifetime_earned <> (SELECT COALESCE(SUM(lifetime_delta), 0) FROM ledger_entries WHERE player_id = a.player_id)`,
  ).all();
  expect(results).toEqual([]);
}

describe("earning and spending", () => {
  it("gives a player with no entries an account of zero", async () => {
    expect(await getAccount(env.DB, alice)).toEqual({ playerId: alice, balance: 0, lifetimeEarned: 0 });
  });

  it("adds earned Leaf to the balance and to lifetime earned", async () => {
    const entry = await posted(earn(alice, 110, "raid:1:alice"));

    expect(entry).toMatchObject({ playerId: alice, kind: "earn", balanceDelta: 110, origin: "raid", createdAt: NOW });
    expect(await getAccount(env.DB, alice)).toEqual({ playerId: alice, balance: 110, lifetimeEarned: 110 });
  });

  it("takes spent Leaf from the balance without lowering lifetime earned", async () => {
    await posted(earn(alice, 110, "raid:1:alice"));

    await posted(spend(alice, 40, "order:1"));

    expect(await getAccount(env.DB, alice)).toEqual({ playerId: alice, balance: 70, lifetimeEarned: 110 });
  });

  it("lets a player spend their whole balance", async () => {
    await posted(earn(alice, 110, "raid:1:alice"));

    await posted(spend(alice, 110, "order:1"));

    expect((await getAccount(env.DB, alice)).balance).toBe(0);
  });

  it("rejects a spend the balance cannot cover and writes nothing", async () => {
    await posted(earn(alice, 30, "raid:1:alice"));

    const result = await post(spend(alice, 31, "order:1"));

    expect(result).toEqual({ status: "rejected", reason: "insufficient_leaf" });
    expect(await getAccount(env.DB, alice)).toEqual({ playerId: alice, balance: 30, lifetimeEarned: 30 });
    expect(await listEntries(env.DB, alice, { limit: 10 })).toHaveLength(1);
  });

  it("rejects a spend from a player who has never earned", async () => {
    expect(await post(spend(alice, 1, "order:1"))).toEqual({ status: "rejected", reason: "insufficient_leaf" });
  });

  it("keeps players' accounts separate", async () => {
    await posted(earn(alice, 110, "raid:1:alice"));
    await posted(earn(bob, 20, "raid:1:bob"));

    expect((await getAccount(env.DB, alice)).balance).toBe(110);
    expect((await getAccount(env.DB, bob)).balance).toBe(20);
  });

  it("lets only one of two simultaneous spends through when the balance covers one", async () => {
    await posted(earn(alice, 100, "raid:1:alice"));

    const results = await Promise.all([post(spend(alice, 60, "order:1")), post(spend(alice, 60, "order:2"))]);

    expect(results.map((result) => result.status).toSorted()).toEqual(["posted", "rejected"]);
    expect((await getAccount(env.DB, alice)).balance).toBe(40);
    await expectAccountsMatchEntries();
  });
});

describe("idempotency", () => {
  it("records a fact once when it is posted twice", async () => {
    const first = await posted(earn(alice, 110, "raid:1:alice"));

    const second = await post(earn(alice, 110, "raid:1:alice"), NOW + 5_000);

    expect(second).toEqual({ status: "duplicate", entry: first });
    expect((await getAccount(env.DB, alice)).balance).toBe(110);
  });

  it("rejects a key that was already used for a different fact", async () => {
    await posted(earn(alice, 110, "raid:1:alice"));

    const result = await post(earn(alice, 220, "raid:1:alice"));

    expect(result).toEqual({ status: "rejected", reason: "idempotency_conflict" });
    expect((await getAccount(env.DB, alice)).balance).toBe(110);
  });

  it("rejects one player's key reused for another player", async () => {
    await posted(earn(alice, 110, "raid:1"));

    expect(await post(earn(bob, 110, "raid:1"))).toEqual({ status: "rejected", reason: "idempotency_conflict" });
    expect((await getAccount(env.DB, bob)).balance).toBe(0);
  });
});

describe("reversals", () => {
  it("removes a reversed earn from the balance and from lifetime earned", async () => {
    const earned = await posted(earn(alice, 110, "raid:1:alice"));

    const reversal = await posted({
      kind: "reversal",
      playerId: alice,
      reverses: earned,
      idempotencyKey: "undo:raid:1:alice",
      actor: "staff:1",
      memo: "Raid report was forged",
    });

    expect(reversal).toMatchObject({ kind: "reversal", reversesId: earned.id, origin: "raid", actor: "staff:1" });
    expect(await getAccount(env.DB, alice)).toEqual({ playerId: alice, balance: 0, lifetimeEarned: 0 });
  });

  it("returns a reversed spend to the balance", async () => {
    await posted(earn(alice, 110, "raid:1:alice"));
    const spent = await posted(spend(alice, 40, "order:1"));

    await posted({ kind: "reversal", playerId: alice, reverses: spent, idempotencyKey: "undo:order:1" });

    expect(await getAccount(env.DB, alice)).toEqual({ playerId: alice, balance: 110, lifetimeEarned: 110 });
  });

  it("leaves the player in debt when reversed Leaf was already spent", async () => {
    const earned = await posted(earn(alice, 110, "raid:1:alice"));
    await posted(spend(alice, 100, "order:1"));

    await posted({ kind: "reversal", playerId: alice, reverses: earned, idempotencyKey: "undo:raid:1:alice" });

    expect(await getAccount(env.DB, alice)).toEqual({ playerId: alice, balance: -100, lifetimeEarned: 0 });
    expect(await post(spend(alice, 1, "order:2"))).toEqual({ status: "rejected", reason: "insufficient_leaf" });
  });

  it("treats a retried reversal as a duplicate", async () => {
    const earned = await posted(earn(alice, 110, "raid:1:alice"));
    const undo: Posting = { kind: "reversal", playerId: alice, reverses: earned, idempotencyKey: "undo:raid:1:alice" };
    const first = await posted(undo);

    expect(await post(undo)).toEqual({ status: "duplicate", entry: first });
    expect((await getAccount(env.DB, alice)).balance).toBe(0);
  });

  it("rejects a second reversal of the same entry", async () => {
    const earned = await posted(earn(alice, 110, "raid:1:alice"));
    await posted({ kind: "reversal", playerId: alice, reverses: earned, idempotencyKey: "undo:a" });

    const result = await post({ kind: "reversal", playerId: alice, reverses: earned, idempotencyKey: "undo:b" });

    expect(result).toEqual({ status: "rejected", reason: "already_reversed" });
    expect((await getAccount(env.DB, alice)).balance).toBe(0);
  });

  it("refuses a reversal that does not match the stored entry", async () => {
    const earned = await posted(earn(alice, 110, "raid:1:alice"));
    const tampered: LedgerEntry = { ...earned, balanceDelta: 500, lifetimeDelta: 500 };

    await expect(
      post({ kind: "reversal", playerId: alice, reverses: tampered, idempotencyKey: "undo:raid:1:alice" }),
    ).rejects.toThrow(/reversal_mismatch/);
    expect((await getAccount(env.DB, alice)).balance).toBe(110);
  });
});

describe("the ledger table", () => {
  it("refuses to change or delete an entry", async () => {
    const entry = await posted(earn(alice, 110, "raid:1:alice"));

    await expect(
      env.DB.prepare("UPDATE ledger_entries SET balance_delta = 999 WHERE id = ?").bind(entry.id).run(),
    ).rejects.toThrow(/ledger_append_only/);
    await expect(env.DB.prepare("DELETE FROM ledger_entries WHERE id = ?").bind(entry.id).run()).rejects.toThrow(
      /ledger_append_only/,
    );
  });

  it("refuses an entry whose deltas do not fit its kind", async () => {
    const insert = env.DB.prepare(
      `INSERT INTO ledger_entries (player_id, kind, balance_delta, lifetime_delta, origin, idempotency_key, created_at)
       VALUES (?, 'spend', 50, 0, 'shop', 'bad', ?)`,
    ).bind(alice, NOW);

    await expect(insert.run()).rejects.toThrow(/CHECK constraint failed/);
  });

  it("undoes a spend when a later statement in the same batch fails", async () => {
    await posted(earn(alice, 100, "raid:1:alice"));
    const insert = `INSERT INTO ledger_entries
        (player_id, kind, balance_delta, lifetime_delta, origin, idempotency_key, created_at)
      VALUES (?, 'spend', ?, 0, 'shop', ?, ?)`;

    await expect(
      env.DB.batch([
        env.DB.prepare(insert).bind(alice, -60, "order:1", NOW),
        env.DB.prepare(insert).bind(alice, -60, "order:2", NOW),
      ]),
    ).rejects.toThrow(/insufficient_leaf/);

    expect((await getAccount(env.DB, alice)).balance).toBe(100);
    expect(await listEntries(env.DB, alice, { limit: 10 })).toHaveLength(1);
  });

  it("keeps every account equal to the sum of its entries", async () => {
    const earned = await posted(earn(alice, 110, "raid:1:alice"));
    await posted(spend(alice, 40, "order:1"));
    await posted(earn(bob, 20, "raid:1:bob"));
    await posted({ kind: "reversal", playerId: alice, reverses: earned, idempotencyKey: "undo:raid:1:alice" });
    await post(spend(bob, 500, "order:2"));

    await expectAccountsMatchEntries();
  });
});

describe("listEntries", () => {
  it("returns a player's entries newest first and pages backwards", async () => {
    const first = await posted(earn(alice, 10, "raid:1:alice"));
    const second = await posted(earn(alice, 20, "raid:2:alice"));
    const third = await posted(earn(alice, 30, "raid:3:alice"));
    await posted(earn(bob, 99, "raid:1:bob"));

    const page = await listEntries(env.DB, alice, { limit: 2 });
    const rest = await listEntries(env.DB, alice, { limit: 2, beforeId: second.id });

    expect(page.map((entry) => entry.id)).toEqual([third.id, second.id]);
    expect(rest.map((entry) => entry.id)).toEqual([first.id]);
  });
});

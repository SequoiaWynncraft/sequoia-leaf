import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";

import { leaf, type LedgerEntry, type PlayerId, playerId, type Posting } from "@sequoia-leaf/core";

import { getAccount, listEntries, postEntry, type PostResult } from "../src/ledger/store.ts";
import { testDatabase } from "./support.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const bob = playerId("00000000-0000-4000-8000-00000000000b");
const NOW = 1_763_000_000_000;

let db: Database;

beforeEach(() => {
  db = testDatabase();
});

function post(posting: Posting, now = NOW): PostResult {
  return postEntry(db, posting, now);
}

function posted(posting: Posting): LedgerEntry {
  const result = post(posting);
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
function expectAccountsMatchEntries(): void {
  const drifted = db
    .query(
      `SELECT player_id FROM accounts AS a
       WHERE balance <> (SELECT COALESCE(SUM(balance_delta), 0) FROM ledger_entries WHERE player_id = a.player_id)
          OR xp <> (SELECT COALESCE(SUM(xp_delta), 0) FROM ledger_entries WHERE player_id = a.player_id)`,
    )
    .all();
  expect(drifted).toEqual([]);
}

describe("earning and spending", () => {
  it("gives a player with no entries an account of zero", () => {
    expect(getAccount(db, alice)).toEqual({ playerId: alice, balance: 0, xp: 0 });
  });

  it("adds earned Leaf to the balance and to XP", () => {
    const entry = posted(earn(alice, 110, "raid:1:alice"));

    expect(entry).toMatchObject({ playerId: alice, kind: "earn", balanceDelta: 110, origin: "raid", createdAt: NOW });
    expect(getAccount(db, alice)).toEqual({ playerId: alice, balance: 110, xp: 110 });
  });

  it("takes spent Leaf from the balance without lowering XP", () => {
    posted(earn(alice, 110, "raid:1:alice"));

    posted(spend(alice, 40, "order:1"));

    expect(getAccount(db, alice)).toEqual({ playerId: alice, balance: 70, xp: 110 });
  });

  it("lets a player spend their whole balance", () => {
    posted(earn(alice, 110, "raid:1:alice"));

    posted(spend(alice, 110, "order:1"));

    expect(getAccount(db, alice).balance).toBe(0);
  });

  it("rejects a spend the balance cannot cover and writes nothing", () => {
    posted(earn(alice, 30, "raid:1:alice"));

    const result = post(spend(alice, 31, "order:1"));

    expect(result).toEqual({ status: "rejected", reason: "insufficient_leaf" });
    expect(getAccount(db, alice)).toEqual({ playerId: alice, balance: 30, xp: 30 });
    expect(listEntries(db, alice, { limit: 10 })).toHaveLength(1);
  });

  it("rejects a spend from a player who has never earned", () => {
    expect(post(spend(alice, 1, "order:1"))).toEqual({ status: "rejected", reason: "insufficient_leaf" });
  });

  it("keeps players' accounts separate", () => {
    posted(earn(alice, 110, "raid:1:alice"));
    posted(earn(bob, 20, "raid:1:bob"));

    expect(getAccount(db, alice).balance).toBe(110);
    expect(getAccount(db, bob).balance).toBe(20);
  });

  it("lets only the first of two spends through when the balance covers one", () => {
    posted(earn(alice, 100, "raid:1:alice"));

    const results = [post(spend(alice, 60, "order:1")), post(spend(alice, 60, "order:2"))];

    expect(results.map((result) => result.status)).toEqual(["posted", "rejected"]);
    expect(getAccount(db, alice).balance).toBe(40);
    expectAccountsMatchEntries();
  });
});

describe("idempotency", () => {
  it("records a fact once when it is posted twice", () => {
    const first = posted(earn(alice, 110, "raid:1:alice"));

    const second = post(earn(alice, 110, "raid:1:alice"), NOW + 5_000);

    expect(second).toEqual({ status: "duplicate", entry: first });
    expect(getAccount(db, alice).balance).toBe(110);
  });

  it("rejects a key that was already used for a different fact", () => {
    posted(earn(alice, 110, "raid:1:alice"));

    const result = post(earn(alice, 220, "raid:1:alice"));

    expect(result).toEqual({ status: "rejected", reason: "idempotency_conflict" });
    expect(getAccount(db, alice).balance).toBe(110);
  });

  it("rejects one player's key reused for another player", () => {
    posted(earn(alice, 110, "raid:1"));

    expect(post(earn(bob, 110, "raid:1"))).toEqual({ status: "rejected", reason: "idempotency_conflict" });
    expect(getAccount(db, bob).balance).toBe(0);
  });
});

describe("reversals", () => {
  it("removes a reversed earn from the balance and from XP", () => {
    const earned = posted(earn(alice, 110, "raid:1:alice"));

    const reversal = posted({
      kind: "reversal",
      playerId: alice,
      reverses: earned,
      idempotencyKey: "undo:raid:1:alice",
      actor: "staff:1",
      memo: "Raid report was forged",
    });

    expect(reversal).toMatchObject({ kind: "reversal", reversesId: earned.id, origin: "raid", actor: "staff:1" });
    expect(getAccount(db, alice)).toEqual({ playerId: alice, balance: 0, xp: 0 });
  });

  it("returns a reversed spend to the balance", () => {
    posted(earn(alice, 110, "raid:1:alice"));
    const spent = posted(spend(alice, 40, "order:1"));

    posted({ kind: "reversal", playerId: alice, reverses: spent, idempotencyKey: "undo:order:1" });

    expect(getAccount(db, alice)).toEqual({ playerId: alice, balance: 110, xp: 110 });
  });

  it("leaves the player in debt when reversed Leaf was already spent", () => {
    const earned = posted(earn(alice, 110, "raid:1:alice"));
    posted(spend(alice, 100, "order:1"));

    posted({ kind: "reversal", playerId: alice, reverses: earned, idempotencyKey: "undo:raid:1:alice" });

    expect(getAccount(db, alice)).toEqual({ playerId: alice, balance: -100, xp: 0 });
    expect(post(spend(alice, 1, "order:2"))).toEqual({ status: "rejected", reason: "insufficient_leaf" });
  });

  it("treats a retried reversal as a duplicate", () => {
    const earned = posted(earn(alice, 110, "raid:1:alice"));
    const undo: Posting = { kind: "reversal", playerId: alice, reverses: earned, idempotencyKey: "undo:raid:1:alice" };
    const first = posted(undo);

    expect(post(undo)).toEqual({ status: "duplicate", entry: first });
    expect(getAccount(db, alice).balance).toBe(0);
  });

  it("rejects a second reversal of the same entry", () => {
    const earned = posted(earn(alice, 110, "raid:1:alice"));
    posted({ kind: "reversal", playerId: alice, reverses: earned, idempotencyKey: "undo:a" });

    const result = post({ kind: "reversal", playerId: alice, reverses: earned, idempotencyKey: "undo:b" });

    expect(result).toEqual({ status: "rejected", reason: "already_reversed" });
    expect(getAccount(db, alice).balance).toBe(0);
  });

  it("refuses a reversal that does not match the stored entry", () => {
    const earned = posted(earn(alice, 110, "raid:1:alice"));
    const tampered: LedgerEntry = { ...earned, balanceDelta: 500, xpDelta: 500 };

    expect(() =>
      post({ kind: "reversal", playerId: alice, reverses: tampered, idempotencyKey: "undo:raid:1:alice" }),
    ).toThrow(/reversal_mismatch/);
    expect(getAccount(db, alice).balance).toBe(110);
  });
});

describe("the ledger table", () => {
  it("refuses to change or delete an entry", () => {
    const entry = posted(earn(alice, 110, "raid:1:alice"));

    expect(() => db.query("UPDATE ledger_entries SET balance_delta = 999 WHERE id = ?").run(entry.id)).toThrow(
      /ledger_append_only/,
    );
    expect(() => db.query("DELETE FROM ledger_entries WHERE id = ?").run(entry.id)).toThrow(/ledger_append_only/);
  });

  it("refuses an entry whose deltas do not fit its kind", () => {
    const insert = db.query(
      `INSERT INTO ledger_entries (player_id, kind, balance_delta, xp_delta, origin, idempotency_key, created_at)
       VALUES (?, 'spend', 50, 0, 'shop', 'bad', ?)`,
    );

    expect(() => insert.run(alice, NOW)).toThrow(/CHECK constraint failed/);
  });

  it("undoes a spend when a later statement in the same transaction fails", () => {
    posted(earn(alice, 100, "raid:1:alice"));
    const insert = db.query(
      `INSERT INTO ledger_entries
         (player_id, kind, balance_delta, xp_delta, origin, idempotency_key, created_at)
       VALUES (?, 'spend', ?, 0, 'shop', ?, ?)`,
    );
    const spendTwice = db.transaction(() => {
      insert.run(alice, -60, "order:1", NOW);
      insert.run(alice, -60, "order:2", NOW);
    });

    expect(spendTwice).toThrow(/insufficient_leaf/);

    expect(getAccount(db, alice).balance).toBe(100);
    expect(listEntries(db, alice, { limit: 10 })).toHaveLength(1);
  });

  it("keeps every account equal to the sum of its entries", () => {
    const earned = posted(earn(alice, 110, "raid:1:alice"));
    posted(spend(alice, 40, "order:1"));
    posted(earn(bob, 20, "raid:1:bob"));
    posted({ kind: "reversal", playerId: alice, reverses: earned, idempotencyKey: "undo:raid:1:alice" });
    post(spend(bob, 500, "order:2"));

    expectAccountsMatchEntries();
  });
});

describe("listEntries", () => {
  it("returns a player's entries newest first and pages backwards", () => {
    const first = posted(earn(alice, 10, "raid:1:alice"));
    const second = posted(earn(alice, 20, "raid:2:alice"));
    const third = posted(earn(alice, 30, "raid:3:alice"));
    posted(earn(bob, 99, "raid:1:bob"));

    const page = listEntries(db, alice, { limit: 2 });
    const rest = listEntries(db, alice, { limit: 2, beforeId: second.id });

    expect(page.map((entry) => entry.id)).toEqual([third.id, second.id]);
    expect(rest.map((entry) => entry.id)).toEqual([first.id]);
  });
});

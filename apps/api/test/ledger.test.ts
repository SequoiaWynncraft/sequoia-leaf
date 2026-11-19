import { beforeEach, describe, expect, it } from "bun:test";

import { leaf, type LedgerEntry, type PlayerId, playerId, type Posting } from "@sequoia-leaf/core";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";

import { Ledger, type PostResult } from "../src/ledger/store.ts";
import { noNetwork, rejection, testLeaf } from "./support.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const bob = playerId("00000000-0000-4000-8000-00000000000b");
const NOW = 1_763_000_000_000;

let ledger: ReturnType<typeof testLeaf>;

beforeEach(() => {
  ledger = testLeaf({ now: NOW }, noNetwork);
});

function post(posting: Posting, now = NOW): Promise<PostResult> {
  return ledger.run(Ledger.use((store) => store.post(posting, now)));
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

async function entryCount(player: PlayerId): Promise<unknown> {
  return ledger.query((sql) => sql`SELECT count(*) AS entries FROM ledger_entries WHERE player_id = ${player}`);
}

/** Every account's totals must equal the sums of that player's entries. */
async function expectAccountsMatchEntries(): Promise<void> {
  const drifted = await ledger.query(
    (sql) => sql`
      SELECT player_id FROM accounts AS a
      WHERE balance <> (SELECT COALESCE(SUM(balance_delta), 0) FROM ledger_entries WHERE player_id = a.player_id)
         OR xp <> (SELECT COALESCE(SUM(xp_delta), 0) FROM ledger_entries WHERE player_id = a.player_id)
    `,
  );
  expect(drifted).toEqual([]);
}

describe("earning and spending", () => {
  it("gives a player with no entries an account of zero", async () => {
    expect(await ledger.account(alice)).toEqual({ playerId: alice, balance: 0, xp: 0 });
  });

  it("adds earned Leaf to the balance and to XP", async () => {
    const entry = await posted(earn(alice, 110, "raid:1:alice"));

    expect(entry).toMatchObject({ playerId: alice, kind: "earn", balanceDelta: 110, origin: "raid", createdAt: NOW });
    expect(await ledger.account(alice)).toEqual({ playerId: alice, balance: 110, xp: 110 });
  });

  it("takes spent Leaf from the balance without lowering XP", async () => {
    await posted(earn(alice, 110, "raid:1:alice"));

    await posted(spend(alice, 40, "order:1"));

    expect(await ledger.account(alice)).toEqual({ playerId: alice, balance: 70, xp: 110 });
  });

  it("lets a player spend their whole balance", async () => {
    await posted(earn(alice, 110, "raid:1:alice"));

    await posted(spend(alice, 110, "order:1"));

    expect((await ledger.account(alice)).balance).toBe(0);
  });

  it("rejects a spend the balance cannot cover and writes nothing", async () => {
    await posted(earn(alice, 30, "raid:1:alice"));

    const result = await post(spend(alice, 31, "order:1"));

    expect(result).toEqual({ status: "rejected", reason: "insufficient_leaf" });
    expect(await ledger.account(alice)).toEqual({ playerId: alice, balance: 30, xp: 30 });
    expect(await entryCount(alice)).toEqual([{ entries: 1 }]);
  });

  it("rejects a spend from a player who has never earned", async () => {
    expect(await post(spend(alice, 1, "order:1"))).toEqual({ status: "rejected", reason: "insufficient_leaf" });
  });

  it("keeps players' accounts separate", async () => {
    await posted(earn(alice, 110, "raid:1:alice"));
    await posted(earn(bob, 20, "raid:1:bob"));

    expect((await ledger.account(alice)).balance).toBe(110);
    expect((await ledger.account(bob)).balance).toBe(20);
  });

  it("lets only the first of two spends through when the balance covers one", async () => {
    await posted(earn(alice, 100, "raid:1:alice"));

    const results = await Promise.all([post(spend(alice, 60, "order:1")), post(spend(alice, 60, "order:2"))]);

    expect(results.map((result) => result.status)).toEqual(["posted", "rejected"]);
    expect((await ledger.account(alice)).balance).toBe(40);
    await expectAccountsMatchEntries();
  });
});

describe("idempotency", () => {
  it("records a fact once when it is posted twice", async () => {
    const first = await posted(earn(alice, 110, "raid:1:alice"));

    const second = await post(earn(alice, 110, "raid:1:alice"), NOW + 5_000);

    expect(second).toEqual({ status: "duplicate", entry: first });
    expect((await ledger.account(alice)).balance).toBe(110);
  });

  it("rejects a key that was already used for a different fact", async () => {
    await posted(earn(alice, 110, "raid:1:alice"));

    const result = await post(earn(alice, 220, "raid:1:alice"));

    expect(result).toEqual({ status: "rejected", reason: "idempotency_conflict" });
    expect((await ledger.account(alice)).balance).toBe(110);
  });

  it("rejects one player's key reused for another player", async () => {
    await posted(earn(alice, 110, "raid:1"));

    expect(await post(earn(bob, 110, "raid:1"))).toEqual({ status: "rejected", reason: "idempotency_conflict" });
    expect((await ledger.account(bob)).balance).toBe(0);
  });
});

describe("reversals", () => {
  it("removes a reversed earn from the balance and from XP", async () => {
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
    expect(await ledger.account(alice)).toEqual({ playerId: alice, balance: 0, xp: 0 });
  });

  it("returns a reversed spend to the balance", async () => {
    await posted(earn(alice, 110, "raid:1:alice"));
    const spent = await posted(spend(alice, 40, "order:1"));

    await posted({ kind: "reversal", playerId: alice, reverses: spent, idempotencyKey: "undo:order:1" });

    expect(await ledger.account(alice)).toEqual({ playerId: alice, balance: 110, xp: 110 });
  });

  it("leaves the player in debt when reversed Leaf was already spent", async () => {
    const earned = await posted(earn(alice, 110, "raid:1:alice"));
    await posted(spend(alice, 100, "order:1"));

    await posted({ kind: "reversal", playerId: alice, reverses: earned, idempotencyKey: "undo:raid:1:alice" });

    expect(await ledger.account(alice)).toEqual({ playerId: alice, balance: -100, xp: 0 });
    expect(await post(spend(alice, 1, "order:2"))).toEqual({ status: "rejected", reason: "insufficient_leaf" });
  });

  it("treats a retried reversal as a duplicate", async () => {
    const earned = await posted(earn(alice, 110, "raid:1:alice"));
    const undo: Posting = { kind: "reversal", playerId: alice, reverses: earned, idempotencyKey: "undo:raid:1:alice" };
    const first = await posted(undo);

    expect(await post(undo)).toEqual({ status: "duplicate", entry: first });
    expect((await ledger.account(alice)).balance).toBe(0);
  });

  it("rejects a second reversal of the same entry", async () => {
    const earned = await posted(earn(alice, 110, "raid:1:alice"));
    await posted({ kind: "reversal", playerId: alice, reverses: earned, idempotencyKey: "undo:a" });

    const result = await post({ kind: "reversal", playerId: alice, reverses: earned, idempotencyKey: "undo:b" });

    expect(result).toEqual({ status: "rejected", reason: "already_reversed" });
    expect((await ledger.account(alice)).balance).toBe(0);
  });

  it("refuses a reversal that does not match the stored entry", async () => {
    const earned = await posted(earn(alice, 110, "raid:1:alice"));
    const tampered: LedgerEntry = { ...earned, balanceDelta: 500, xpDelta: 500 };

    const refused = await rejection(
      post({ kind: "reversal", playerId: alice, reverses: tampered, idempotencyKey: "undo:raid:1:alice" }),
    );

    expect(Bun.inspect(refused)).toContain("reversal_mismatch");
    expect((await ledger.account(alice)).balance).toBe(110);
  });
});

describe("the ledger table", () => {
  it("refuses to change or delete an entry", async () => {
    const entry = await posted(earn(alice, 110, "raid:1:alice"));

    const update = await rejection(
      ledger.query((sql) => sql`UPDATE ledger_entries SET balance_delta = 999 WHERE id = ${entry.id}`),
    );
    const remove = await rejection(ledger.query((sql) => sql`DELETE FROM ledger_entries WHERE id = ${entry.id}`));

    expect(Bun.inspect(update)).toContain("ledger_append_only");
    expect(Bun.inspect(remove)).toContain("ledger_append_only");
  });

  it("refuses an entry whose deltas do not fit its kind", async () => {
    const refused = await rejection(
      ledger.query(
        (sql) => sql`
          INSERT INTO ledger_entries (player_id, kind, balance_delta, xp_delta, origin, idempotency_key, created_at)
          VALUES (${alice}, 'spend', 50, 0, 'shop', 'bad', ${NOW})
        `,
      ),
    );

    expect(Bun.inspect(refused)).toContain("CHECK constraint failed");
  });

  it("undoes a spend when a later statement in the same transaction fails", async () => {
    await posted(earn(alice, 100, "raid:1:alice"));
    const spendTwice = await rejection(
      ledger.run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const insert = (key: string) => sql`
            INSERT INTO ledger_entries (player_id, kind, balance_delta, xp_delta, origin, idempotency_key, created_at)
            VALUES (${alice}, 'spend', -60, 0, 'shop', ${key}, ${NOW})
          `;
          yield* sql.withTransaction(Effect.all([insert("order:1"), insert("order:2")]));
        }),
      ),
    );

    expect(Bun.inspect(spendTwice)).toContain("insufficient_leaf");

    expect((await ledger.account(alice)).balance).toBe(100);
    expect(await entryCount(alice)).toEqual([{ entries: 1 }]);
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

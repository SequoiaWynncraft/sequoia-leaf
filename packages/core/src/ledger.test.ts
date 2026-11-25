import { describe, expect, it } from "bun:test";

import { leaf } from "./leaf.ts";
import {
  draftEntry,
  InvalidPostingError,
  type LedgerEntry,
  leRateText,
  leTooDear,
  leTooFew,
  REQUEST_KINDS,
  REQUESTS,
  sameDraft,
} from "./ledger.ts";
import { playerId } from "./player.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const bob = playerId("00000000-0000-4000-8000-00000000000b");

function stored(draft: ReturnType<typeof draftEntry>, id: number): LedgerEntry {
  return { ...draft, id, createdAt: 1_000 };
}

describe("draftEntry", () => {
  it("counts earned Leaf toward both the balance and XP", () => {
    const draft = draftEntry({
      kind: "earn",
      playerId: alice,
      amount: leaf(110),
      source: "raid",
      idempotencyKey: "raid:1",
    });

    expect(draft).toMatchObject({
      kind: "earn",
      balanceDelta: 110,
      xpDelta: 110,
      origin: "raid",
      reversesId: null,
    });
  });

  it("takes spent Leaf from the balance and leaves XP alone", () => {
    const draft = draftEntry({
      kind: "spend",
      playerId: alice,
      amount: leaf(40),
      sink: "shop",
      idempotencyKey: "order:1",
    });

    expect(draft).toMatchObject({ kind: "spend", balanceDelta: -40, xpDelta: 0, origin: "shop" });
  });

  it("reverses an earn by removing it from the balance and from XP", () => {
    const earn = stored(
      draftEntry({ kind: "earn", playerId: alice, amount: leaf(110), source: "raid", idempotencyKey: "raid:1" }),
      7,
    );

    const draft = draftEntry({ kind: "reversal", playerId: alice, reverses: earn, idempotencyKey: "undo:raid:1" });

    expect(draft).toMatchObject({
      kind: "reversal",
      balanceDelta: -110,
      xpDelta: -110,
      origin: "raid",
      reversesId: 7,
    });
  });

  it("reverses a spend by returning it to the balance only", () => {
    const spend = stored(
      draftEntry({ kind: "spend", playerId: alice, amount: leaf(40), sink: "shop", idempotencyKey: "order:1" }),
      8,
    );

    const draft = draftEntry({ kind: "reversal", playerId: alice, reverses: spend, idempotencyKey: "undo:order:1" });

    expect(draft).toMatchObject({ balanceDelta: 40, xpDelta: 0, origin: "shop", reversesId: 8 });
  });

  it("refuses to reverse a reversal", () => {
    const earn = stored(
      draftEntry({ kind: "earn", playerId: alice, amount: leaf(5), source: "staff", idempotencyKey: "grant:1" }),
      1,
    );
    const reversal = stored(
      draftEntry({ kind: "reversal", playerId: alice, reverses: earn, idempotencyKey: "undo:grant:1" }),
      2,
    );

    expect(() =>
      draftEntry({ kind: "reversal", playerId: alice, reverses: reversal, idempotencyKey: "undo:undo" }),
    ).toThrow(InvalidPostingError);
  });

  it("refuses to reverse another player's entry", () => {
    const earn = stored(
      draftEntry({ kind: "earn", playerId: alice, amount: leaf(5), source: "staff", idempotencyKey: "grant:1" }),
      1,
    );

    expect(() =>
      draftEntry({ kind: "reversal", playerId: bob, reverses: earn, idempotencyKey: "undo:grant:1" }),
    ).toThrow(InvalidPostingError);
  });
});

describe("earned XP", () => {
  it("grants the XP a posting names instead of the Leaf amount", () => {
    const draft = draftEntry({
      kind: "earn",
      playerId: alice,
      amount: leaf(300),
      xp: 150,
      source: "staff",
      idempotencyKey: "grant:2",
    });

    expect(draft).toMatchObject({ balanceDelta: 300, xpDelta: 150 });
  });

  it("refuses XP that is negative or fractional", () => {
    for (const xp of [-1, 1.5, Number.NaN]) {
      expect(() =>
        draftEntry({ kind: "earn", playerId: alice, amount: leaf(1), xp, source: "staff", idempotencyKey: "grant:3" }),
      ).toThrow(InvalidPostingError);
    }
  });
});

describe("sameDraft", () => {
  const first = draftEntry({
    kind: "earn",
    playerId: alice,
    amount: leaf(110),
    source: "raid",
    idempotencyKey: "raid:1",
  });

  it("treats a repeat of the same fact as the same draft, whatever the memo says", () => {
    const retry = draftEntry({
      kind: "earn",
      playerId: alice,
      amount: leaf(110),
      source: "raid",
      idempotencyKey: "raid:1",
      memo: "retried",
    });

    expect(sameDraft(first, retry)).toBe(true);
  });

  it("tells apart a different amount under the same key", () => {
    const changed = draftEntry({
      kind: "earn",
      playerId: alice,
      amount: leaf(220),
      source: "raid",
      idempotencyKey: "raid:1",
    });

    expect(sameDraft(first, changed)).toBe(false);
  });
});

describe("the guild requests Leaf sells", () => {
  it("sells each request it names, LE among them, under its ledger memo", () => {
    expect(Object.keys(REQUESTS).toSorted()).toEqual(REQUEST_KINDS.toSorted());
    expect(REQUESTS.le).toBe("LE payout");
  });

  it("says LE's rate, and why an amount is not bought, from the backend's numbers", () => {
    const rate = { leafPerLe: 200, minimum: 32 };
    expect(leRateText(rate)).toBe("200 Leaf for 1 LE, at least 32 LE.");
    expect(leTooDear(32, rate, 1234)).toBe("32 LE costs 6,400 Leaf. You have 1,234.");
    expect(leTooFew(rate)).toBe("Ask for at least 32 LE, in whole LE.");
    expect(leRateText({ leafPerLe: 1500, minimum: 10 })).toBe("1,500 Leaf for 1 LE, at least 10 LE.");
  });
});

import { describe, expect, it } from "bun:test";

import { MAX_LEAF } from "./leaf.ts";
import {
  autoConfirmsAt,
  buyRefusal,
  checkListing,
  checkTerms,
  listingExpiresAt,
  listingStatus,
  type OrderAction,
  orderMove,
  type OrderRole,
  type OrderState,
  type OrderStep,
  orderTotals,
  quantityAllowed,
  settlementOf,
} from "./market.ts";
import { playerId } from "./player.ts";
import { DAY_MS } from "./quests.ts";
import { DEFAULT_RULES } from "./rules.ts";

const rules = DEFAULT_RULES.market;
const seller = playerId("00000000-0000-4000-8000-00000000000a");
const buyer = playerId("00000000-0000-4000-8000-00000000000b");

const listing = { kind: "item", title: "Stack of crafted potions", description: "", price: 500, quantity: 1 } as const;

describe("a listing", () => {
  it("is stored with its text trimmed", () => {
    expect(checkListing({ ...listing, title: "  Raid carry  ", description: " Any raid. " }, rules)).toEqual({
      ok: true,
      listing: { ...listing, title: "Raid carry", description: "Any raid." },
    });
  });

  it("takes a title of 3 to 80 characters", () => {
    expect(["ab", "  ab  ", "x".repeat(81)].map((title) => checkListing({ ...listing, title }, rules))).toEqual([
      { ok: false, problem: "title" },
      { ok: false, problem: "title" },
      { ok: false, problem: "title" },
    ]);
    expect(checkListing({ ...listing, title: "x".repeat(80) }, rules).ok).toBe(true);
  });

  it("takes a description up to 1,000 characters", () => {
    expect(checkListing({ ...listing, description: "x".repeat(1001) }, rules)).toEqual({
      ok: false,
      problem: "description",
    });
  });

  it("costs a whole 1 to 1,000,000 Leaf a unit, and offers 1 to 64 units", () => {
    expect([0, 1.5, 1_000_001].map((price) => checkTerms({ price }, rules))).toEqual(["price", "price", "price"]);
    expect(checkTerms({ price: 1_000_000 }, rules)).toBeUndefined();
    expect([0, 1, 64, 65, 2.5].map((quantity) => quantityAllowed(quantity, rules))).toEqual([
      false,
      true,
      true,
      false,
      false,
    ]);
  });

  it("can never hold more Leaf in one order than one ledger entry can move", () => {
    expect(rules.price.max * rules.quantity.max).toBeLessThanOrEqual(MAX_LEAF);
  });

  it("takes orders for 14 days", () => {
    expect(listingExpiresAt(1_000, rules)).toBe(1_000 + 14 * DAY_MS);
  });

  it("is withdrawn before it is expired, and expired before it is sold out", () => {
    const stored = { withdrawnAt: null, expiresAt: 10_000, quantity: 2 };

    expect(listingStatus(stored, 1, 5_000)).toBe("open");
    expect(listingStatus(stored, 2, 5_000)).toBe("sold_out");
    expect(listingStatus(stored, 2, 10_000)).toBe("expired");
    expect(listingStatus({ ...stored, withdrawnAt: 4_000 }, 2, 10_000)).toBe("withdrawn");
  });
});

describe("buying", () => {
  const open = { sellerId: seller, price: 500, status: "open" } as const;

  it("is allowed from someone else's open listing at the price the buyer agreed to", () => {
    expect(buyRefusal(open, 1, buyer, 1, 500)).toBeUndefined();
  });

  it("is refused from the buyer's own listing", () => {
    expect(buyRefusal(open, 1, seller, 1, 500)).toBe("own_listing");
  });

  it("is refused from a withdrawn or expired listing", () => {
    expect(buyRefusal({ ...open, status: "withdrawn" }, 1, buyer, 1, 500)).toBe("listing_closed");
    expect(buyRefusal({ ...open, status: "expired" }, 1, buyer, 1, 500)).toBe("listing_closed");
  });

  it("is refused for more units than are left", () => {
    expect(buyRefusal(open, 1, buyer, 2, 500)).toBe("sold_out");
  });

  it("is refused when the price changed since the buyer looked", () => {
    expect(buyRefusal(open, 1, buyer, 1, 400)).toBe("price_changed");
  });

  it("holds the price of every unit, and pays the seller all of it while the fee is 0", () => {
    expect(orderTotals(500, 3, rules)).toEqual({ leaf: 1500, fee: 0 });
    expect(orderTotals(333, 1, { ...rules, fee: 500 })).toEqual({ leaf: 333, fee: 16 });
  });
});

/** An order in a state, having taken these steps after it was placed. */
function at(state: OrderState, ...steps: OrderStep[]) {
  return { state, steps: new Set<OrderStep>(["placed", ...steps]) };
}

function move(order: ReturnType<typeof at>, action: OrderAction, role: OrderRole) {
  return orderMove(order, action, role);
}

describe("an order", () => {
  it("is delivered by the seller, then confirmed by the buyer, which pays the seller", () => {
    expect(move(at("placed"), "deliver", "seller")).toEqual({ kind: "move", to: "delivered", step: "delivered" });
    expect(move(at("delivered", "delivered"), "confirm", "buyer")).toEqual({
      kind: "move",
      to: "completed",
      step: "confirmed",
    });
    expect(settlementOf("confirmed")).toBe("pay_seller");
  });

  it("can be confirmed by the buyer before the seller marks it delivered", () => {
    expect(move(at("placed"), "confirm", "buyer")).toMatchObject({ kind: "move", to: "completed" });
  });

  it("can be cancelled by either side before delivery, which refunds the buyer", () => {
    expect(move(at("placed"), "cancel", "buyer")).toEqual({ kind: "move", to: "cancelled", step: "cancelled" });
    expect(move(at("placed"), "cancel", "seller")).toMatchObject({ kind: "move", to: "cancelled" });
    expect(settlementOf("cancelled")).toBe("refund_buyer");
  });

  it("can't be cancelled once delivered: the buyer disputes it instead", () => {
    expect(move(at("delivered", "delivered"), "cancel", "buyer")).toEqual({
      kind: "refused",
      reason: "already_delivered",
    });
    expect(move(at("delivered", "delivered"), "dispute", "buyer")).toEqual({
      kind: "move",
      to: "disputed",
      step: "disputed",
    });
  });

  it("can't be disputed before delivery", () => {
    expect(move(at("placed"), "dispute", "buyer")).toEqual({ kind: "refused", reason: "not_delivered" });
  });

  it("is settled by staff either way once disputed, and only then", () => {
    const disputed = at("disputed", "delivered", "disputed");

    expect(move(disputed, "release", "staff")).toEqual({ kind: "move", to: "completed", step: "released" });
    expect(move(disputed, "refund", "staff")).toEqual({ kind: "move", to: "refunded", step: "refunded" });
    expect(move(at("delivered", "delivered"), "release", "staff")).toEqual({ kind: "refused", reason: "not_disputed" });
    expect([settlementOf("released"), settlementOf("refunded")]).toEqual(["pay_seller", "refund_buyer"]);
  });

  it("lets the buyer withdraw their dispute by confirming", () => {
    expect(move(at("disputed", "delivered", "disputed"), "confirm", "buyer")).toMatchObject({ to: "completed" });
  });

  it("confirms itself only once delivered and not disputed", () => {
    expect(move(at("delivered", "delivered"), "auto_confirm", "system")).toEqual({
      kind: "move",
      to: "completed",
      step: "auto_confirmed",
    });
    expect(move(at("disputed", "delivered", "disputed"), "auto_confirm", "system")).toMatchObject({
      kind: "refused",
    });
    expect(autoConfirmsAt({ state: "delivered", deliveredAt: 1_000 }, rules)).toBe(1_000 + 7 * DAY_MS);
    expect(autoConfirmsAt({ state: "disputed", deliveredAt: 1_000 }, rules)).toBeNull();
  });

  it("takes each action only from the side whose it is", () => {
    expect(move(at("placed"), "deliver", "buyer")).toEqual({ kind: "refused", reason: "not_seller" });
    expect(move(at("delivered", "delivered"), "confirm", "seller")).toEqual({ kind: "refused", reason: "not_buyer" });
    expect(move(at("delivered", "delivered"), "dispute", "seller")).toEqual({ kind: "refused", reason: "not_buyer" });
    expect(move(at("disputed", "delivered", "disputed"), "release", "buyer")).toEqual({
      kind: "refused",
      reason: "not_staff",
    });
  });

  it("answers an action taken before as a repeat, so a retry pays or refunds nothing more", () => {
    const completed = at("completed", "delivered", "confirmed");

    expect(move(at("delivered", "delivered"), "deliver", "seller")).toEqual({ kind: "repeat" });
    expect(move(completed, "confirm", "buyer")).toEqual({ kind: "repeat" });
    expect(move(completed, "auto_confirm", "system")).toEqual({ kind: "repeat" });
    expect(move(at("cancelled", "cancelled"), "cancel", "seller")).toEqual({ kind: "repeat" });
    expect(move(at("refunded", "delivered", "disputed", "refunded"), "refund", "staff")).toEqual({ kind: "repeat" });
  });

  it("refuses anything new once it is closed", () => {
    expect(move(at("cancelled", "cancelled"), "deliver", "seller")).toEqual({
      kind: "refused",
      reason: "order_closed",
    });
    expect(move(at("cancelled", "cancelled"), "confirm", "buyer")).toEqual({ kind: "refused", reason: "order_closed" });
    expect(move(at("completed", "delivered", "confirmed"), "cancel", "buyer")).toEqual({
      kind: "refused",
      reason: "order_closed",
    });
    expect(move(at("refunded", "delivered", "disputed", "refunded"), "release", "staff")).toEqual({
      kind: "refused",
      reason: "order_closed",
    });
  });
});

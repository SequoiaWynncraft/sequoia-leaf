import {
  type BuyRefusal,
  buyRefusal,
  DAY_MS,
  leaf,
  listingExpiresAt,
  type ListingInput,
  listingStatus,
  type MarketRules,
  type OrderAction,
  orderMove,
  type OrderRefusal,
  type OrderRole,
  type OrderStep,
  orderTotals,
  type PlayerId,
  settlementOf,
} from "@sequoia-leaf/core";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";

import { Events, type MarketEvent } from "../events/store.ts";
import type { Visitor } from "../grove/actions.ts";
import { Ledger } from "../ledger/store.ts";
import { orderJson } from "./json.ts";
import { type Listing, Market, type Order } from "./store.ts";

// What members do in the marketplace. Each action is one transaction. Creating a
// listing and buying name the client's request, so a request sent twice does what
// it does once; every other action names the step it takes, which an order takes
// at most once, so sending it again changes nothing.

/** Why the marketplace refuses a request. Nothing is written when it does. */
export type MarketRefusal =
  | BuyRefusal
  | OrderRefusal
  /** The balance doesn't cover the order. */
  | "insufficient_leaf"
  /** The request id was used before for a different request. */
  | "request_conflict"
  /** No such listing. */
  | "listing_not_found"
  /** No such order, or one the member is not a side of. */
  | "order_not_found"
  /** A listing's terms can't change while an order on it is open. */
  | "has_open_orders"
  /** The seller has as many listings taking orders as they may. */
  | "too_many_listings"
  /** Staff can't settle a dispute they are a side of. */
  | "own_order";

export type Refused = { readonly status: "refused"; readonly reason: MarketRefusal };

const refused = (reason: MarketRefusal): Refused => ({ status: "refused", reason });

/** The event each step tells both sides of the order. */
const STEP_EVENT: Record<OrderStep, MarketEvent["type"]> = {
  placed: "market.order_placed",
  delivered: "market.delivered",
  confirmed: "market.completed",
  auto_confirmed: "market.completed",
  cancelled: "market.cancelled",
  disputed: "market.disputed",
  released: "market.resolved",
  refunded: "market.resolved",
};

/** The ledger keys of an order's held Leaf, its payment to the seller and its refund. */
export const holdKey = (orderId: number) => `market_hold:${orderId}`;
const saleKey = (orderId: number) => `market_sale:${orderId}`;
const refundKey = (orderId: number) => `undo:${holdKey(orderId)}`;

/**
 * Lists an item or a service. The listing must be one `checkListing` takes. A
 * request sent again answers with the listing it made.
 */
export const createListing = Effect.fn("createListing")(function* (
  seller: Visitor,
  requestId: string,
  input: ListingInput,
  now: number,
  rules: MarketRules,
) {
  const sql = yield* SqlClient.SqlClient;
  const market = yield* Market;
  return yield* sql
    .withTransaction(
      Effect.gen(function* () {
        const earlier = yield* market.listingFor(seller.playerId, requestId);
        if (earlier !== undefined) {
          // Its terms may have changed since; what it is can't have.
          const same =
            earlier.kind === input.kind && earlier.title === input.title && earlier.quantity === input.quantity;
          return same ? listed(earlier) : refused("request_conflict");
        }
        if ((yield* market.openListingsOf(seller.playerId, now)) >= rules.maxOpenListings) {
          return refused("too_many_listings");
        }
        const id = yield* market.createListing(seller, requestId, input, listingExpiresAt(now, rules), now);
        return listed(yield* found(market.listing(id)));
      }),
    )
    .pipe(Effect.orDie);
});

/**
 * Changes a listing's price or description. Only the seller can, only while it
 * takes orders, and only while no order on it is open, so nobody is held to
 * terms they didn't agree to. Asking for the terms it already has changes nothing.
 */
export const editListing = Effect.fn("editListing")(function* (
  seller: Visitor,
  id: number,
  terms: { readonly price?: number | undefined; readonly description?: string | undefined },
  now: number,
) {
  const sql = yield* SqlClient.SqlClient;
  const market = yield* Market;
  return yield* sql
    .withTransaction(
      Effect.gen(function* () {
        const listing = yield* market.listing(id);
        if (listing === undefined) {
          return refused("listing_not_found");
        }
        if (listing.sellerId !== seller.playerId) {
          return refused("not_seller");
        }
        const status = listingStatus(listing, listing.taken, now);
        if (status === "withdrawn" || status === "expired") {
          return refused("listing_closed");
        }
        const wanted = {
          price: terms.price ?? listing.price,
          description: terms.description?.trim() ?? listing.description,
        };
        if (wanted.price === listing.price && wanted.description === listing.description) {
          return listed(listing);
        }
        if (listing.openOrders > 0) {
          return refused("has_open_orders");
        }
        yield* market.editListing(id, wanted, seller, now);
        return listed(yield* found(market.listing(id)));
      }),
    )
    .pipe(Effect.orDie);
});

/** Stops a listing taking orders. Orders already open on it carry on. Withdrawing it again changes nothing. */
export const withdrawListing = Effect.fn("withdrawListing")(function* (seller: Visitor, id: number, now: number) {
  const sql = yield* SqlClient.SqlClient;
  const market = yield* Market;
  return yield* sql
    .withTransaction(
      Effect.gen(function* () {
        const listing = yield* market.listing(id);
        if (listing === undefined) {
          return refused("listing_not_found");
        }
        if (listing.sellerId !== seller.playerId) {
          return refused("not_seller");
        }
        if (listing.withdrawnAt === null) {
          yield* market.withdrawListing(id, seller.playerId, now);
        }
        return listed(yield* found(market.listing(id)));
      }),
    )
    .pipe(Effect.orDie);
});

/**
 * Buys units of a listing at the unit price the buyer agreed to. Their Leaf is
 * held through the ledger, sink `market_hold`, keyed by the order, until the
 * seller is paid or they are refunded. Both sides are told. A request sent
 * again answers with the order it placed.
 */
export const buyListing = Effect.fn("buyListing")(function* (
  buyer: Visitor,
  listingId: number,
  quantity: number,
  agreedPrice: number,
  requestId: string,
  now: number,
  rules: MarketRules,
) {
  const sql = yield* SqlClient.SqlClient;
  const market = yield* Market;
  const ledger = yield* Ledger;
  return yield* sql
    .withTransaction(
      Effect.gen(function* () {
        const earlier = yield* market.orderFor(buyer.playerId, requestId);
        if (earlier !== undefined) {
          const same =
            earlier.listingId === listingId && earlier.quantity === quantity && earlier.price === agreedPrice;
          return same ? ordered(earlier) : refused("request_conflict");
        }
        const listing = yield* market.listing(listingId);
        if (listing === undefined) {
          return refused("listing_not_found");
        }
        const status = listingStatus(listing, listing.taken, now);
        const refusal = buyRefusal(
          { ...listing, status },
          listing.quantity - listing.taken,
          buyer.playerId,
          quantity,
          agreedPrice,
        );
        if (refusal !== undefined) {
          return refused(refusal);
        }
        const totals = orderTotals(listing.price, quantity, rules);
        // The transaction holds the database's write lock, so the balance can't change before the hold.
        if ((yield* ledger.account(buyer.playerId)).balance < totals.leaf) {
          return refused("insufficient_leaf");
        }
        const id = yield* market.placeOrder({ listing, buyer, requestId, quantity, ...totals }, now);
        const held = yield* ledger.post(
          {
            kind: "spend",
            playerId: buyer.playerId,
            amount: leaf(totals.leaf),
            sink: "market_hold",
            idempotencyKey: holdKey(id),
            memo: `${quantity} × ${listing.title}`,
          },
          now,
        );
        if (held.status !== "posted") {
          return yield* Effect.die(new Error(`Order ${id}'s hold was not posted: ${JSON.stringify(held)}`));
        }
        const order = yield* found(market.order(id));
        yield* tellBoth(order, "placed", now, rules);
        return ordered(order);
      }),
    )
    .pipe(Effect.orDie);
});

/** Who is asking about an order: one of its sides, staff settling it, or Leaf itself. */
export type OrderActor =
  | { readonly kind: "member"; readonly playerId: PlayerId }
  | { readonly kind: "staff"; readonly playerId: PlayerId }
  | { readonly kind: "system" };

/**
 * Takes an action on an order: the seller delivers, the buyer confirms or
 * disputes, either side cancels, staff release or refund a dispute. Paying
 * the seller is an earn with source `market_sale`, keyed by the order, which
 * grants no XP; refunding the buyer reverses the hold. Both are keyed by the
 * order, and the order takes each step once, so neither can happen twice. Both
 * sides are told. An action taken before answers with the order as it is.
 */
export const actOnOrder = Effect.fn("actOnOrder")(function* (
  actor: OrderActor,
  id: number,
  action: OrderAction,
  note: string | null,
  now: number,
  rules: MarketRules,
) {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(applyAction(actor, id, action, note, now, rules)).pipe(Effect.orDie);
});

/**
 * Confirms, for the buyer, every delivered order nobody disputed within
 * `autoConfirmDays` of delivery, each in its own transaction, so held Leaf
 * never waits on a buyer who forgot. Answers how many it confirmed.
 */
export const autoConfirmOrders = Effect.fn("autoConfirmOrders")(function* (now: number, rules: MarketRules) {
  const sql = yield* SqlClient.SqlClient;
  const market = yield* Market;
  const due = yield* market.deliveredBy(now - rules.autoConfirmDays * DAY_MS, 100);
  let confirmed = 0;
  for (const id of due) {
    const result = yield* sql
      .withTransaction(applyAction({ kind: "system" }, id, "auto_confirm", null, now, rules))
      .pipe(Effect.orDie);
    if (result.status === "ordered" && result.order.state === "completed") {
      confirmed += 1;
    }
  }
  return confirmed;
});

const applyAction = (
  actor: OrderActor,
  id: number,
  action: OrderAction,
  note: string | null,
  now: number,
  rules: MarketRules,
) =>
  Effect.gen(function* () {
    const market = yield* Market;
    const order = yield* market.order(id);
    if (order === undefined) {
      return refused("order_not_found");
    }
    const role = roleOf(actor, order);
    if (role === undefined) {
      return refused("order_not_found");
    }
    if (role === "staff" && actor.kind === "staff" && isSide(actor.playerId, order)) {
      return refused("own_order");
    }
    const move = orderMove(order, action, role);
    if (move.kind === "repeat") {
      return ordered(order);
    }
    if (move.kind === "refused") {
      return refused(move.reason);
    }
    const playerActor = actor.kind === "system" ? null : actor.playerId;
    yield* market.moveOrder(id, move.to, move.step, { role, actor: playerActor, note }, now);
    yield* settle(order, move.step, playerActor, now);
    const moved = yield* found(market.order(id));
    yield* tellBoth(moved, move.step, now, rules);
    return ordered(moved);
  });

/** Pays the seller or refunds the buyer, as the step calls for. */
const settle = Effect.fnUntraced(function* (order: Order, step: OrderStep, actor: PlayerId | null, now: number) {
  const ledger = yield* Ledger;
  const settlement = settlementOf(step);
  const optional = actor === null ? {} : { actor };
  if (settlement === "pay_seller") {
    const paid = yield* ledger.post(
      {
        kind: "earn",
        playerId: order.sellerId,
        amount: leaf(order.leaf - order.fee),
        // Leaf passed on from a buyer is not guild activity, so it levels nobody.
        xp: 0,
        source: "market_sale",
        idempotencyKey: saleKey(order.id),
        memo: `${order.quantity} × ${order.title}`,
        ...optional,
      },
      now,
    );
    if (paid.status === "rejected") {
      return yield* Effect.die(new Error(`Order ${order.id}'s sale was refused: ${paid.reason}`));
    }
  }
  if (settlement === "refund_buyer") {
    const hold = yield* ledger.entry(holdKey(order.id));
    if (hold === undefined) {
      return yield* Effect.die(new Error(`Order ${order.id} has no hold to refund`));
    }
    const refunded = yield* ledger.post(
      { kind: "reversal", playerId: order.buyerId, reverses: hold, idempotencyKey: refundKey(order.id), ...optional },
      now,
    );
    if (refunded.status === "rejected") {
      return yield* Effect.die(new Error(`Order ${order.id}'s refund was refused: ${refunded.reason}`));
    }
  }
});

function isSide(playerId: PlayerId, order: Order): boolean {
  return order.buyerId === playerId || order.sellerId === playerId;
}

/** The part someone plays in an order, or undefined when they have none, so it isn't theirs to see. */
function roleOf(actor: OrderActor, order: Order): OrderRole | undefined {
  switch (actor.kind) {
    case "system":
      return "system";
    case "staff":
      return "staff";
    case "member":
      return order.buyerId === actor.playerId ? "buyer" : order.sellerId === actor.playerId ? "seller" : undefined;
  }
}

/** Tells both sides of an order what a step did to it. */
const tellBoth = Effect.fnUntraced(function* (order: Order, step: OrderStep, now: number, rules: MarketRules) {
  const events = yield* Events;
  const event: MarketEvent = { type: STEP_EVENT[step], data: { order: orderJson(order, rules) } };
  yield* events.insert(order.buyerId, event, now);
  yield* events.insert(order.sellerId, event, now);
});

/** A row just written or read in the same transaction, which must be there. */
const found = <A>(effect: Effect.Effect<A | undefined>) =>
  effect.pipe(
    Effect.flatMap((value) =>
      value === undefined
        ? Effect.die(new Error("A marketplace row vanished inside its transaction"))
        : Effect.succeed(value),
    ),
  );

function listed(listing: Listing) {
  return { status: "listed" as const, listing };
}

function ordered(order: Order) {
  return { status: "ordered" as const, order };
}

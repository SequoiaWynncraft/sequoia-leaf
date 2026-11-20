import { Effect } from "effect";

import { TradeForbidden, TradeMissing, TradeRefused } from "../api/errors.ts";
import type { ConversionRefusal } from "../conversions/actions.ts";
import type { MarketRefusal } from "../market/actions.ts";

// How the marketplace and conversions answer a refusal: the class for its status,
// with a message for people. Clients branch on the code.

type Reason = Exclude<MarketRefusal | ConversionRefusal, "not_staff">;

const MESSAGES: Record<Reason, string> = {
  insufficient_leaf: "You don't have enough Leaf for that",
  request_conflict: "That request id was already used for something else. Send a new one",
  own_listing: "That's your own listing",
  listing_closed: "That listing no longer takes orders",
  sold_out: "There aren't that many left",
  price_changed: "The price changed since you looked. Look again",
  has_open_orders: "A listing's terms can't change while an order on it is open",
  too_many_listings: "You have as many listings taking orders as you can. Withdraw one first",
  already_delivered: "It was delivered, so it can't be cancelled. Dispute it if you didn't get it",
  not_delivered: "It wasn't delivered yet. Cancel it instead",
  not_disputed: "Only a disputed order is settled by staff",
  order_closed: "That order is already completed, cancelled or refunded",
  member_limit: "You've claimed as much of that as one member can this month",
  not_pending: "That claim was already paid, declined or cancelled",
  not_due: "That claim's month hasn't come yet",
  not_seller: "Only the seller can do that",
  not_buyer: "Only the buyer can do that",
  own_order: "Staff can't settle an order they are a side of",
  own_claim: "Staff can't pay their own claim",
  listing_not_found: "No such listing",
  order_not_found: "No such order",
  conversion_not_found: "No such claim",
};

/** The error a refusal answers with. Staff-only steps are reached only through staff routes, so asking otherwise is a bug. */
export function tradeError(reason: MarketRefusal | ConversionRefusal) {
  if (reason === "not_staff") {
    return Effect.die(new Error("A staff step was asked without staff"));
  }
  const message = MESSAGES[reason];
  switch (reason) {
    case "listing_not_found":
    case "order_not_found":
    case "conversion_not_found":
      return Effect.fail(new TradeMissing({ code: reason, message }));
    case "not_seller":
    case "not_buyer":
    case "own_order":
    case "own_claim":
      return Effect.fail(new TradeForbidden({ code: reason, message }));
    case "insufficient_leaf":
    case "request_conflict":
    case "own_listing":
    case "listing_closed":
    case "sold_out":
    case "price_changed":
    case "has_open_orders":
    case "too_many_listings":
    case "already_delivered":
    case "not_delivered":
    case "not_disputed":
    case "order_closed":
    case "member_limit":
    case "not_pending":
    case "not_due":
      return Effect.fail(new TradeRefused({ code: reason, message }));
  }
}

/** A page of a list that is newest first: the rows asked for, and where the next page starts, or null on the last. */
export function pageOf<A extends { readonly id: number }>(rows: readonly A[], limit: number) {
  const page = rows.slice(0, limit);
  return { page, next: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
}

/** How many a page holds when the client doesn't say. */
export const PAGE = 50;

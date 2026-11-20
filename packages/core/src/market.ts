import { MAX_LEAF } from "./leaf.ts";
import type { PlayerId } from "./player.ts";
import { DAY_MS } from "./quests.ts";

// The member marketplace: members list in-game items and services for Leaf. A
// buyer's Leaf is held from the moment they buy until they have what they paid
// for, then released to the seller; either side can back out before delivery,
// and staff settle a dispute. The numbers are data (`MarketRules`, set in
// rules.ts); these functions decide what is allowed, and the server makes it so.

/** What a listing offers: an in-game item, or a service such as a raid carry. */
export const LISTING_KINDS = ["item", "service"] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

/** A fee is a whole number out of this many of the Leaf an order holds. */
export const FEE_SCALE = 10_000;

export interface MarketRules {
  /** A listing takes orders for this many days after it is made. */
  readonly listingDays: number;
  /** A delivered order nobody disputes is confirmed for the buyer this many days after delivery. */
  readonly autoConfirmDays: number;
  /** The share of an order's Leaf the seller is not paid, out of `FEE_SCALE`. It leaves circulation. */
  readonly fee: number;
  /** Characters a listing's title may have, after trimming. */
  readonly title: { readonly min: number; readonly max: number };
  /** Characters a listing's description may have, after trimming. */
  readonly description: { readonly max: number };
  /** The Leaf one unit may cost. */
  readonly price: { readonly min: number; readonly max: number };
  /** The most units one listing may offer, and so one order buy. */
  readonly quantity: { readonly max: number };
  /** Listings a seller may have taking orders at once. */
  readonly maxOpenListings: number;
  /** Characters a dispute's reason or a staff member's note may have. */
  readonly note: { readonly max: number };
  /** The guild feed counts new listings once per this many milliseconds, never one by one. */
  readonly digestMs: number;
}

// ---------------------------------------------------------------------------------------------
// Listings.

/** What a seller sends for a listing. */
export interface ListingInput {
  readonly kind: ListingKind;
  readonly title: string;
  readonly description: string;
  readonly price: number;
  readonly quantity: number;
}

/** What is wrong with a listing, by the field. */
export type ListingProblem = "title" | "description" | "price" | "quantity";

export type ListingCheck =
  { readonly ok: true; readonly listing: ListingInput } | { readonly ok: false; readonly problem: ListingProblem };

/** A listing as it would be stored, its text trimmed, or the first field the rules don't take. */
export function checkListing(input: ListingInput, rules: MarketRules): ListingCheck {
  const title = input.title.trim();
  const description = input.description.trim();
  if (title.length < rules.title.min || title.length > rules.title.max) {
    return { ok: false, problem: "title" };
  }
  const problem =
    checkTerms({ description, price: input.price }, rules) ??
    (quantityAllowed(input.quantity, rules) ? undefined : "quantity");
  return problem === undefined ? { ok: true, listing: { ...input, title, description } } : { ok: false, problem };
}

/** What is wrong with a listing's terms, which a seller may change: its description and price. */
export function checkTerms(
  terms: { readonly description?: string | undefined; readonly price?: number | undefined },
  rules: MarketRules,
): "description" | "price" | undefined {
  if (terms.description !== undefined && terms.description.trim().length > rules.description.max) {
    return "description";
  }
  if (terms.price !== undefined && !wholeBetween(terms.price, rules.price.min, rules.price.max)) {
    return "price";
  }
  return undefined;
}

/** Whether a listing may offer, or an order buy, this many units. */
export function quantityAllowed(quantity: number, rules: MarketRules): boolean {
  return wholeBetween(quantity, 1, rules.quantity.max);
}

function wholeBetween(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max && value <= MAX_LEAF;
}

/** When a listing made at `createdAt` stops taking orders. */
export function listingExpiresAt(createdAt: number, rules: MarketRules): number {
  return createdAt + rules.listingDays * DAY_MS;
}

/**
 * Where a listing stands. Withdrawn wins over expired, expired over sold out:
 * a listing that is sold out but still open may take orders again when one is
 * cancelled.
 */
export type ListingStatus = "open" | "sold_out" | "expired" | "withdrawn";

export function listingStatus(
  listing: { readonly withdrawnAt: number | null; readonly expiresAt: number; readonly quantity: number },
  taken: number,
  now: number,
): ListingStatus {
  if (listing.withdrawnAt !== null) {
    return "withdrawn";
  }
  if (now >= listing.expiresAt) {
    return "expired";
  }
  return taken >= listing.quantity ? "sold_out" : "open";
}

/** Why a member can't buy from a listing. */
export type BuyRefusal =
  /** It is their own listing. */
  | "own_listing"
  /** It was withdrawn or has expired. */
  | "listing_closed"
  /** Fewer units are left than they asked for. */
  | "sold_out"
  /** The price is not the one they agreed to: the seller changed it since they looked. */
  | "price_changed";

/**
 * Whether a member may buy `quantity` units of a listing at the unit price
 * they agreed to. `remaining` is what is left after the orders that stand.
 */
export function buyRefusal(
  listing: { readonly sellerId: PlayerId; readonly price: number; readonly status: ListingStatus },
  remaining: number,
  buyer: PlayerId,
  quantity: number,
  agreedPrice: number,
): BuyRefusal | undefined {
  if (listing.sellerId === buyer) {
    return "own_listing";
  }
  if (listing.status === "withdrawn" || listing.status === "expired") {
    return "listing_closed";
  }
  if (remaining < quantity) {
    return "sold_out";
  }
  return listing.price === agreedPrice ? undefined : "price_changed";
}

/** What an order holds of the buyer's Leaf, and how it splits between the seller and the fee. */
export function orderTotals(
  price: number,
  quantity: number,
  rules: MarketRules,
): { readonly leaf: number; readonly fee: number } {
  const leaf = price * quantity;
  const share = Math.max(0, Math.min(FEE_SCALE, Math.floor(rules.fee)));
  return { leaf, fee: Math.floor((leaf * share) / FEE_SCALE) };
}

// ---------------------------------------------------------------------------------------------
// Orders.

/**
 * Where an order stands:
 * - `placed`: the buyer's Leaf is held and the seller is to deliver.
 * - `delivered`: the seller says they delivered; the buyer confirms, or disputes.
 * - `disputed`: the buyer says they didn't get it; staff decide.
 * - `completed`: the seller was paid. Final.
 * - `cancelled`: backed out before delivery; the buyer was refunded. Final.
 * - `refunded`: staff refunded the buyer after a dispute. Final.
 */
export const ORDER_STATES = ["placed", "delivered", "disputed", "completed", "cancelled", "refunded"] as const;
export type OrderState = (typeof ORDER_STATES)[number];

/** Each thing that happened to an order. Each happens at most once, which is what makes a retry safe. */
export const ORDER_STEPS = [
  "placed",
  "delivered",
  "confirmed",
  "auto_confirmed",
  "cancelled",
  "disputed",
  "released",
  "refunded",
] as const;
export type OrderStep = (typeof ORDER_STEPS)[number];

/** Who takes a step: one of the two sides, staff settling a dispute, or Leaf itself. */
export const ORDER_ROLES = ["buyer", "seller", "staff", "system"] as const;
export type OrderRole = (typeof ORDER_ROLES)[number];

/** What someone asks of an order. */
export type OrderAction = "deliver" | "confirm" | "cancel" | "dispute" | "release" | "refund" | "auto_confirm";

/** Why an order can't take an action. Nothing changes when it can't. */
export type OrderRefusal =
  /** Only the seller delivers. */
  | "not_seller"
  /** Only the buyer confirms or disputes; only the two sides cancel. */
  | "not_buyer"
  /** Only staff settle a dispute, and only Leaf confirms on its own. */
  | "not_staff"
  /** It was delivered, so it can no longer be cancelled; the buyer can dispute it instead. */
  | "already_delivered"
  /** It was not delivered yet, so there is nothing to dispute: cancel it instead. */
  | "not_delivered"
  /** Staff settle only a disputed order. */
  | "not_disputed"
  /** It is completed, cancelled or refunded. */
  | "order_closed";

export type OrderMove =
  /** The action moves the order to `to`, recording `step`. */
  | { readonly kind: "move"; readonly to: OrderState; readonly step: OrderStep }
  /** The action was taken before, or what it asks for already happened: answer the order as it is. */
  | { readonly kind: "repeat" }
  | { readonly kind: "refused"; readonly reason: OrderRefusal };

const ACTION: Record<
  OrderAction,
  { readonly step: OrderStep; readonly by: readonly OrderRole[]; readonly refusal: OrderRefusal }
> = {
  deliver: { step: "delivered", by: ["seller"], refusal: "not_seller" },
  confirm: { step: "confirmed", by: ["buyer"], refusal: "not_buyer" },
  cancel: { step: "cancelled", by: ["buyer", "seller"], refusal: "not_buyer" },
  dispute: { step: "disputed", by: ["buyer"], refusal: "not_buyer" },
  release: { step: "released", by: ["staff"], refusal: "not_staff" },
  refund: { step: "refunded", by: ["staff"], refusal: "not_staff" },
  auto_confirm: { step: "auto_confirmed", by: ["system"], refusal: "not_staff" },
};

const CLOSED: ReadonlySet<OrderState> = new Set(["completed", "cancelled", "refunded"]);

function refused(reason: OrderRefusal): OrderMove {
  return { kind: "refused", reason };
}

/**
 * What an action by someone in `role` does to an order, from where it stands
 * and the steps it took. The buyer may confirm at any point before the order
 * closes, even before delivery or while disputing it: it only releases their
 * own Leaf. An action that already happened, such as a retried delivery or a
 * confirmation after the order was paid out, is a repeat and changes nothing.
 */
export function orderMove(
  order: { readonly state: OrderState; readonly steps: ReadonlySet<OrderStep> },
  action: OrderAction,
  role: OrderRole,
): OrderMove {
  const { step, by, refusal } = ACTION[action];
  if (!by.includes(role)) {
    return refused(refusal);
  }
  const { state, steps } = order;
  const done =
    action === "confirm" || action === "auto_confirm"
      ? state === "completed"
      : action === "cancel"
        ? state === "cancelled"
        : steps.has(step);
  if (done) {
    return { kind: "repeat" };
  }
  if (CLOSED.has(state)) {
    return refused("order_closed");
  }
  switch (action) {
    case "deliver":
      return state === "placed" ? { kind: "move", to: "delivered", step } : refused("order_closed");
    case "confirm":
      return { kind: "move", to: "completed", step };
    case "cancel":
      return state === "placed" ? { kind: "move", to: "cancelled", step } : refused("already_delivered");
    case "dispute":
      return state === "delivered" ? { kind: "move", to: "disputed", step } : refused("not_delivered");
    case "release":
      return state === "disputed" ? { kind: "move", to: "completed", step } : refused("not_disputed");
    case "refund":
      return state === "disputed" ? { kind: "move", to: "refunded", step } : refused("not_disputed");
    case "auto_confirm":
      return state === "delivered" ? { kind: "move", to: "completed", step } : refused("not_delivered");
  }
}

/** What a step does with the held Leaf: pays the seller, refunds the buyer, or leaves it held. */
export function settlementOf(step: OrderStep): "pay_seller" | "refund_buyer" | undefined {
  switch (step) {
    case "confirmed":
    case "auto_confirmed":
    case "released":
      return "pay_seller";
    case "cancelled":
    case "refunded":
      return "refund_buyer";
    case "placed":
    case "delivered":
    case "disputed":
      return undefined;
  }
}

/** When a delivered order confirms itself, or null when it isn't waiting on that. */
export function autoConfirmsAt(
  order: { readonly state: OrderState; readonly deliveredAt: number | null },
  rules: MarketRules,
): number | null {
  return order.state === "delivered" && order.deliveredAt !== null
    ? order.deliveredAt + rules.autoConfirmDays * DAY_MS
    : null;
}

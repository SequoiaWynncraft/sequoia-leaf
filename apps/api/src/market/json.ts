import { autoConfirmsAt, listingStatus, type MarketRules } from "@sequoia-leaf/core";

import type { Listing, Order } from "./store.ts";

// The marketplace as the API sends it, in every answer and event that carries it.

function iso(at: number): string {
  return new Date(at).toISOString();
}

function isoOrNull(at: number | null): string | null {
  return at === null ? null : iso(at);
}

/** A listing, with how it stands at `now` and how many units are left. */
export function listingJson(listing: Listing, now: number) {
  return {
    id: listing.id,
    kind: listing.kind,
    title: listing.title,
    description: listing.description,
    price: listing.price,
    quantity: listing.quantity,
    remaining: Math.max(0, listing.quantity - listing.taken),
    status: listingStatus(listing, listing.taken, now),
    seller: { player_id: listing.sellerId, name: listing.sellerName },
    created_at: iso(listing.createdAt),
    updated_at: iso(listing.updatedAt),
    expires_at: iso(listing.expiresAt),
  };
}

/** An order, the same for both sides. Who on staff settled a dispute is kept in the audit, not sent. */
export function orderJson(order: Order, rules: MarketRules) {
  const autoAt = autoConfirmsAt(order, rules);
  return {
    id: order.id,
    listing: { id: order.listingId, kind: order.kind, title: order.title },
    seller: { player_id: order.sellerId, name: order.sellerName },
    buyer: { player_id: order.buyerId, name: order.buyerName },
    quantity: order.quantity,
    price: order.price,
    leaf: order.leaf,
    fee: order.fee,
    state: order.state,
    placed_at: iso(order.placedAt),
    delivered_at: isoOrNull(order.deliveredAt),
    disputed_at: isoOrNull(order.disputedAt),
    closed_at: isoOrNull(order.closedAt),
    auto_confirms_at: isoOrNull(autoAt),
    cancelled_by: order.cancelledBy,
    dispute_reason: order.disputeReason,
    resolution:
      order.resolution === null
        ? null
        : {
            outcome: order.resolution === "released" ? ("release" as const) : ("refund" as const),
            note: order.resolutionNote,
          },
  };
}

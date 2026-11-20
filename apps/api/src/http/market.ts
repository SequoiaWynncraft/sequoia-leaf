import {
  checkListing,
  checkTerms,
  DEFAULT_RULES,
  type ListingProblem,
  type MarketRules,
  type OrderAction,
  quantityAllowed,
} from "@sequoia-leaf/core";
import { Clock, Effect, Layer } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder, HttpApiError } from "effect/http-api";

import { CurrentIdentity, LeafApi, TradeBodyErrors } from "../api/api.ts";
import { TradeInvalid } from "../api/errors.ts";
import type * as Body from "../api/schemas.ts";
import { Ledger } from "../ledger/store.ts";
import { actOnOrder, buyListing, createListing, editListing, withdrawListing } from "../market/actions.ts";
import { listingJson, orderJson } from "../market/json.ts";
import { Market } from "../market/store.ts";
import { PAGE, pageOf, tradeError } from "./trade.ts";

const rules: MarketRules = DEFAULT_RULES.market;

/** A marketplace or conversion request whose body, path or query does not decode gets `invalid_request`. */
export const TradeBodyErrorsLive = Layer.succeed(TradeBodyErrors)((httpEffect) =>
  Effect.catchIf(
    httpEffect,
    (error) => HttpApiError.HttpApiSchemaError.is(error) && error.kind !== "Body" && error.kind !== "ResponseHeaders",
    () =>
      Effect.fail(
        new TradeInvalid({
          code: "invalid_request",
          message: "That request isn't what this route takes (see /openapi.json)",
        }),
      ),
  ),
);

const PROBLEMS: Record<ListingProblem, string> = {
  title: `A title is ${rules.title.min} to ${rules.title.max} characters`,
  description: `A description is up to ${rules.description.max} characters`,
  price: `A price is a whole ${rules.price.min} to ${rules.price.max} Leaf`,
  quantity: `A listing offers 1 to ${rules.quantity.max}`,
};

const invalidListing = (problem: ListingProblem) =>
  new TradeInvalid({ code: "invalid_listing", message: PROBLEMS[problem] });

const invalidCount = new TradeInvalid({
  code: "invalid_count",
  message: `An order buys 1 to ${rules.quantity.max}, and no more than are left`,
});

// Handlers answer with their JSON themselves, checked against the schemas when the
// code compiles (see handlers.ts).

export const MarketHandlers = HttpApiBuilder.group(LeafApi, "market", (handlers) =>
  Effect.gen(function* () {
    const market = yield* Market;
    const ledger = yield* Ledger;

    /** An action by one side of an order, answered with the order and that member's balance. */
    const act = (id: number, action: OrderAction, note: string | null) =>
      Effect.gen(function* () {
        const identity = yield* CurrentIdentity;
        const now = yield* Clock.currentTimeMillis;
        const result = yield* actOnOrder({ kind: "member", playerId: identity.playerId }, id, action, note, now, rules);
        if (result.status === "refused") {
          return yield* tradeError(result.reason);
        }
        return HttpServerResponse.jsonUnsafe({
          order: orderJson(result.order, rules),
          leaf: (yield* ledger.account(identity.playerId)).balance,
        } satisfies typeof Body.OrderActed.Type);
      });

    return handlers
      .handle("list", ({ payload }) =>
        Effect.gen(function* () {
          const check = checkListing(
            {
              kind: payload.kind,
              title: payload.title,
              description: payload.description ?? "",
              price: payload.price,
              quantity: payload.quantity ?? 1,
            },
            rules,
          );
          if (!check.ok) {
            return yield* invalidListing(check.problem);
          }
          const identity = yield* CurrentIdentity;
          const now = yield* Clock.currentTimeMillis;
          const result = yield* createListing(identity, payload.request_id, check.listing, now, rules);
          if (result.status === "refused") {
            return yield* tradeError(result.reason);
          }
          return HttpServerResponse.jsonUnsafe({
            listing: listingJson(result.listing, now),
          } satisfies typeof Body.ListingAnswer.Type);
        }),
      )
      .handle("edit", ({ params, payload }) =>
        Effect.gen(function* () {
          const problem = checkTerms(payload, rules);
          if (problem !== undefined) {
            return yield* invalidListing(problem);
          }
          const identity = yield* CurrentIdentity;
          const now = yield* Clock.currentTimeMillis;
          const result = yield* editListing(identity, params.id, payload, now);
          if (result.status === "refused") {
            return yield* tradeError(result.reason);
          }
          return HttpServerResponse.jsonUnsafe({
            listing: listingJson(result.listing, now),
          } satisfies typeof Body.ListingAnswer.Type);
        }),
      )
      .handle("withdraw", ({ params }) =>
        Effect.gen(function* () {
          const identity = yield* CurrentIdentity;
          const now = yield* Clock.currentTimeMillis;
          const result = yield* withdrawListing(identity, params.id, now);
          if (result.status === "refused") {
            return yield* tradeError(result.reason);
          }
          return HttpServerResponse.jsonUnsafe({
            listing: listingJson(result.listing, now),
          } satisfies typeof Body.ListingAnswer.Type);
        }),
      )
      .handle("mine", ({ query }) =>
        Effect.gen(function* () {
          const identity = yield* CurrentIdentity;
          const now = yield* Clock.currentTimeMillis;
          const limit = query.limit ?? PAGE;
          const { page, next } = pageOf(yield* market.listingsOf(identity.playerId, query.before, limit + 1), limit);
          return HttpServerResponse.jsonUnsafe({
            listings: page.map((listing) =>
              Object.assign(listingJson(listing, now), { open_orders: listing.openOrders }),
            ),
            next_before: next,
          } satisfies typeof Body.MyListings.Type);
        }),
      )
      .handle("buy", ({ params, payload }) =>
        Effect.gen(function* () {
          const quantity = payload.quantity ?? 1;
          if (!quantityAllowed(quantity, rules)) {
            return yield* invalidCount;
          }
          const identity = yield* CurrentIdentity;
          const now = yield* Clock.currentTimeMillis;
          const result = yield* buyListing(
            identity,
            params.id,
            quantity,
            payload.price,
            payload.request_id,
            now,
            rules,
          );
          if (result.status === "refused") {
            return yield* tradeError(result.reason);
          }
          return HttpServerResponse.jsonUnsafe({
            order: orderJson(result.order, rules),
            leaf: (yield* ledger.account(identity.playerId)).balance,
          } satisfies typeof Body.OrderActed.Type);
        }),
      )
      .handle("orders", ({ query }) =>
        Effect.gen(function* () {
          const identity = yield* CurrentIdentity;
          const limit = query.limit ?? PAGE;
          const { page, next } = pageOf(yield* market.ordersOf(identity.playerId, query.before, limit + 1), limit);
          return HttpServerResponse.jsonUnsafe({
            orders: page.map((order) => orderJson(order, rules)),
            next_before: next,
          } satisfies typeof Body.Orders.Type);
        }),
      )
      .handle("order", ({ params }) =>
        Effect.gen(function* () {
          const identity = yield* CurrentIdentity;
          const order = yield* market.order(params.id);
          if (order === undefined || (order.buyerId !== identity.playerId && order.sellerId !== identity.playerId)) {
            return yield* tradeError("order_not_found");
          }
          return HttpServerResponse.jsonUnsafe({
            order: orderJson(order, rules),
          } satisfies typeof Body.OrderAnswer.Type);
        }),
      )
      .handle("deliver", ({ params }) => act(params.id, "deliver", null))
      .handle("confirm", ({ params }) => act(params.id, "confirm", null))
      .handle("cancel", ({ params }) => act(params.id, "cancel", null))
      .handle("dispute", ({ params, payload }) => act(params.id, "dispute", payload.reason));
  }),
);

export const MarketBrowseHandlers = HttpApiBuilder.group(LeafApi, "marketBrowse", (handlers) =>
  Effect.gen(function* () {
    const market = yield* Market;
    return handlers
      .handle("listings", ({ query }) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const limit = query.limit ?? PAGE;
          const found = yield* market.browse(
            { kind: query.kind, text: query.q, before: query.before, limit: limit + 1 },
            now,
          );
          const { page, next } = pageOf(found, limit);
          return HttpServerResponse.jsonUnsafe({
            listings: page.map((listing) => listingJson(listing, now)),
            next_before: next,
          } satisfies typeof Body.Listings.Type);
        }),
      )
      .handle("listing", ({ params }) =>
        Effect.gen(function* () {
          const listing = yield* market.listing(params.id);
          if (listing === undefined) {
            return yield* tradeError("listing_not_found");
          }
          return HttpServerResponse.jsonUnsafe({
            listing: listingJson(listing, yield* Clock.currentTimeMillis),
          } satisfies typeof Body.ListingAnswer.Type);
        }),
      );
  }),
);

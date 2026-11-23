import { timingSafeEqual } from "node:crypto";

import { isLeaf, parsePlayerId, REQUEST_KINDS, type RequestKind } from "@sequoia-leaf/core";
import { Clock, Effect, Layer, Redacted } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { Backend, LeafApi, PurchaseBodyErrors } from "../api/api.ts";
import { Invalid, PurchaseRefused, Unauthorized } from "../api/errors.ts";
import type * as Body from "../api/schemas.ts";
import { AppConfig } from "../config.ts";
import { Ledger } from "../ledger/store.ts";
import { Purchases } from "../purchases/store.ts";
import { payloadError } from "./routes/middleware.ts";

/** What a purchase's key may be: made by the backend, unique among its purchases. */
const KEY = /^[A-Za-z0-9_.:-]{1,100}$/;

/** Whether two secrets are the same, taking as long whatever they are. */
function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Lets in sequoia-backend by the internal token the two share. A request that came through the
 * public proxy, which always says whom it came from (`X-Forwarded-For`), is refused, token or not:
 * only the server's private network reaches these routes.
 */
export const BackendLive = Layer.effect(
  Backend,
  Effect.gen(function* () {
    const { backendToken } = yield* AppConfig;
    const refused = new Unauthorized({ code: "unauthorized", message: "This is for Sequoia's own services" });
    return Backend.of({
      bearer: (httpEffect, { credential }) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (
            backendToken === undefined ||
            request.headers["x-forwarded-for"] !== undefined ||
            !same(Redacted.value(credential), Redacted.value(backendToken))
          ) {
            return yield* refused;
          }
          return yield* httpEffect;
        }),
    });
  }),
);

/** A purchase whose body does not decode as `{ "player_id", "kind", "leaf" }` gets `invalid_purchase`. */
const invalidPurchase = new Invalid({
  code: "invalid_purchase",
  message:
    'Send a purchase as { "player_id": "<uuid>", "kind": "tome" or "aspect", "leaf": <whole number, 1 or more> }',
});
export const PurchaseBodyErrorsLive = Layer.succeed(PurchaseBodyErrors)(payloadError(invalidPurchase));
const invalidKey = new Invalid({
  code: "invalid_key",
  message: "A purchase's key is 1 to 100 letters, digits and _ . : -",
});
const invalidPlayer = new Invalid({ code: "invalid_uuid", message: "A player is their Minecraft UUID" });

const isKind = (kind: string): kind is RequestKind => REQUEST_KINDS.some((k) => k === kind);

/** Why Leaf refused a purchase, as the backend is told. */
const REFUSED = {
  insufficient_leaf: "The player does not have that much Leaf",
  key_in_use: "That key was used for another purchase",
  purchase_cancelled: "That purchase was cancelled",
} as const;

export const InternalHandlers = HttpApiBuilder.group(LeafApi, "internal", (handlers) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const purchases = yield* Purchases;
    return handlers
      .handle("leaf", ({ params }) =>
        Effect.gen(function* () {
          const playerId = parsePlayerId(params.player);
          if (playerId === undefined) {
            return yield* invalidPlayer;
          }
          const { balance } = yield* ledger.account(playerId);
          return HttpServerResponse.jsonUnsafe({
            player_id: playerId,
            balance,
          } satisfies typeof Body.PlayerLeaf.Type);
        }),
      )
      .handle("buy", ({ params, payload }) =>
        Effect.gen(function* () {
          if (!KEY.test(params.key)) {
            return yield* invalidKey;
          }
          const playerId = parsePlayerId(payload.player_id);
          const { kind, leaf: price } = payload;
          if (playerId === undefined || !isKind(kind) || !isLeaf(price)) {
            return yield* invalidPurchase;
          }
          const bought = yield* purchases.buy(params.key, playerId, kind, price, yield* Clock.currentTimeMillis);
          if (bought.status === "refused") {
            return yield* new PurchaseRefused({ code: bought.reason, message: REFUSED[bought.reason] });
          }
          return HttpServerResponse.jsonUnsafe({
            key: params.key,
            status: "paid",
            balance: bought.balance,
          } satisfies typeof Body.Purchased.Type);
        }),
      )
      .handle("cancel", ({ params }) =>
        Effect.gen(function* () {
          if (!KEY.test(params.key)) {
            return yield* invalidKey;
          }
          const cancelled = yield* purchases.cancel(params.key, yield* Clock.currentTimeMillis);
          return HttpServerResponse.jsonUnsafe({
            key: params.key,
            status: cancelled.status,
          } satisfies typeof Body.PurchaseCancelled.Type);
        }),
      );
  }),
);

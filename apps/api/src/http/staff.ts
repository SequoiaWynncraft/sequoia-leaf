import { CONVERSION_KINDS, DEFAULT_RULES } from "@sequoia-leaf/core";
import { Clock, Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { CurrentIdentity, LeafApi } from "../api/api.ts";
import type * as Body from "../api/schemas.ts";
import { declineConversion, payConversion, queueOf } from "../conversions/actions.ts";
import { staffConversionJson } from "../conversions/json.ts";
import { Conversions } from "../conversions/store.ts";
import { actOnOrder } from "../market/actions.ts";
import { orderJson } from "../market/json.ts";
import { Market } from "../market/store.ts";
import { tradeError } from "./trade.ts";

const marketRules = DEFAULT_RULES.market;
const conversionRules = DEFAULT_RULES.conversions;

// What staff do. `StaffOnly` lets only staff in; each step records which of them took it.

export const StaffHandlers = HttpApiBuilder.group(LeafApi, "staff", (handlers) =>
  Effect.gen(function* () {
    const market = yield* Market;
    const conversions = yield* Conversions;
    return handlers
      .handle("disputes", () =>
        Effect.gen(function* () {
          const disputes = yield* market.disputes;
          return HttpServerResponse.jsonUnsafe({
            orders: disputes.map((order) => orderJson(order, marketRules)),
          } satisfies typeof Body.Disputes.Type);
        }),
      )
      .handle("resolve", ({ params, payload }) =>
        Effect.gen(function* () {
          const identity = yield* CurrentIdentity;
          const now = yield* Clock.currentTimeMillis;
          const result = yield* actOnOrder(
            { kind: "staff", playerId: identity.playerId },
            params.id,
            payload.outcome,
            payload.note?.trim() ?? null,
            now,
            marketRules,
          );
          if (result.status === "refused") {
            return yield* tradeError(result.reason);
          }
          return HttpServerResponse.jsonUnsafe({
            order: orderJson(result.order, marketRules),
          } satisfies typeof Body.OrderAnswer.Type);
        }),
      )
      .handle("queue", () =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const queue = yield* Effect.forEach(CONVERSION_KINDS, (kind) =>
            Effect.gen(function* () {
              const standings = yield* queueOf(kind, conversionRules);
              const waiting = yield* conversions.waiting(kind);
              return waiting.map((claim) => staffConversionJson(claim, standings.get(claim.id), now));
            }),
          );
          return HttpServerResponse.jsonUnsafe({ queue: queue.flat() } satisfies typeof Body.ConversionQueue.Type);
        }),
      )
      .handle("pay", ({ params, payload }) =>
        Effect.gen(function* () {
          const identity = yield* CurrentIdentity;
          const now = yield* Clock.currentTimeMillis;
          const note = payload.note?.trim() ?? null;
          const result = yield* payConversion(identity.playerId, params.id, note, now, conversionRules);
          if (result.status === "refused") {
            return yield* tradeError(result.reason);
          }
          return HttpServerResponse.jsonUnsafe({
            conversion: staffConversionJson(result.conversion, result.standing, now),
          } satisfies typeof Body.StaffConversionAnswer.Type);
        }),
      )
      .handle("decline", ({ params, payload }) =>
        Effect.gen(function* () {
          const identity = yield* CurrentIdentity;
          const now = yield* Clock.currentTimeMillis;
          const result = yield* declineConversion(
            identity.playerId,
            params.id,
            payload.reason.trim(),
            now,
            conversionRules,
          );
          if (result.status === "refused") {
            return yield* tradeError(result.reason);
          }
          return HttpServerResponse.jsonUnsafe({
            conversion: staffConversionJson(result.conversion, result.standing, now),
          } satisfies typeof Body.StaffConversionAnswer.Type);
        }),
      );
  }),
);

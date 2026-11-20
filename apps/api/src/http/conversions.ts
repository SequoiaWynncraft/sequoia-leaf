import {
  CONVERSION_KINDS,
  conversionCost,
  type ConversionKind,
  type ConversionRules,
  DEFAULT_RULES,
  utcMonthStart,
} from "@sequoia-leaf/core";
import { Clock, Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { CurrentIdentity, LeafApi } from "../api/api.ts";
import { TradeInvalid } from "../api/errors.ts";
import type * as Body from "../api/schemas.ts";
import { cancelConversion, nextDueMonth, queueOf, requestConversion } from "../conversions/actions.ts";
import { conversionJson, type Standing } from "../conversions/json.ts";
import { type Conversion, Conversions } from "../conversions/store.ts";
import { Ledger } from "../ledger/store.ts";
import { tradeError } from "./trade.ts";

const rules: ConversionRules = DEFAULT_RULES.conversions;

/** How many claims of their own a member sees. */
const MY_CLAIMS = 100;

function invalidCount(kind: ConversionKind) {
  const rule = rules.kinds[kind];
  const range = rule.minUnits === rule.maxUnits ? `${rule.minUnits}` : `${rule.minUnits} to ${rule.maxUnits}`;
  return new TradeInvalid({ code: "invalid_count", message: `A claim of ${rule.name} is for ${range}` });
}

/** Where each of these claims stands in its queue, by id: the queues of the kinds among them that wait. */
export const standingsOf = Effect.fn("standingsOf")(function* (claims: readonly Conversion[]) {
  const kinds = new Set(claims.filter((claim) => claim.status === "pending").map((claim) => claim.kind));
  const standings = new Map<number, Standing>();
  for (const kind of kinds) {
    for (const [id, standing] of yield* queueOf(kind, rules)) {
      standings.set(id, standing);
    }
  }
  return standings;
});

export const ConversionHandlers = HttpApiBuilder.group(LeafApi, "conversions", (handlers) =>
  Effect.gen(function* () {
    const conversions = yield* Conversions;
    const ledger = yield* Ledger;
    return handlers
      .handle("claim", ({ payload }) =>
        Effect.gen(function* () {
          const count = payload.count ?? 1;
          if (conversionCost(payload.kind, count, rules) === undefined) {
            return yield* invalidCount(payload.kind);
          }
          const identity = yield* CurrentIdentity;
          const now = yield* Clock.currentTimeMillis;
          const note = payload.note?.trim() ?? null;
          const result = yield* requestConversion(identity, payload.kind, count, note, payload.request_id, now, rules);
          if (result.status === "refused") {
            return yield* tradeError(result.reason);
          }
          return HttpServerResponse.jsonUnsafe({
            conversion: conversionJson(result.conversion, result.standing, now),
            leaf: (yield* ledger.account(identity.playerId)).balance,
          } satisfies typeof Body.ConversionAnswer.Type);
        }),
      )
      .handle("mine", () =>
        Effect.gen(function* () {
          const identity = yield* CurrentIdentity;
          const now = yield* Clock.currentTimeMillis;
          const claims = yield* conversions.of(identity.playerId, MY_CLAIMS);
          const standings = yield* standingsOf(claims);
          return HttpServerResponse.jsonUnsafe({
            conversions: claims.map((claim) => conversionJson(claim, standings.get(claim.id), now)),
          } satisfies typeof Body.MyConversions.Type);
        }),
      )
      .handle("cancel", ({ params }) =>
        Effect.gen(function* () {
          const identity = yield* CurrentIdentity;
          const now = yield* Clock.currentTimeMillis;
          const result = yield* cancelConversion(identity.playerId, params.id, now, rules);
          if (result.status === "refused") {
            return yield* tradeError(result.reason);
          }
          return HttpServerResponse.jsonUnsafe({
            conversion: conversionJson(result.conversion, result.standing, now),
            leaf: (yield* ledger.account(identity.playerId)).balance,
          } satisfies typeof Body.ConversionAnswer.Type);
        }),
      );
  }),
);

export const ConversionRatesHandlers = HttpApiBuilder.group(LeafApi, "conversionRates", (handlers) =>
  handlers.handle("rates", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const kinds = yield* Effect.forEach(CONVERSION_KINDS, (kind) =>
        Effect.gen(function* () {
          const rule = rules.kinds[kind];
          return {
            kind,
            name: rule.name,
            leaf_per_unit: rule.leafPerUnit,
            min_count: rule.minUnits,
            max_count: rule.maxUnits,
            monthly_cap: rule.monthlyCap,
            member_monthly_limit: rule.memberMonthly ?? null,
            next_due_from: new Date(utcMonthStart(yield* nextDueMonth(kind, now, rules))).toISOString(),
          };
        }),
      );
      return HttpServerResponse.jsonUnsafe({
        provisional: rules.provisional,
        kinds,
      } satisfies typeof Body.ConversionRates.Type);
    }),
  ),
);

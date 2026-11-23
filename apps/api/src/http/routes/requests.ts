import { type RequestKind } from "@sequoia-leaf/core";
import { Effect } from "effect";
import { HttpClient, HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { LeafApi } from "../../api/api.ts";
import { Invalid, RequestRefused, RequestsUnavailable, RequestUnknown } from "../../api/errors.ts";
import type * as Body from "../../api/schemas.ts";
import { guildRequests, notEnoughLeaf } from "../../backend/requests.ts";
import { AppConfig } from "../../config.ts";
import { Ledger } from "../../ledger/store.ts";
import { Coins } from "../../play/coins.ts";
import { purseBeside, requestsFor } from "./shared.ts";

export const GameRequestsHandlers = HttpApiBuilder.group(LeafApi, "gameRequests", (handlers) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const coins = yield* Coins;
    const requests = guildRequests(yield* HttpClient.HttpClient, (yield* AppConfig).backendUrl);

    return (
      handlers
        // What the Treasury sells, as the backend answers the member, with what they lack for each.
        .handle("requests", () =>
          Effect.gen(function* () {
            const identity = yield* requestsFor;
            const looked = yield* requests.look(identity.session);
            if (looked.status === "unavailable") {
              return yield* new RequestsUnavailable({
                code: "requests_unavailable",
                message: "The guild's requests could not be reached. Try again in a moment.",
              });
            }
            if (looked.status === "refused") {
              return yield* new RequestRefused({ code: "request_refused", message: looked.message });
            }
            const { balance } = yield* ledger.account(identity.playerId);
            const offer = (kind: RequestKind) => {
              const price = looked.prices[kind];
              return {
                price,
                why_not: looked.whyNot ?? (balance < price ? notEnoughLeaf(kind, price, balance) : null),
              };
            };
            return HttpServerResponse.jsonUnsafe({
              aspect: offer("aspect"),
              tome: offer("tome"),
            } satisfies typeof Body.Requests.Type);
          }),
        )
        // One bought with the member's Leaf. The backend charges it through Leaf's own purchase route
        // before it answers, so nothing here holds the database while it waits.
        .handle("request", ({ payload }) =>
          Effect.gen(function* () {
            const identity = yield* requestsFor;
            const reason = payload.type === "tome" ? (payload.reason ?? "").trim() : null;
            if (reason !== null && (reason === "" || reason.length > 1000)) {
              return yield* new Invalid({
                code: "invalid_reason",
                message: "A tome request needs what the tome is for, 1 to 1,000 characters",
              });
            }
            const made = yield* requests.make(identity.session, payload.type, reason);
            if (made.status === "unknown") {
              return yield* new RequestUnknown({
                code: "request_unknown",
                message:
                  "Could not tell whether the request went through. Check the queue in Discord before trying again.",
              });
            }
            if (made.status === "refused") {
              return yield* new RequestRefused({ code: "request_refused", message: made.message });
            }
            if (made.status === "busy") {
              return yield* new RequestsUnavailable({ code: "requests_unavailable", message: made.message });
            }
            const purse = yield* coins.balances(identity.playerId);
            return HttpServerResponse.jsonUnsafe(
              {
                type: payload.type,
                position: made.position,
                leaf_paid: made.paid,
                leaf: purse.leaf,
              } satisfies typeof Body.RequestMade.Type,
              purseBeside(purse),
            );
          }),
        )
    );
  }),
);

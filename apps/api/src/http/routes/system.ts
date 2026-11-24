import { DEFAULT_RULES, RULE_CHANGES } from "@sequoia-leaf/core";
import { Effect } from "effect";
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api";
import { SqlClient } from "effect/sql";

import { rateCard } from "../../announce/rate-card.ts";
import { LeafApi } from "../../api/api.ts";
import type * as Body from "../../api/schemas.ts";
import { AppConfig } from "../../config.ts";

// Handlers answer with the values their endpoints declare, which the endpoints encode
// (`HttpServerResponse` is only for what is not JSON: pictures, streams, Live's upgrade).
// The services they use are looked up once, when the handlers are built.

export const SystemHandlers = HttpApiBuilder.group(LeafApi, "system", (handlers) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // Healthy means the database answers, since nothing works without it.
    const ok: typeof Body.Health.Type = { status: "ok" };
    const healthy = sql`SELECT 1`.pipe(Effect.orDie, Effect.as(ok));
    return handlers.handle("healthz", () => healthy);
  }),
);

/** The rate card as the website reads it: the same words as Discord's, kept for five minutes. */
export const RatesHandlers = HttpApiBuilder.group(LeafApi, "rates", (handlers) => {
  const card = rateCard(DEFAULT_RULES, RULE_CHANGES);
  const rates = HttpApiSchema.withHeaders({
    body: {
      title: card.title,
      description: card.description,
      sections: card.fields.map((field) => ({ name: field.name, text: field.value })),
      changed_at: card.timestamp ?? null,
    },
    headers: { "cache-control": "public, max-age=300" },
  });
  return Effect.succeed(handlers.handle("rates", () => Effect.succeed(rates)));
});

export const GameHelloHandlers = HttpApiBuilder.group(LeafApi, "gameHello", (handlers) =>
  Effect.gen(function* () {
    const { gameSignInUrl, gameLeafSpending } = yield* AppConfig;
    const hello = { sign_in: gameSignInUrl, leaf_spending: gameLeafSpending };
    return handlers.handle("hello", () => Effect.succeed(hello));
  }),
);

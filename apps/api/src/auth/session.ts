import { Cache, Context, Duration, Effect, Exit, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import type { Identity } from "../api/api.ts";
import { AppConfig } from "../config.ts";
import { PlayerUuid } from "../wire.ts";

export type IdentityResult =
  | { readonly status: "ok"; readonly identity: Identity }
  /** The token is missing, expired, revoked or not a Sequoia session. */
  | { readonly status: "unauthorized" }
  /** The backend could not be asked. Nothing is known about the token. */
  | { readonly status: "unavailable" };

const TIMEOUT = Duration.seconds(3);
/** Sessions the backend confirmed this recently are not asked about again. */
const CONFIRMED_FOR = Duration.minutes(1);
const REMEMBERED = 500;

/** Who a session belongs to, as sequoia-backend's `/auth/web/me` answers. */
const BackendIdentity = Schema.Struct({
  minecraft_uuid: PlayerUuid,
  minecraft_username: Schema.String,
  guild_rank: Schema.optionalKey(Schema.NullOr(Schema.String)),
  website_admin: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
});

/**
 * Asks sequoia-backend who a session token belongs to. The backend issued the
 * token and is the only one that can tell whether it was revoked, so Leaf never
 * inspects the token itself. Sessions it confirmed in the last minute are
 * remembered, so a page that makes several requests asks once, and requests
 * that arrive together share one question; a revoked session stops working
 * within a minute.
 */
export class Identities extends Context.Service<
  Identities,
  { readonly identify: (token: string) => Effect.Effect<IdentityResult> }
>()("leaf/Identities") {
  static readonly layer = Layer.effect(
    Identities,
    Effect.gen(function* () {
      const { backendUrl } = yield* AppConfig;
      const client = yield* HttpClient.HttpClient;

      const ask = (token: string) =>
        client
          .execute(
            HttpClientRequest.get(new URL("/auth/web/me", backendUrl)).pipe(
              HttpClientRequest.bearerToken(token),
              HttpClientRequest.acceptJson,
            ),
          )
          .pipe(
            Effect.flatMap((response): Effect.Effect<IdentityResult, unknown> => {
              if (response.status === 401) {
                return Effect.succeed({ status: "unauthorized" });
              }
              return HttpClientResponse.filterStatusOk(response).pipe(
                Effect.flatMap(HttpClientResponse.schemaBodyJson(BackendIdentity)),
                Effect.map(toResult),
              );
            }),
            Effect.timeout(TIMEOUT),
            Effect.catch(() => Effect.succeed<IdentityResult>({ status: "unavailable" })),
          );

      const confirmed = yield* Cache.makeWith(ask, {
        capacity: REMEMBERED,
        // Only a confirmed session is remembered; a refusal or an outage is asked about again.
        timeToLive: (exit) => (Exit.isSuccess(exit) && exit.value.status === "ok" ? CONFIRMED_FOR : Duration.zero),
      });
      return Identities.of({ identify: (token) => Cache.get(confirmed, token) });
    }),
  );
}

function toResult(body: typeof BackendIdentity.Type): IdentityResult {
  const rank = body.guild_rank;
  return {
    status: "ok",
    identity: {
      playerId: body.minecraft_uuid,
      username: body.minecraft_username,
      guildRank: typeof rank === "string" && rank !== "" ? rank : null,
      admin: body.website_admin === true,
    },
  };
}
